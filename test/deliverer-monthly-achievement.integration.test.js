import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_ma_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { getDelivererMonthlyAchievement, readRecordedCountingSales } = await import('../lib/deliverer-monthly-achievement.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
const readerId = new ObjectId();
const month = '2026-10';
const countedAt = new Date('2026-10-15T09:00:00Z');
const line = (overrides = {}) => ({
  sourceTourReservationId: new ObjectId(), productId: new ObjectId(), baseUnit: 'PIECE',
  quantityInBaseUnits: 12, returnedQuantityInBaseUnits: 2, soldQuantityInBaseUnits: 10,
  amountDueInCentimes: 1000,
  salePriceAtLoading: { amountInCentimes: 100, currency: 'DZD', taxIncluded: true, unit: 'PIECE' },
  ...overrides,
});
before(async () => {
  database = await getDatabase();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions: ['deliverers.objectives.read'] });
  await database.collection('users').insertOne({ _id: readerId, active: true, roleIds: [roleId] });
});
after(async () => {
  try {
    if (database) await database.dropDatabase();
  } finally {
    await closeMongoConnection();
  }
});
const deliverer = async (fields = {}) => {
  const _id = new ObjectId();
  await database.collection('deliverers').insertOne({ _id, active: true, name: 'Livreur réalisation', ...fields });
  return _id;
};
const insertTour = async (delivererId, { status = 'COUNTED', tour = {}, counting = {} } = {}) => {
  const tourId = new ObjectId();
  const countingId = new ObjectId();
  await database.collection('tours').insertOne({
    _id: tourId, delivererId, reference: `TRN-${tourId}`, status,
    plannedDate: new Date('2026-09-28T00:00:00Z'), loadedAt: new Date('2026-09-28T09:00:00Z'),
    countingId, countedAt, ...tour,
  });
  await database.collection('tourCountings').insertOne({
    _id: countingId, tourId, delivererId, countedAt, lines: [line()], totalDueInCentimes: 1000, ...counting,
  });
  return { tourId, countingId };
};
const read = (delivererId, selectedMonth = month, userId = readerId) => getDelivererMonthlyAchievement({
  delivererId: delivererId.toString(), userId: userId.toString(), month: selectedMonth,
});

test('seules les tournées comptées et terminées du livreur entrent dans les ventes du mois', async () => {
  const id = await deliverer();
  for (const status of ['COUNTED', 'CLOSED', 'LOADED', 'PREPARATION', 'CANCELLED']) await insertTour(id, { status });
  await insertTour(await deliverer());
  const result = await read(id);
  assert.equal(result.complete, true);
  assert.equal(result.salesInCentimes, 2000);
  assert.equal(result.tourCount, 2);
  assert.equal(result.validTourCount, 2);
  assert.deepEqual(result.anomalies, []);
  assert.equal((await read(id, '2026-09')).salesInCentimes, 0);
});

test('terminer une tournée ne compte pas une deuxième vente et ne change pas son mois', async () => {
  const id = await deliverer();
  const { tourId } = await insertTour(id);
  const first = await read(id);
  await database.collection('tours').updateOne({ _id: tourId }, { $set: { status: 'CLOSED', closedAt: new Date('2026-11-01T00:00:00Z') } });
  assert.deepEqual(await read(id), first);
  assert.equal((await read(id, '2026-11')).salesInCentimes, 0);
});

test('les limites de mois et d’année utilisent la date de comptage en Algérie', async () => {
  const id = await deliverer();
  for (const date of ['2026-09-30T22:59:59Z', '2026-09-30T23:00:00Z', '2026-10-31T22:59:59Z', '2026-10-31T23:00:00Z', '2026-12-31T23:00:00Z']) {
    await insertTour(id, { tour: { countedAt: new Date(date) }, counting: { countedAt: new Date(date) } });
  }
  assert.equal((await read(id, '2026-09')).salesInCentimes, 1000);
  assert.equal((await read(id, '2026-10')).salesInCentimes, 2000);
  assert.equal((await read(id, '2026-11')).salesInCentimes, 1000);
  assert.equal((await read(id, '2026-12')).salesInCentimes, 0);
  assert.equal((await read(id, '2027-01')).salesInCentimes, 1000);
});

