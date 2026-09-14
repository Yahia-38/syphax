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

const {
  buildDelivererListHref,
  createDeliverer,
  deactivateDeliverer,
  getDelivererById,
  listDeliverers,
  reactivateDeliverer,
  readDelivererListState,
  updateDeliverer,
  validateDelivererListHref,
} = await import('../lib/deliverers.js');
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
    active: true,
    code: 'LIV-001',
    name: 'Amine Benali',
    phone: '+213 550 00 00 00',
  });

  const deliverer = await database.collection('deliverers').findOne({
    _id: new ObjectId(result.deliverer.id),
  });

  assert.deepEqual(Object.keys(deliverer).sort(), [
    '_id',
    'active',
    'code',
    'createdAt',
    'createdBy',
    'name',
    'phone',
  ]);
  assert.ok(deliverer.createdAt instanceof Date);
  assert.ok(deliverer.createdBy.equals(authorId));
  assert.equal(deliverer.active, true);
});

test('retourne la fiche du livreur et le nom de son créateur', async () => {
  const createdAt = new Date('2026-09-14T08:15:00.000Z');
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    code: 'FICHE-001',
    name: 'Livreur de consultation',
    phone: '',
    createdAt,
    createdBy: readerId,
  });

  assert.deepEqual(
    await getDelivererById(delivererId.toString(), {
      userId: readerId.toString(),
    }),
    {
      id: delivererId.toString(),
      active: true,
      code: 'FICHE-001',
      name: 'Livreur de consultation',
      phone: '',
      createdAt: createdAt.toISOString(),
      createdBy: 'lecteur-livreurs',
      updatedAt: null,
      updatedBy: null,
      statusHistory: [],
    },
  );
});

test('désactive et réactive explicitement un ancien livreur avec un historique idempotent', async () => {
  const delivererId = new ObjectId();
  const updaterId = new ObjectId();
  const createdAt = new Date('2026-09-10T08:00:00.000Z');

  await Promise.all([
    database.collection('users').insertOne({
      _id: updaterId,
      username: 'responsable-statut-livreurs',
    }),
    database.collection('deliverers').insertOne({
      _id: delivererId,
      code: 'STATUT-ANCIEN',
      name: 'Livreur sans statut historique',
      phone: '0550 10 10 10',
      createdAt,
      createdBy: readerId,
    }),
  ]);

  const startedAt = new Date();
  const firstDeactivation = await deactivateDeliverer({
    changedBy: updaterId.toString(),
    delivererId: delivererId.toString(),
  });
  const repeatedDeactivation = await deactivateDeliverer({
    changedBy: updaterId.toString(),
    delivererId: delivererId.toString(),
  });
  const firstReactivation = await reactivateDeliverer({
    changedBy: updaterId.toString(),
    delivererId: delivererId.toString(),
  });
  const repeatedReactivation = await reactivateDeliverer({
    changedBy: updaterId.toString(),
    delivererId: delivererId.toString(),
  });
  const storedDeliverer = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.deepEqual(firstDeactivation, { active: false, changed: true });
  assert.deepEqual(repeatedDeactivation, { active: false, changed: false });
  assert.deepEqual(firstReactivation, { active: true, changed: true });
  assert.deepEqual(repeatedReactivation, { active: true, changed: false });
  assert.equal(storedDeliverer.active, true);
  assert.equal(storedDeliverer.code, 'STATUT-ANCIEN');
  assert.equal(storedDeliverer.name, 'Livreur sans statut historique');
  assert.equal(storedDeliverer.phone, '0550 10 10 10');
  assert.equal(storedDeliverer.createdAt.getTime(), createdAt.getTime());
  assert.ok(storedDeliverer.createdBy.equals(readerId));
  assert.equal(storedDeliverer.statusHistory.length, 2);
  assert.deepEqual(
    storedDeliverer.statusHistory.map(({ active }) => active),
    [false, true],
  );
  assert.ok(storedDeliverer.statusHistory[0].changedAt >= startedAt);
  assert.ok(storedDeliverer.statusHistory[1].changedAt >= startedAt);
  assert.ok(storedDeliverer.statusHistory.every(({ changedBy }) =>
    changedBy.equals(updaterId)));

  const detail = await getDelivererById(delivererId.toString(), {
    userId: readerId.toString(),
  });

  assert.equal(detail.active, true);
  assert.deepEqual(
    detail.statusHistory.map(({ active, changedBy }) => ({ active, changedBy })),
    [
      { active: false, changedBy: 'responsable-statut-livreurs' },
      { active: true, changedBy: 'responsable-statut-livreurs' },
    ],
  );
});

test('filtre les actifs, les désactivés et tous en traitant le statut absent comme actif', async () => {
  await database.collection('deliverers').insertMany([
    {
      code: 'FILTRE-STATUT-ANCIEN',
      name: 'Ancien actif',
      phone: '',
      createdAt: new Date(),
      createdBy: readerId,
    },
    {
      active: true,
      code: 'FILTRE-STATUT-ACTIF',
      name: 'Actif explicite',
      phone: '',
      createdAt: new Date(),
      createdBy: readerId,
    },
    {
      active: false,
      code: 'FILTRE-STATUT-DESACTIVE',
      name: 'Désactivé',
      phone: '',
      createdAt: new Date(),
      createdBy: readerId,
    },
  ]);

  const active = await listDeliverers({
    query: 'FILTRE-STATUT-',
    userId: readerId.toString(),
  });
  const disabled = await listDeliverers({
    query: 'FILTRE-STATUT-',
    status: 'disabled',
    userId: readerId.toString(),
  });
  const all = await listDeliverers({
    query: 'FILTRE-STATUT-',
    status: 'all',
    userId: readerId.toString(),
  });

  assert.deepEqual(active.deliverers.map(({ code }) => code), [
    'FILTRE-STATUT-ACTIF',
    'FILTRE-STATUT-ANCIEN',
  ]);
  assert.ok(active.deliverers.every(({ active: isActive }) => isActive));
  assert.deepEqual(disabled.deliverers.map(({ code }) => code), [
    'FILTRE-STATUT-DESACTIVE',
  ]);
  assert.equal(disabled.deliverers[0].active, false);
  assert.equal(all.totalItems, 3);
});

