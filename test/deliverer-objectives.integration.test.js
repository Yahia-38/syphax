import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const testUri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax');
testUri.pathname = `/syphax_objectives_${process.pid}_${randomUUID().replaceAll('-', '')}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError, grantYahiaFullAccessPermission } = await import('../lib/access.js');
const { getObjectiveCurrentMonth, resolveDelivererObjective } = await import('../lib/deliverer-objective-calculations.js');
const { getDelivererObjectives, updateDelivererObjective, validateDelivererObjective } = await import('../lib/deliverer-objectives.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
const authorId = new ObjectId();
const currentMonth = getObjectiveCurrentMonth();
const laterMonth = (offset) => {
  const date = new Date(`${currentMonth}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};

before(async () => {
  database = await getDatabase();
  const roleId = new ObjectId();
  await database.collection('roles').insertOne({ _id: roleId, permissions: ['deliverers.objectives.read', 'deliverers.objectives.update'] });
  await database.collection('users').insertOne({ _id: authorId, username: 'responsable-objectifs', active: true, roleIds: [roleId] });
});
after(async () => {
  if (database) await database.dropDatabase();
  await closeMongoConnection();
});

const insertDeliverer = async (fields = {}) => {
  const _id = new ObjectId();
  await database.collection('deliverers').insertOne({ _id, active: true, name: 'Livreur objectifs', ...fields });
  return _id.toString();
};
const read = (delivererId, params = {}) => getDelivererObjectives({ delivererId, userId: authorId.toString(), ...params });
const save = (delivererId, amount, effectiveMonth, expectedVersion) => updateDelivererObjective({
  delivererId, amount, effectiveMonth, expectedVersion, updatedBy: authorId.toString(),
});

test('un livreur existant reste sans objectif et sans migration à la lecture', async () => {
  const id = await insertDeliverer();
  const result = await read(id);
  assert.equal(result.current, null);
  assert.equal(result.next, null);
  assert.equal(result.version, 0);
  assert.deepEqual(result.history, []);
  const stored = await database.collection('deliverers').findOne({ _id: new ObjectId(id) });
  assert.equal('objectiveHistory' in stored, false);
  assert.equal('objectiveVersion' in stored, false);
});

test('un objectif futur se répète à partir de son mois, avec auteur et date serveur', async () => {
  const id = await insertDeliverer();
  const started = new Date();
  assert.equal((await save(id, '150000,25', laterMonth(1), 0)).changed, true);
  const result = await read(id);
  assert.equal(result.current, null);
  assert.equal(result.next.amountInCentimes, 15_000_025);
  assert.equal(result.next.effectiveMonth, laterMonth(1));
  assert.equal(result.next.changedBy, 'responsable-objectifs');
  assert.ok(new Date(result.next.changedAt) >= started);
  const stored = await database.collection('deliverers').findOne({ _id: new ObjectId(id) });
  assert.ok(stored.objectiveHistory[0].changedBy.equals(authorId));
  assert.equal(resolveDelivererObjective(stored.objectiveHistory, currentMonth), null);
  assert.equal(resolveDelivererObjective(stored.objectiveHistory, laterMonth(20)).amountInCentimes, 15_000_025);
});

test('les révisions conservent les mois passés et les changements futurs déjà programmés', async () => {
  const pastMonth = laterMonth(-1);
  const id = await insertDeliverer({ objectiveVersion: 1, objectiveHistory: [{
    version: 1, amountInCentimes: 10_000_000, effectiveMonth: pastMonth, changedAt: new Date(), changedBy: authorId,
  }] });
  await save(id, '300000', laterMonth(2), 1);
  await save(id, '200000', currentMonth, 2);
  await save(id, '250000', currentMonth, 3);
  const stored = await database.collection('deliverers').findOne({ _id: new ObjectId(id) });
  const value = (month) => resolveDelivererObjective(stored.objectiveHistory, month)?.amountInCentimes;
  assert.equal(value(pastMonth), 10_000_000);
  assert.equal(value(currentMonth), 25_000_000);
  assert.equal(value(laterMonth(1)), 25_000_000);
  assert.equal(value(laterMonth(2)), 30_000_000);
  assert.equal(stored.objectiveHistory.length, 4);
  assert.equal(stored.objectiveHistory[3].previousAmountInCentimes, 20_000_000);
  const result = await read(id);
  assert.equal(result.current.amountInCentimes, 25_000_000);
  assert.equal(result.next.amountInCentimes, 30_000_000);
});