test('les retours et les prix historiques par pack et unité déterminent les ventes', async () => {
  const id = await deliverer();
  const historicalLine = line({
    quantityInBaseUnits: 25, returnedQuantityInBaseUnits: 12, soldQuantityInBaseUnits: 13,
    amountDueInCentimes: 2200,
    salePriceAtLoading: { amountInCentimes: 200, currency: 'DZD', taxIncluded: true, unit: 'PIECE',
      packaging: { quantity: 6, amountInCentimes: 1000, currency: 'DZD', taxIncluded: true } },
  });
  await insertTour(id, { counting: { lines: [historicalLine], totalDueInCentimes: 2200 } });
  await database.collection('products').insertOne({ _id: historicalLine.productId, salePrice: { amountInCentimes: 9900 } });
  assert.equal((await read(id)).salesInCentimes, 2200);
  await database.collection('products').updateOne({ _id: historicalLine.productId }, { $set: { 'salePrice.amountInCentimes': 12345 } });
  assert.equal((await read(id)).salesInCentimes, 2200);
});

test('les frais et versements, même invalides, n’affectent pas les ventes', async () => {
  const id = await deliverer();
  const { tourId, countingId } = await insertTour(id);
  const first = await read(id);
  await database.collection('tourExpenses').insertOne({ tourId, sourceTourCountingId: countingId, totalInCentimes: 999999 });
  await database.collection('cashPayments').insertOne({ delivererId: id, tourId, amountInCentimes: -100, sourceTourCountingId: countingId });
  assert.deepEqual(await read(id), first);
});

test('un mois sans ventes affiche zéro et ne confond pas absence d’objectif et objectif atteint', async () => {
  const id = await deliverer();
  const result = await read(id);
  assert.equal(result.complete, true);
  assert.equal(result.salesInCentimes, 0);
  assert.equal(result.knownSalesInCentimes, 0);
  assert.equal(result.targetInCentimes, null);
  assert.equal(result.achievementPercentage, null);
  assert.equal(result.reached, null);
});

test('la comparaison utilise l’objectif applicable au mois sélectionné', async () => {
  const id = await deliverer({ objectiveHistory: [
    { version: 1, effectiveMonth: '2026-09', amountInCentimes: 4000 },
    { version: 2, effectiveMonth: '2026-11', amountInCentimes: 8000 },
    { version: 3, effectiveMonth: '2026-10', amountInCentimes: 2000 },
  ] });
  await insertTour(id);
  const result = await read(id);
  assert.equal(result.targetInCentimes, 2000);
  assert.equal(result.achievementPercentage, 50);
  assert.equal(result.remainingInCentimes, 1000);
  assert.equal(result.excessInCentimes, 0);
  assert.equal(result.reached, false);
  assert.equal((await read(id, '2026-11')).targetInCentimes, 8000);
  await insertTour(id);
  assert.equal((await read(id)).reached, true);
  await insertTour(id);
  const excess = await read(id);
  assert.equal(excess.achievementPercentage, 150);
  assert.equal(excess.remainingInCentimes, 0);
  assert.equal(excess.excessInCentimes, 1000);
});

test('un comptage absent invalide le total du mois et conserve seulement un sous-total fiable', async () => {
  const id = await deliverer({ objectiveHistory: [{ version: 1, effectiveMonth: month, amountInCentimes: 1000 }] });
  await insertTour(id);
  const { countingId } = await insertTour(id);
  await database.collection('tourCountings').deleteOne({ _id: countingId });
  const result = await read(id);
  assert.equal(result.complete, false);
  assert.equal(result.salesInCentimes, null);
  assert.equal(result.knownSalesInCentimes, 1000);
  assert.equal(result.invalidTourCount, 1);
  assert.equal(result.achievementPercentage, null);
  assert.equal(result.remainingInCentimes, null);
  assert.equal(result.excessInCentimes, null);
  assert.equal(result.reached, null);
  assert.match(result.anomalies[0].label, /Comptage absent/);
  assert.equal((await read(id, '2026-09')).complete, true);
});