test('préserve recherche, statut et pagination dans les URL de liste validées', () => {
  const state = readDelivererListState({
    page: '3',
    q: '  Atlas  ',
    statut: 'disabled',
  });

  assert.deepEqual(state, {
    page: 3,
    query: 'Atlas',
    status: 'disabled',
  });
  assert.equal(
    buildDelivererListHref(state),
    '/livreurs?q=Atlas&statut=disabled&page=3',
  );
  assert.equal(
    validateDelivererListHref('/livreurs?q=Atlas&statut=disabled&page=3'),
    '/livreurs?q=Atlas&statut=disabled&page=3',
  );
  assert.equal(
    validateDelivererListHref('/livreurs?statut=inconnu&page=2'),
    '/livreurs?page=2',
  );
});

test('modifie les informations sans altérer les métadonnées de création', async () => {
  const delivererId = new ObjectId();
  const updaterId = new ObjectId();
  const createdAt = new Date('2026-09-13T07:30:00.000Z');

  await Promise.all([
    database.collection('users').insertOne({
      _id: updaterId,
      username: 'modificateur-livreurs',
    }),
    database.collection('deliverers').insertOne({
      _id: delivererId,
      code: 'LIV-INCHANGE',
      name: 'Nom initial',
      phone: '0550 00 00 00',
      createdAt,
      createdBy: readerId,
    }),
  ]);

  const startedAt = new Date();
  const result = await updateDeliverer({
    delivererId: delivererId.toString(),
    code: ' liv-inchange ',
    name: ' Nom actualisé ',
    phone: ' 0770 00 00 00 ',
    updatedBy: updaterId.toString(),
  });
  const storedDeliverer = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.deepEqual(result.deliverer, {
    id: delivererId.toString(),
    code: 'LIV-INCHANGE',
    name: 'Nom actualisé',
    phone: '0770 00 00 00',
  });
  assert.equal(storedDeliverer._id.toString(), delivererId.toString());
  assert.equal(storedDeliverer.createdAt.getTime(), createdAt.getTime());
  assert.ok(storedDeliverer.createdBy.equals(readerId));
  assert.ok(storedDeliverer.updatedAt >= startedAt);
  assert.ok(storedDeliverer.updatedBy.equals(updaterId));

  const detail = await getDelivererById(delivererId.toString(), {
    userId: readerId.toString(),
  });

  assert.equal(detail.updatedAt, storedDeliverer.updatedAt.toISOString());
  assert.equal(detail.updatedBy, 'modificateur-livreurs');
});

test('refuse un code déjà utilisé sans modifier le livreur', async () => {
  const updaterId = new ObjectId();
  const firstId = new ObjectId();
  const secondId = new ObjectId();

  await database.collection('deliverers').insertMany([
    {
      _id: firstId,
      code: 'LIV-UNIQUE-A',
      name: 'Livreur A',
      phone: '',
      createdAt: new Date(),
      createdBy: readerId,
    },
    {
      _id: secondId,
      code: 'LIV-UNIQUE-B',
      name: 'Livreur B',
      phone: '',
      createdAt: new Date(),
      createdBy: readerId,
    },
  ]);

  const result = await updateDeliverer({
    delivererId: secondId.toString(),
    code: ' liv-unique-a ',
    name: 'Livreur remplacé',
    phone: '0555',
    updatedBy: updaterId.toString(),
  });
  const unchanged = await database.collection('deliverers').findOne({
    _id: secondId,
  });

  assert.equal(result.errors.code, 'Un livreur avec ce code existe déjà.');
  assert.equal(unchanged.code, 'LIV-UNIQUE-B');
  assert.equal(unchanged.name, 'Livreur B');
  assert.equal(unchanged.updatedAt, undefined);
  assert.equal(unchanged.updatedBy, undefined);
});

test('n’écrit rien pour une modification invalide ou un livreur absent', async () => {
  const updaterId = new ObjectId().toString();
  const countBefore = await database.collection('deliverers').countDocuments();
  const invalid = await updateDeliverer({
    delivererId: new ObjectId().toString(),
    code: 'CODE INTERDIT',
    name: '   ',
    phone: '0'.repeat(31),
    updatedBy: updaterId,
  });
  const missing = await updateDeliverer({
    delivererId: new ObjectId().toString(),
    code: 'LIV-ABSENT',
    name: 'Livreur absent',
    phone: '',
    updatedBy: updaterId,
  });

  assert.deepEqual(Object.keys(invalid.errors).sort(), ['code', 'name', 'phone']);
  assert.deepEqual(missing, { notFound: true });
  assert.equal(
    await database.collection('deliverers').countDocuments(),
    countBefore,
  );
});

test('renvoie une absence pour un identifiant invalide ou inconnu', async () => {
  const options = { userId: readerId.toString() };

  assert.equal(await getDelivererById('identifiant-invalide', options), null);
  assert.equal(
    await getDelivererById(new ObjectId().toString(), options),
    null,
  );
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