test('les montants invalides et les modifications rétroactives ne créent aucune trace', async () => {
  const id = await insertDeliverer();
  for (const amount of ['', '0', '-1', '12.345', 'abc', '90071992547410']) {
    assert.ok((await save(id, amount, currentMonth, 0)).errors.amount);
  }
  for (const month of ['', '2026-13', '2026-00', '2026-9', '0000-01', laterMonth(-1)]) {
    assert.ok((await save(id, '1000', month, 0)).errors.effectiveMonth);
  }
  assert.equal(validateDelivererObjective({ amount: '90071992547409.91', effectiveMonth: currentMonth }).data.amountInCentimes, Number.MAX_SAFE_INTEGER);
  const stored = await database.collection('deliverers').findOne({ _id: new ObjectId(id) });
  assert.equal('objectiveHistory' in stored, false);
});

test('une confirmation identique ne crée pas une révision supplémentaire', async () => {
  const id = await insertDeliverer();
  await save(id, '1000.25', currentMonth, 0);
  assert.equal((await save(id, '1000,25', currentMonth, 1)).changed, false);
  const result = await read(id);
  assert.equal(result.version, 1);
  assert.equal(result.history.length, 1);
});

test('deux mises à jour concurrentes ne peuvent pas écraser leurs objectifs', async () => {
  const id = await insertDeliverer();
  const results = await Promise.all([save(id, '1000', currentMonth, 0), save(id, '2000', currentMonth, 0)]);
  assert.equal(results.filter(({ changed }) => changed).length, 1);
  assert.equal(results.filter(({ stale }) => stale).length, 1);
  assert.equal((await read(id)).history.length, 1);
  assert.equal((await save(id, '3000', currentMonth, 0)).stale, true);
  assert.equal((await save(id, '3000', currentMonth, null)).stale, true);
});

test('une version initiale explicite à zéro reste modifiable sans écrasement concurrent', async () => {
  const id = await insertDeliverer({ objectiveVersion: 0, objectiveHistory: [] });
  const results = await Promise.all([save(id, '1000', currentMonth, 0), save(id, '2000', currentMonth, 0)]);
  assert.equal(results.filter(({ changed }) => changed).length, 1);
  assert.equal(results.filter(({ stale }) => stale).length, 1);
  const result = await read(id);
  assert.equal(result.version, 1);
  assert.equal(result.history.length, 1);
  assert.equal((await save(id, '3000', currentMonth, 0)).stale, true);
  assert.equal((await save(id, '3000', currentMonth, 1)).changed, true);
  assert.equal((await read(id)).version, 2);
});

test('les versions absentes, mal formées ou trop élevées ne créent aucune révision', async () => {
  const id = await insertDeliverer();
  for (const version of [undefined, null, -1, 0.5, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await save(id, '1000', currentMonth, version)).stale, true);
  }
  const stored = await database.collection('deliverers').findOne({ _id: new ObjectId(id) });
  assert.equal('objectiveHistory' in stored, false);
  assert.equal('objectiveVersion' in stored, false);
});

test('la validation du mois refuse les modifications rétroactives à la frontière algérienne', () => {
  const input = { amount: '0.01', effectiveMonth: '2026-09' };
  assert.equal(validateDelivererObjective(input, getObjectiveCurrentMonth(new Date('2026-09-30T22:59:59Z'))).data.amountInCentimes, 1);
  assert.ok(validateDelivererObjective(input, getObjectiveCurrentMonth(new Date('2026-09-30T23:00:00Z'))).errors.effectiveMonth);
  assert.ok(validateDelivererObjective({ amount: '100', effectiveMonth: '2026-12' }, getObjectiveCurrentMonth(new Date('2026-12-31T23:00:00Z'))).errors.effectiveMonth);
});

