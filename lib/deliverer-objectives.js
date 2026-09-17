import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getObjectiveCurrentMonth, isObjectiveMonth, resolveDelivererObjective } from './deliverer-objective-calculations.js';
import { getDatabase } from './mongodb.js';
import { parseReceptionAmountInCentimes } from './receptions.js';

export const DELIVERER_OBJECTIVE_READ_PERMISSION = 'deliverers.objectives.read';
export const DELIVERER_OBJECTIVE_UPDATE_PERMISSION = 'deliverers.objectives.update';
export const OBJECTIVE_HISTORY_PER_PAGE = 5;

export const validateDelivererObjective = ({ amount, effectiveMonth }, currentMonth = getObjectiveCurrentMonth()) => {
  const amountInCentimes = parseReceptionAmountInCentimes(typeof amount === 'string' ? amount.trim() : '');
  const errors = {};
  if (amountInCentimes === null || amountInCentimes <= 0) {
    errors.amount = 'Saisissez un montant strictement positif avec deux décimales maximum.';
  }
  if (!isObjectiveMonth(effectiveMonth)) {
    errors.effectiveMonth = 'Saisissez un mois de prise d’effet valide.';
  } else if (effectiveMonth < currentMonth) {
    errors.effectiveMonth = 'Les objectifs des mois passés ne peuvent pas être modifiés.';
  }
  return Object.keys(errors).length ? { errors } : { data: { amountInCentimes, effectiveMonth } };
};

export const getDelivererObjectives = async ({
  delivererId, userId, objectiveQuery = '', objectiveMonth = '', objectivePage = 1,
}) => {
  await requireUserPermission(userId, DELIVERER_OBJECTIVE_READ_PERMISSION);
  if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) return { notFound: true };
  const database = await getDatabase();
  const deliverer = await database.collection('deliverers').findOne(
    { _id: new ObjectId(delivererId) },
    { projection: { objectiveHistory: 1, objectiveVersion: 1 } },
  );
  if (!deliverer) return { notFound: true };
  const history = deliverer.objectiveHistory ?? [];
  const authors = await database.collection('users').find(
    { _id: { $in: history.map(({ changedBy }) => changedBy) } },
    { projection: { username: 1 } },
  ).toArray();
  const usernames = new Map(authors.map(({ _id, username }) => [_id.toString(), username]));
  const serialize = (entry) => entry ? {
    ...entry,
    changedAt: entry.changedAt.toISOString(),
    changedBy: usernames.get(entry.changedBy.toString()) ?? 'Compte indisponible',
  } : null;
  const currentMonth = getObjectiveCurrentMonth();
  const nextMonth = history.map(({ effectiveMonth }) => effectiveMonth)
    .filter((month) => month > currentMonth).sort()[0];
  const query = typeof objectiveQuery === 'string' ? objectiveQuery.trim().slice(0, 100) : '';
  const month = isObjectiveMonth(objectiveMonth) ? objectiveMonth : '';
  const filtered = history.map(serialize).reverse().filter((entry) =>
    (!month || entry.effectiveMonth === month)
    && `${entry.effectiveMonth} ${entry.amountInCentimes / 100} ${entry.changedBy}`
      .toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  const totalPages = Math.max(1, Math.ceil(filtered.length / OBJECTIVE_HISTORY_PER_PAGE));
  const page = Math.min(Number.isSafeInteger(objectivePage) && objectivePage > 0 ? objectivePage : 1, totalPages);
  return {
    currentMonth,
    current: serialize(resolveDelivererObjective(history, currentMonth)),
    next: nextMonth ? serialize(resolveDelivererObjective(history, nextMonth)) : null,
    version: deliverer.objectiveVersion ?? 0,
    history: filtered.slice((page - 1) * OBJECTIVE_HISTORY_PER_PAGE, page * OBJECTIVE_HISTORY_PER_PAGE),
    objectiveQuery: query, objectiveMonth: month, objectivePage: page,
    totalItems: filtered.length, totalPages,
  };
};

export const updateDelivererObjective = async ({ amount, effectiveMonth, delivererId, expectedVersion, updatedBy }) => {
  await requireUserPermission(updatedBy, DELIVERER_OBJECTIVE_UPDATE_PERMISSION);
  if (typeof delivererId !== 'string' || !ObjectId.isValid(delivererId)) return { notFound: true };
  const validation = validateDelivererObjective({ amount, effectiveMonth });
  if (validation.errors) return validation;
  const staleResult = {
    stale: true,
    errors: { form: 'L’objectif a été modifié depuis l’ouverture de la fiche. Relisez les valeurs actualisées puis confirmez à nouveau.' },
  };
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return staleResult;
  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const _id = new ObjectId(delivererId);
  const deliverer = await deliverers.findOne({ _id }, { projection: { objectiveVersion: 1, objectiveHistory: 1 } });
  if (!deliverer) return { notFound: true };
  if ((deliverer.objectiveVersion ?? 0) !== expectedVersion) return staleResult;
  const previous = resolveDelivererObjective(deliverer.objectiveHistory, effectiveMonth);
  if (previous?.amountInCentimes === validation.data.amountInCentimes) return { changed: false };
  const versionFilter = expectedVersion === 0
    ? { objectiveVersion: { $exists: false } } : { objectiveVersion: expectedVersion };
  const result = await deliverers.updateOne({ _id, ...versionFilter }, {
    $set: { objectiveVersion: expectedVersion + 1 },
    $push: { objectiveHistory: {
      ...validation.data,
      previousAmountInCentimes: previous?.amountInCentimes ?? null,
      version: expectedVersion + 1,
      changedAt: new Date(),
      changedBy: new ObjectId(updatedBy),
    } },
  });
  if (result.matchedCount !== 1) {
    return await deliverers.countDocuments({ _id }, { limit: 1 }) ? staleResult : { notFound: true };
  }
  return { changed: true };
};
