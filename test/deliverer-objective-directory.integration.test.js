import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_obj_dir_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { getObjectiveCurrentMonth } = await import('../lib/deliverer-objective-calculations.js');
const { getDelivererMonthlyAchievement, listDelivererObjectiveOverview } = await import('../lib/deliverer-monthly-achievement.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
const readerId = new ObjectId();
const month = '2025-12';
const countedAt = new Date('2025-12-15T09:00:00Z');

before(async () => {
  database = await getDatabase();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions: ['deliverers.read', 'deliverers.objectives.read'] });
  await database.collection('users').insertOne({ _id: readerId, active: true, username: 'lecteur-bilan', roleIds: [roleId] });
});
after(async () => {
  try {
    if (database) await database.dropDatabase();
  } finally {
    await closeMongoConnection();
  }
});

const insertDeliverer = async (code, fields = {}) => {
  const _id = new ObjectId();
  await database.collection('deliverers').insertOne({ _id, code, name: `Livreur ${code}`, phone: '', ...fields });
  return _id;
};
const objectiveHistory = (amountInCentimes) => [{ version: 1, effectiveMonth: '2025-01', amountInCentimes }];
const salesDocuments = (delivererId, changes = {}) => {
  const tourId = new ObjectId();
  const countingId = new ObjectId();
  return {
    tour: { _id: tourId, countingId, delivererId, status: 'COUNTED', countedAt, reference: `TRN-${tourId}`, ...changes.tour },
    counting: { _id: countingId, tourId, delivererId, countedAt, totalDueInCentimes: 1000, lines: [{
      sourceTourReservationId: new ObjectId(), productId: new ObjectId(), baseUnit: 'PIECE',
      quantityInBaseUnits: 12, returnedQuantityInBaseUnits: 2, soldQuantityInBaseUnits: 10, amountDueInCentimes: 1000,
      salePriceAtLoading: { amountInCentimes: 100, currency: 'DZD', taxIncluded: true, unit: 'PIECE' },
    }], ...changes.counting },
  };
};
const insertSales = async (id, changes = {}) => {
  const documents = salesDocuments(id, changes);
  await database.collection('tours').insertOne(documents.tour);
  await database.collection('tourCountings').insertOne(documents.counting);
};
const read = (params = {}) => listDelivererObjectiveOverview({ month, userId: readerId.toString(), ...params });

test('le répertoire et la fiche utilisent les mêmes objectifs récurrents et ventes historiques', async () => {
  const first = await insertDeliverer('PARITE-A', { objectiveHistory: objectiveHistory(500) });
  const second = await insertDeliverer('PARITE-B', { active: false, objectiveHistory: objectiveHistory(2000) });
  const empty = await insertDeliverer('PARITE-C');
  await insertSales(first, { tour: { status: 'CLOSED' } });
  await insertSales(second);
  await insertSales(first, { tour: { status: 'LOADED' } });
  await insertSales(first, { tour: { countedAt: new Date('2025-11-15T09:00:00Z') }, counting: { countedAt: new Date('2025-11-15T09:00:00Z') } });
  const result = await read({ query: 'PARITE-', status: 'all' });
  assert.equal(result.totalItems, 3);
  for (const row of result.deliverers) {
    assert.deepEqual(row.achievement, await getDelivererMonthlyAchievement({ delivererId: row.id, userId: readerId.toString(), month }));
  }
  assert.equal(result.deliverers[0].achievement.achievementPercentage, 200);
  assert.equal(result.deliverers[0].achievement.status, 'reached');
  assert.equal(result.deliverers[1].achievement.status, 'missed');
  assert.equal(result.deliverers[2].id, empty.toString());
  assert.equal(result.deliverers[2].achievement.status, 'undefined');
  assert.equal(result.deliverers[2].achievement.achievementPercentage, null);
  assert.equal((await read({ query: 'PARITE-' })).totalItems, 2);
  assert.equal((await read({ query: 'PARITE-', status: 'disabled' })).deliverers[0].id, second.toString());
  assert.equal((await listDelivererObjectiveOverview({ query: 'PARITE-', userId: readerId.toString() })).month, getObjectiveCurrentMonth());
});