test('les lignes manquantes, prix, quantités, montants et références incohérents sont refusés', async () => {
  const invalidLines = [
    null, line({ salePriceAtLoading: undefined }), line({ salePriceAtLoading: { amountInCentimes: 100, currency: 'EUR' } }),
    line({ returnedQuantityInBaseUnits: -1 }), line({ returnedQuantityInBaseUnits: 13 }),
    line({ returnedQuantityInBaseUnits: 1.5 }), line({ soldQuantityInBaseUnits: 11 }),
    line({ amountDueInCentimes: 999 }), line({ sourceTourReservationId: undefined }),
    line({ productId: undefined }), line({ quantityInBaseUnits: 0 }),
  ];
  for (const invalidLine of invalidLines) {
    const id = await deliverer();
    await insertTour(id, { counting: { lines: [invalidLine] } });
    const result = await read(id);
    assert.equal(result.complete, false);
    assert.equal(result.salesInCentimes, null);
    assert.equal(result.knownSalesInCentimes, 0);
  }
  for (const changes of [{ lines: [] }, { lines: null }, { totalDueInCentimes: 999 }, { totalDueInCentimes: '1000' }]) {
    const id = await deliverer();
    await insertTour(id, { counting: changes });
    assert.equal((await read(id)).complete, false);
  }
  const duplicatedLine = line();
  assert.ok(readRecordedCountingSales({ lines: [duplicatedLine, duplicatedLine], totalDueInCentimes: 2000 }).error);
});

test('les liens incohérents ou plusieurs comptages d’une tournée ne gonflent pas les ventes', async () => {
  for (const changes of [{ tourId: new ObjectId() }, { delivererId: new ObjectId() }]) {
    const id = await deliverer();
    await insertTour(id, { counting: changes });
    assert.equal((await read(id)).complete, false);
  }
  const id = await deliverer();
  const { tourId } = await insertTour(id);
  await database.collection('tourCountings').insertOne({ tourId, delivererId: id, countedAt, lines: [line()], totalDueInCentimes: 1000 });
  const result = await read(id);
  assert.equal(result.complete, false);
  assert.equal(result.salesInCentimes, null);
  assert.equal(result.knownSalesInCentimes, 0);
  assert.equal(result.tourCount, 1);
  assert.match(result.anomalies[0].label, /Plusieurs comptages/);
});

test('les dates absentes, invalides ou contradictoires rendent le calcul incomplet', async () => {
  for (const date of [null, '2026-10-15', new Date(NaN), new Date('2026-11-15T09:00:00Z')]) {
    const id = await deliverer();
    await insertTour(id, { counting: { countedAt: date } });
    assert.equal((await read(id)).complete, false);
  }
  const id = await deliverer();
  await insertTour(id, { tour: { countedAt: null }, counting: { countedAt: null } });
  for (const selectedMonth of ['2026-09', '2026-10', '2026-11']) {
    const result = await read(id, selectedMonth);
    assert.equal(result.complete, false);
    assert.equal(result.anomalies[0].monthUnknown, true);
  }
  const missingCopy = await deliverer();
  await insertTour(missingCopy, { tour: { countedAt: null } });
  assert.equal((await read(missingCopy)).complete, true);
});

test('un comptage corrompu dans un autre mois connu ne dégrade pas le mois demandé', async () => {
  const id = await deliverer();
  await insertTour(id);
  await insertTour(id, { tour: { countedAt: new Date('2026-09-15T09:00:00Z') }, counting: { countedAt: new Date('2026-09-15T09:00:00Z'), lines: [] } });
  assert.equal((await read(id)).complete, true);
  assert.equal((await read(id)).salesInCentimes, 1000);
  assert.equal((await read(id, '2026-09')).complete, false);
});

test('les dépassements numériques produisent un calcul incomplet', async () => {
  const id = await deliverer();
  const large = 5_000_000_000_000_000;
  for (let index = 0; index < 2; index += 1) await insertTour(id, { counting: {
    lines: [line({ quantityInBaseUnits: 1, returnedQuantityInBaseUnits: 0, soldQuantityInBaseUnits: 1,
      amountDueInCentimes: large, salePriceAtLoading: { amountInCentimes: large, currency: 'DZD', taxIncluded: true, unit: 'PIECE' } })],
    totalDueInCentimes: large,
  } });
  const result = await read(id);
  assert.equal(result.complete, false);
  assert.equal(result.salesInCentimes, null);
  assert.equal(result.knownSalesInCentimes, null);
  assert.match(result.anomalies[0].label, /limite numérique/);
});

test('la lecture exige le droit objectifs et valide le mois et le livreur', async () => {
  const id = await deliverer();
  const unauthorized = new ObjectId();
  await database.collection('users').insertOne({ _id: unauthorized, active: true, roleIds: [] });
  await assert.rejects(read(id, month, unauthorized), (error) => error instanceof PermissionDeniedError && error.permission === 'deliverers.objectives.read');
  assert.ok((await read(id, '2026-13')).errors.month);
  assert.equal((await read(new ObjectId())).notFound, true);
  assert.equal((await read('invalid')).notFound, true);
});
