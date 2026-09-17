import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { buildObjectiveMonthlyHistory, getObjectiveAchievementStatus, getObjectiveCurrentMonth, isObjectiveMonth, readObjectiveAchievementState, readObjectiveDirectoryState, resolveDelivererObjective } from './deliverer-objective-calculations.js';
import { DELIVERER_OBJECTIVE_READ_PERMISSION } from './deliverer-objectives.js';
import { buildDelivererListFilter, DELIVERERS_PER_PAGE, readDelivererListState } from './deliverers.js';
import { getMongoClient } from './mongodb.js';
import { calculateTourCountingLine } from './tour-counting-calculations.js';
import { TOUR_STATUS_CLOSED, TOUR_STATUS_COUNTED } from './tours.js';

const validDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
const sameId = (first, second) => first instanceof ObjectId
  && second instanceof ObjectId && first.equals(second);

// Recompute recorded sales from the immutable loading prices. Both recorded
// quantities and recorded amounts must agree; a stored total alone is insufficient.
export const readRecordedCountingSales = (counting) => {
  if (!Array.isArray(counting?.lines) || counting.lines.length === 0) {
    return { error: 'Lignes de vente historiques absentes.', salesInCentimes: null };
  }
  const reservationIds = new Set();
  let total = 0n;
  for (const line of counting.lines) {
    if (!line || !(line.sourceTourReservationId instanceof ObjectId)
      || !(line.productId instanceof ObjectId)
      || reservationIds.has(line.sourceTourReservationId.toString())
      || typeof line.baseUnit !== 'string' || !line.baseUnit.trim()
      || !Number.isSafeInteger(line.quantityInBaseUnits) || line.quantityInBaseUnits <= 0
      || !Number.isSafeInteger(line.returnedQuantityInBaseUnits)
      || line.returnedQuantityInBaseUnits < 0) {
      return { error: 'Lignes ou quantités de vente historiques incohérentes.', salesInCentimes: null };
    }
    reservationIds.add(line.sourceTourReservationId.toString());
    const calculation = calculateTourCountingLine(line, String(line.returnedQuantityInBaseUnits));
    if (!calculation.priceAvailable) {
      return { error: 'Prix de vente historique absent ou invalide.', salesInCentimes: null };
    }
    if (calculation.error || calculation.soldQuantityInBaseUnits !== line.soldQuantityInBaseUnits
      || calculation.amountDueInCentimes !== line.amountDueInCentimes) {
      return { error: 'Quantités vendues ou montants de vente historiques incohérents.', salesInCentimes: null };
    }
    total += BigInt(calculation.amountDueInCentimes);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)
    || !Number.isSafeInteger(counting.totalDueInCentimes)
    || Number(total) !== counting.totalDueInCentimes) {
    return { error: 'Total des ventes du comptage incohérent ou trop élevé.', salesInCentimes: null };
  }
  return { error: null, salesInCentimes: Number(total) };
};

