import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getObjectiveCurrentMonth, isObjectiveMonth, resolveDelivererObjective } from './deliverer-objective-calculations.js';
import { DELIVERER_OBJECTIVE_READ_PERMISSION } from './deliverer-objectives.js';
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

export const getDelivererMonthlyAchievement = async ({
  delivererId, userId, month = getObjectiveCurrentMonth(),
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
        { _id: delivererObjectId }, { projection: { objectiveHistory: 1 }, session },
      );
      if (!deliverer) return { notFound: true };
      const tours = await database.collection('tours').find({
        delivererId: delivererObjectId,
        status: { $in: [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED] },
      }, { projection: { countingId: 1, countedAt: 1, reference: 1 }, session }).sort({ _id: 1 }).toArray();
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
        if (!linked || !sameId(linked.tourId, tour._id) || !sameId(linked.delivererId, delivererObjectId)) {
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
      return {
        month, complete, salesInCentimes, knownSalesInCentimes,
        tourCount, validTourCount, invalidTourCount: tourCount - validTourCount, anomalies,
        targetInCentimes,
        achievementPercentage: comparisonAvailable ? salesInCentimes / targetInCentimes * 100 : null,
        remainingInCentimes: comparisonAvailable ? Math.max(0, targetInCentimes - salesInCentimes) : null,
        excessInCentimes: comparisonAvailable ? Math.max(0, salesInCentimes - targetInCentimes) : null,
        reached: comparisonAvailable ? salesInCentimes >= targetInCentimes : null,
      };
    }, {
      readConcern: { level: 'snapshot' }, readPreference: 'primary', writeConcern: { w: 'majority' },
    });
  } finally {
    await session.endSession();
  }
};