test('filtre toutes les réalisations avant pagination, au-delà d’un lot de cent livreurs', async () => {
  const deliverers = Array.from({ length: 121 }, (_, index) => ({
    _id: new ObjectId(), code: `PAGE-${String(index).padStart(3, '0')}`, name: `Livreur page ${index}`,
    objectiveHistory: objectiveHistory(index >= 108 ? 1000 : 2000),
  }));
  await database.collection('deliverers').insertMany(deliverers);
  const records = deliverers.slice(108).map(({ _id }) => salesDocuments(_id));
  await database.collection('tours').insertMany(records.map(({ tour }) => tour));
  await database.collection('tourCountings').insertMany(records.map(({ counting }) => counting));
  const first = await read({ query: 'PAGE-', achievementStatus: 'reached' });
  assert.equal(first.totalItems, 13);
  assert.equal(first.totalPages, 2);
  assert.equal(first.deliverers.length, 10);
  assert.equal(first.deliverers[0].code, 'PAGE-108');
  assert.equal(first.deliverers[9].code, 'PAGE-117');
  const last = await read({ query: 'PAGE-', achievementStatus: 'reached', page: 999 });
  assert.equal(last.page, 2);
  assert.deepEqual(last.deliverers.map(({ code }) => code), ['PAGE-118', 'PAGE-119', 'PAGE-120']);
  const missed = await read({ query: 'PAGE-', achievementStatus: 'missed', page: 11 });
  assert.equal(missed.totalItems, 108);
  assert.equal(missed.totalPages, 11);
  assert.equal(missed.deliverers.length, 8);
  assert.equal(missed.deliverers[0].code, 'PAGE-100');
  const unfiltered = await read({ query: 'PAGE-', page: 2 });
  assert.equal(unfiltered.totalItems, 121);
  assert.equal(unfiltered.deliverers[0].code, 'PAGE-010');
});

test('conserve la recherche littérale par nom ou code avec les filtres de réalisation', async () => {
  await insertDeliverer('RECHERCHE-NORD', { name: 'Équipe [Centre]', objectiveHistory: objectiveHistory(1000) });
  await insertDeliverer('RECHERCHE-SUD', { name: 'Équipe Sud', objectiveHistory: objectiveHistory(1000) });
  assert.equal((await read({ query: 'recherche-nord', achievementStatus: 'missed' })).totalItems, 1);
  assert.equal((await read({ query: '[centre]', achievementStatus: 'missed' })).deliverers[0].code, 'RECHERCHE-NORD');
  assert.equal((await read({ query: '.*', achievementStatus: 'missed' })).totalItems, 0);
  const empty = await read({ query: 'RECHERCHE-', achievementStatus: 'reached', page: 999 });
  assert.equal(empty.totalItems, 0);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.page, 1);
});

test('ne classe pas les ventes incomplètes comme atteint ou non atteint', async () => {
  const id = await insertDeliverer('INCOMPLET', { objectiveHistory: objectiveHistory(1000) });
  await insertSales(id, { counting: { lines: [] } });
  const result = await read({ query: 'INCOMPLET', achievementStatus: 'incomplete' });
  assert.equal(result.totalItems, 1);
  assert.equal(result.deliverers[0].achievement.salesInCentimes, null);
  assert.equal(result.deliverers[0].achievement.achievementPercentage, null);
  assert.equal((await read({ query: 'INCOMPLET', achievementStatus: 'missed' })).totalItems, 0);
  assert.equal((await read({ query: 'INCOMPLET', achievementStatus: 'reached' })).totalItems, 0);
});

test('les mois courants restent en cours et les paramètres invalides sont normalisés', async () => {
  await insertDeliverer('EN-COURS', { objectiveHistory: objectiveHistory(1000) });
  const result = await read({ query: 'EN-COURS', month: getObjectiveCurrentMonth(), achievementStatus: 'ongoing' });
  assert.equal(result.totalItems, 1);
  assert.equal(result.deliverers[0].achievement.status, 'ongoing');
  const normalized = await read({ query: 'EN-COURS', month: '2026-13', achievementStatus: 'toString', page: -1, pageSize: 101 });
  assert.equal(normalized.month, getObjectiveCurrentMonth());
  assert.equal(normalized.achievementStatus, '');
  assert.equal(normalized.page, 1);
  assert.equal(normalized.pageSize, 10);
});

test('le bilan exige les droits de lecture des livreurs et des objectifs', async () => {
  for (const [permissions, denied] of [
    [[], 'deliverers.read'], [['deliverers.read'], 'deliverers.objectives.read'], [['deliverers.objectives.read'], 'deliverers.read'],
  ]) {
    const userId = new ObjectId();
    const roleId = new ObjectId();
    await database.collection('roles').insertOne({ _id: roleId, permissions });
    await database.collection('users').insertOne({ _id: userId, active: true, roleIds: [roleId] });
    await assert.rejects(read({ userId: userId.toString() }), (error) => error instanceof PermissionDeniedError && error.permission === denied);
  }
});