const readMonthlyAchievement = ({ month, currentMonth, deliverer, tours, byId, byTourId }) => {
  const anomalies = [];
  let knownTotal = 0n;
  let tourCount = 0;
  let validTourCount = 0;
  for (const tour of tours) {
    const linked = tour.countingId instanceof ObjectId ? byId.get(tour.countingId.toString()) : null;
    const associated = byTourId.get(tour._id.toString()) ?? [];
    const dates = [tour.countedAt, linked?.countedAt, ...associated.map(({ countedAt }) => countedAt)];
    const months = new Set(dates.filter(validDate).map((date) => getObjectiveCurrentMonth(date)));
    // Unknown dates cannot be safely assigned to another month, so they
    // make the requested month's result incomplete rather than disappearing.
    if (months.size && !months.has(month)) continue;
    tourCount += 1;
    let error;
    if (!linked || !sameId(linked.tourId, tour._id) || !sameId(linked.delivererId, deliverer._id)) {
      error = 'Comptage absent ou rattachement à la tournée ou au livreur incohérent.';
    } else if (associated.length !== 1) {
      error = 'Plusieurs comptages existent pour cette tournée.';
    } else if (!validDate(linked.countedAt)
      || (tour.countedAt != null && (!validDate(tour.countedAt) || tour.countedAt.getTime() !== linked.countedAt.getTime()))) {
      error = 'Date de comptage absente ou incohérente.';
    } else {
      const sales = readRecordedCountingSales(linked);
      error = sales.error;
      if (!error) {
        knownTotal += BigInt(sales.salesInCentimes);
        validTourCount += 1;
      }
    }
    if (error) anomalies.push({
      tourId: tour._id.toString(), tourReference: tour.reference ?? 'Référence indisponible', label: error,
      monthUnknown: months.size === 0,
    });
  }
  const knownSalesInCentimes = knownTotal <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(knownTotal) : null;
  if (knownSalesInCentimes === null) anomalies.push({
    tourId: null, tourReference: 'Récapitulatif mensuel', label: 'Le total mensuel dépasse la limite numérique autorisée.', monthUnknown: false,
  });
  const complete = anomalies.length === 0;
  const objective = resolveDelivererObjective(deliverer.objectiveHistory, month);
  const targetInCentimes = Number.isSafeInteger(objective?.amountInCentimes) && objective.amountInCentimes > 0
    ? objective.amountInCentimes : null;
  const salesInCentimes = complete ? knownSalesInCentimes : null;
  const comparisonAvailable = complete && targetInCentimes !== null;
  const achievement = {
    month, complete, salesInCentimes, knownSalesInCentimes,
    tourCount, validTourCount, invalidTourCount: tourCount - validTourCount, anomalies,
    targetInCentimes,
    achievementPercentage: comparisonAvailable ? salesInCentimes / targetInCentimes * 100 : null,
    remainingInCentimes: comparisonAvailable ? Math.max(0, targetInCentimes - salesInCentimes) : null,
    excessInCentimes: comparisonAvailable ? Math.max(0, salesInCentimes - targetInCentimes) : null,
    reached: comparisonAvailable ? salesInCentimes >= targetInCentimes : null,
  };
  return { ...achievement, status: getObjectiveAchievementStatus(achievement, currentMonth) };
};

const loadRecordedTourData = async ({ database, session, delivererIds }) => {
  const tours = await database.collection('tours').find({
    delivererId: { $in: delivererIds },
    status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
  }, { projection: { delivererId: 1, countingId: 1, countedAt: 1, reference: 1 }, session }).sort({ _id: 1 }).toArray();
  const countings = tours.length ? await database.collection('tourCountings').find({
    $or: [
      { tourId: { $in: tours.map(({ _id }) => _id) } },
      { _id: { $in: tours.map(({ countingId }) => countingId).filter((id) => id instanceof ObjectId) } },
    ],
  }, { projection: { countedAt: 1, delivererId: 1, tourId: 1, lines: 1, totalDueInCentimes: 1 }, session }).toArray() : [];
  const byId = new Map(countings.map((counting) => [counting._id.toString(), counting]));
  const byTourId = new Map();
  for (const counting of countings) {
    const key = counting.tourId?.toString();
    const entries = byTourId.get(key) ?? [];
    entries.push(counting);
    byTourId.set(key, entries);
  }
  return { tours, countings, byId, byTourId };
};

const readDelivererAchievements = async ({
  delivererId, userId, month = getObjectiveCurrentMonth(), dashboard = false, searchParams = {},
}) => {
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(userId, DELIVERER_OBJECTIVE_READ_PERMISSION, { database, session });
      if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) return { notFound: true };
      if (!isObjectiveMonth(month)) return { errors: { month: 'Saisissez un mois valide.' } };
      const delivererObjectId = new ObjectId(delivererId);
      const deliverer = await database.collection('deliverers').findOne(
        { _id: delivererObjectId }, { projection: { objectiveHistory: 1, createdAt: 1 }, session },
      );
      if (!deliverer) return { notFound: true };
      const { tours, countings, byId, byTourId } = await loadRecordedTourData({ database, session, delivererIds: [delivererObjectId] });
      const currentMonth = getObjectiveCurrentMonth();
      const monthlyResults = new Map();
      const readMonth = (selectedMonth) => {
        if (!monthlyResults.has(selectedMonth)) monthlyResults.set(selectedMonth, readMonthlyAchievement({
          month: selectedMonth, currentMonth, deliverer, tours, byId, byTourId,
        }));
        return monthlyResults.get(selectedMonth);
      };
      if (!dashboard) return readMonth(month);
      const state = readObjectiveAchievementState(searchParams, currentMonth);
      const knownMonths = [currentMonth,
        ...(validDate(deliverer.createdAt) ? [getObjectiveCurrentMonth(deliverer.createdAt)] : []),
        ...(deliverer.objectiveHistory ?? []).map(({ effectiveMonth }) => effectiveMonth).filter(isObjectiveMonth),
        ...tours.map(({ countedAt }) => countedAt).filter(validDate).map((date) => getObjectiveCurrentMonth(date)),
        ...countings.map(({ countedAt }) => countedAt).filter(validDate).map((date) => getObjectiveCurrentMonth(date)),
      ];
      return {
        achievement: readMonth(state.achievementMonth),
        monthlyHistory: buildObjectiveMonthlyHistory({ firstMonth: knownMonths.sort()[0], currentMonth, state, readMonth }),
      };
    }, {
      readConcern: { level: 'snapshot' }, readPreference: 'primary', writeConcern: { w: 'majority' },
    });
  } finally {
    await session.endSession();
  }
};