test('l’historique est paginé, recherchable par auteur et montant et filtrable par mois', async () => {
  const id = await insertDeliverer();
  for (let index = 0; index < 7; index += 1) await save(id, String(1000 + index), laterMonth(index), index);
  const first = await read(id);
  const second = await read(id, { objectivePage: 2 });
  assert.equal(first.history.length, 5);
  assert.equal(first.totalItems, 7);
  assert.equal(first.totalPages, 2);
  assert.equal(second.history.length, 2);
  assert.equal((await read(id, { objectivePage: 999 })).objectivePage, 2);
  assert.equal((await read(id, { objectiveQuery: '1003' })).totalItems, 1);
  assert.equal((await read(id, { objectiveQuery: 'responsable-objectifs' })).totalItems, 7);
  assert.equal((await read(id, { objectiveMonth: laterMonth(3) })).totalItems, 1);
  assert.equal((await read(id, { objectiveQuery: 'introuvable' })).totalItems, 0);
});

test('lecture et modification exigent leurs permissions dédiées', async () => {
  const id = await insertDeliverer();
  for (const permissions of [[], ['deliverers.objectives.read'], ['deliverers.objectives.update']]) {
    const userId = new ObjectId();
    const roleId = new ObjectId();
    await database.collection('roles').insertOne({ _id: roleId, permissions });
    await database.collection('users').insertOne({ _id: userId, active: true, roleIds: [roleId] });
    if (!permissions.includes('deliverers.objectives.read')) await assert.rejects(
      getDelivererObjectives({ delivererId: id, userId: userId.toString() }),
      (error) => error instanceof PermissionDeniedError && error.permission === 'deliverers.objectives.read',
    );
    if (!permissions.includes('deliverers.objectives.update')) await assert.rejects(
      updateDelivererObjective({ delivererId: id, amount: '1000', effectiveMonth: currentMonth, expectedVersion: 0, updatedBy: userId.toString() }),
      (error) => error instanceof PermissionDeniedError && error.permission === 'deliverers.objectives.update',
    );
  }
  assert.equal((await read(id)).version, 0);
  assert.equal((await read('invalid')).notFound, true);
  assert.equal((await read(new ObjectId().toString())).notFound, true);
});

test('les nouvelles permissions sont attribuées uniquement au rôle dédié de yahia', async () => {
  const roleId = new ObjectId();
  const sharedRoleId = new ObjectId();
  await database.collection('roles').insertMany([
    { _id: roleId, key: 'yahia-full-access', permissions: [] },
    { _id: sharedRoleId, key: 'manager', permissions: ['deliverers.read'] },
  ]);
  await database.collection('users').insertOne({ username: 'yahia', active: true, roleIds: [roleId] });
  const otherUserId = new ObjectId();
  await database.collection('users').insertOne({ _id: otherUserId, username: 'autre-compte', active: true, roleIds: [sharedRoleId] });
  for (const permission of ['deliverers.objectives.read', 'deliverers.objectives.update']) await grantYahiaFullAccessPermission(permission);
  assert.deepEqual((await database.collection('roles').findOne({ _id: roleId })).permissions, ['deliverers.objectives.read', 'deliverers.objectives.update']);
  assert.deepEqual((await database.collection('roles').findOne({ _id: sharedRoleId })).permissions, ['deliverers.read']);
  assert.deepEqual((await database.collection('users').findOne({ _id: otherUserId })).roleIds, [sharedRoleId]);
  for (const permission of ['deliverers.objectives.read', 'deliverers.objectives.update']) {
    assert.equal((await grantYahiaFullAccessPermission(permission)).granted, false);
  }
  assert.deepEqual((await database.collection('roles').findOne({ _id: roleId })).permissions, ['deliverers.objectives.read', 'deliverers.objectives.update']);
});
