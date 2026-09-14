import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_deliverers_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { createDeliverer, listDeliverers } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

let database;
let readerId;

before(async () => {
  database = await getDatabase();
  const roleId = new ObjectId();
  readerId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      permissions: ['deliverers.read'],
    }),
    database.collection('users').insertOne({
      _id: readerId,
      active: true,
      roleIds: [roleId],
      username: 'lecteur-livreurs',
    }),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

test('n’écrit aucun document lorsque les données sont invalides', async () => {
  const result = await createDeliverer({
    code: 'CODE INTERDIT',
    name: '   ',
    phone: '0'.repeat(31),
    createdBy: new ObjectId().toString(),
  });

  assert.deepEqual(Object.keys(result.errors).sort(), ['code', 'name', 'phone']);
  assert.equal(await database.collection('deliverers').countDocuments({}), 0);
});

test('enregistre les données métier et les métadonnées serveur', async () => {
  const authorId = new ObjectId();
  const result = await createDeliverer({
    code: '  liv-001  ',
    name: '  Amine Benali  ',
    phone: '  +213 550 00 00 00  ',
    createdBy: authorId.toString(),
  });

  assert.deepEqual(result.deliverer, {
    id: result.deliverer.id,
    code: 'LIV-001',
    name: 'Amine Benali',
    phone: '+213 550 00 00 00',
  });

  const deliverer = await database.collection('deliverers').findOne({
    _id: new ObjectId(result.deliverer.id),
  });

  assert.deepEqual(Object.keys(deliverer).sort(), [
    '_id',
    'code',
    'createdAt',
    'createdBy',
    'name',
    'phone',
  ]);
  assert.ok(deliverer.createdAt instanceof Date);
  assert.ok(deliverer.createdBy.equals(authorId));
});

test('empêche deux créations concurrentes avec le même code normalisé', async () => {
  const authorId = new ObjectId().toString();
  const results = await Promise.all([
    createDeliverer({
      code: '  liv-concurrent  ',
      name: 'Premier livreur',
      phone: '',
      createdBy: authorId,
    }),
    createDeliverer({
      code: 'LIV-CONCURRENT',
      name: 'Deuxième livreur',
      phone: '0550 00 00 00',
      createdBy: authorId,
    }),
  ]);

  assert.equal(results.filter((result) => result.deliverer).length, 1);
  assert.equal(
    results.filter(
      (result) => result.errors?.code === 'Un livreur avec ce code existe déjà.',
    ).length,
    1,
  );
  assert.equal(
    await database.collection('deliverers').countDocuments({
      code: 'LIV-CONCURRENT',
    }),
    1,
  );

  const uniqueIndex = (await database.collection('deliverers').indexes()).find(
    (index) => index.name === 'unique_deliverer_code',
  );

  assert.equal(uniqueIndex.unique, true);
  assert.deepEqual(uniqueIndex.key, { code: 1 });
});

test('recherche les livreurs par code ou nom sans interpréter les expressions régulières', async () => {
  const authorId = new ObjectId();

  await database.collection('deliverers').insertMany([
    {
      code: 'RECHERCHE-NORD',
      name: 'Livreur principal',
      phone: '0550 01 01 01',
      createdAt: new Date(),
      createdBy: authorId,
    },
    {
      code: 'RECHERCHE-SUD',
      name: 'Équipe [Centre]',
      phone: '',
      createdAt: new Date(),
      createdBy: authorId,
    },
    {
      code: 'RECHERCHE-EST',
      name: 'Livreur secondaire',
      phone: '',
      createdAt: new Date(),
      createdBy: authorId,
    },
  ]);

  const byCode = await listDeliverers({
    query: 'recherche-nord',
    userId: readerId.toString(),
  });
  const byName = await listDeliverers({
    query: '[centre]',
    userId: readerId.toString(),
  });

  assert.deepEqual(byCode.deliverers.map(({ code }) => code), [
    'RECHERCHE-NORD',
  ]);
  assert.deepEqual(byName.deliverers.map(({ code }) => code), [
    'RECHERCHE-SUD',
  ]);
  assert.equal(byName.totalItems, 1);
});

test('pagine côté serveur avec un tri stable et borne les pages trop élevées', async () => {
  const authorId = new ObjectId();

  await database.collection('deliverers').insertMany(
    Array.from({ length: 23 }, (_, index) => ({
      code: `PAGE-${String(index + 1).padStart(3, '0')}`,
      name: `Livreur page ${index + 1}`,
      phone: '',
      createdAt: new Date(),
      createdBy: authorId,
    })),
  );

  const secondPage = await listDeliverers({
    page: 2,
    pageSize: 10,
    query: 'PAGE-',
    userId: readerId.toString(),
  });

  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.pageSize, 10);
  assert.equal(secondPage.totalItems, 23);
  assert.equal(secondPage.totalPages, 3);
  assert.deepEqual(secondPage.deliverers.map(({ code }) => code), [
    'PAGE-011',
    'PAGE-012',
    'PAGE-013',
    'PAGE-014',
    'PAGE-015',
    'PAGE-016',
    'PAGE-017',
    'PAGE-018',
    'PAGE-019',
    'PAGE-020',
  ]);

  const boundedPage = await listDeliverers({
    page: 99,
    pageSize: 10,
    query: 'PAGE-',
    userId: readerId.toString(),
  });

  assert.equal(boundedPage.page, 3);
  assert.deepEqual(boundedPage.deliverers.map(({ code }) => code), [
    'PAGE-021',
    'PAGE-022',
    'PAGE-023',
  ]);
});