export const getDelivererMonthlyAchievement = (options) => readDelivererAchievements(options);

export const getDelivererObjectiveDashboard = (options) => readDelivererAchievements({ ...options, dashboard: true });

// Read each batch's tours and countings together, preserving the fiche's validation
// rules without one database transaction per deliverer.
export const listDelivererObjectiveOverview = async ({
  page = 1, pageSize = DELIVERERS_PER_PAGE, query = '', status = 'active',
  month = getObjectiveCurrentMonth(), achievementStatus = '', userId,
} = {}) => {
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(userId, 'deliverers.read', { database, session });
      await requireUserPermission(userId, DELIVERER_OBJECTIVE_READ_PERMISSION, { database, session });
      const currentMonth = getObjectiveCurrentMonth();
      const state = {
        ...readDelivererListState({ page: String(page), q: query, statut: status }),
        ...readObjectiveDirectoryState({ mois: month, realisation: achievementStatus }, currentMonth),
      };
      const normalizedPageSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100 ? pageSize : DELIVERERS_PER_PAGE;
      const filter = buildDelivererListFilter(state);
      const collection = database.collection('deliverers');
      const projection = { active: 1, code: 1, name: 1, phone: 1, objectiveHistory: 1 };
      let totalItems = 0;
      let documents;
      if (!state.achievementStatus) {
        totalItems = await collection.countDocuments(filter, { session });
        state.page = Math.min(state.page, Math.max(1, Math.ceil(totalItems / normalizedPageSize)));
        documents = await collection.find(filter, { projection, session }).sort({ code: 1, _id: 1 })
          .skip((state.page - 1) * normalizedPageSize).limit(normalizedPageSize).toArray();
      } else {
        documents = await collection.find(filter, { projection, session }).sort({ code: 1, _id: 1 }).toArray();
      }
      const results = [];
      for (let offset = 0; offset < documents.length; offset += 100) {
        const batch = documents.slice(offset, offset + 100);
        const { tours, byId, byTourId } = await loadRecordedTourData({ database, session, delivererIds: batch.map(({ _id }) => _id) });
        const toursByDeliverer = new Map();
        for (const tour of tours) {
          const id = tour.delivererId.toString();
          if (!toursByDeliverer.has(id)) toursByDeliverer.set(id, []);
          toursByDeliverer.get(id).push(tour);
        }
        for (const deliverer of batch) {
          const achievement = readMonthlyAchievement({
            month: state.month, currentMonth, deliverer,
            tours: toursByDeliverer.get(deliverer._id.toString()) ?? [], byId, byTourId,
          });
          if (state.achievementStatus && achievement.status !== state.achievementStatus) continue;
          results.push({
            id: deliverer._id.toString(), active: deliverer.active !== false,
            code: deliverer.code, name: deliverer.name, phone: deliverer.phone ?? '', achievement,
          });
        }
      }
      if (state.achievementStatus) totalItems = results.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
      const activePage = Math.min(state.page, totalPages);
      return {
        ...state, page: activePage, pageSize: normalizedPageSize, totalItems, totalPages,
        deliverers: state.achievementStatus ? results.slice((activePage - 1) * normalizedPageSize, activePage * normalizedPageSize) : results,
      };
    }, { readConcern: { level: 'snapshot' }, readPreference: 'primary', writeConcern: { w: 'majority' } });
  } finally {
    await session.endSession();
  }
};
