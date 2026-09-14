import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_tours_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { PermissionDeniedError } = await import('../lib/access.js');
const { deactivateDeliverer } = await import('../lib/deliverers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  TOUR_STATUS_PREPARATION,
  buildDelivererToursHref,
  createTour,
  formatTourDateInput,
  getTourById,
  listToursByDeliverer,
  readDelivererTourListState,
  validateTourReturnHref,
} = await import('../lib/tours.js');

let database;
let readerId;

before(async () => {
  database = await getDatabase();
  const roleId = new ObjectId();
  readerId = new ObjectId();

  await Promise.all([
    database.collection('roles').insertOne({
      _id: roleId,
      permissions: ['tours.read'],
    }),
    database.collection('users').insertOne({
      _id: readerId,
      active: true,
      roleIds: [roleId],
      username: 'lecteur-tournees',
    }),
  ]);
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const insertDeliverer = async ({ active = true, code, name } = {}) => {
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active,
    code: code ?? `LIV-${delivererId.toHexString().slice(-6)}`,
    name: name ?? 'Livreur de tournée',
    phone: '',
    createdAt: new Date(),
    createdBy: readerId,
  });

  return delivererId;
};

test('crée une tournée vide avec les valeurs métier déterminées par le serveur', async () => {
  const delivererId = await insertDeliverer({
    code: 'LIV-SNAPSHOT',
    name: 'Nom au départ',
  });
  const creationKey = randomUUID();
  const stockBefore = await database.collection('stockMovements').countDocuments();
  const startedAt = new Date();
  const result = await createTour({
    createdBy: readerId.toString(),
    creationKey,
    delivererId: delivererId.toString(),
    plannedDate: '2026-09-14',
    reference: 'REF-NAVIGATEUR',
    status: 'CHARGEE',
  });
  const stored = await database.collection('tours').findOne({
    _id: new ObjectId(result.tour.id),
  });

  assert.equal(result.replayed, false);
  assert.match(result.tour.reference, /^TRN-[A-F\d]{24}$/u);
  assert.equal(result.tour.reference, stored.reference);
  assert.deepEqual(Object.keys(stored).sort(), [
    '_id',
    'createdAt',
    'createdBy',
    'creationKey',
    'delivererCode',
    'delivererId',
    'delivererName',
    'plannedDate',
    'reference',
    'status',
  ]);
  assert.ok(stored.delivererId.equals(delivererId));
  assert.equal(stored.delivererCode, 'LIV-SNAPSHOT');
  assert.equal(stored.delivererName, 'Nom au départ');
  assert.equal(stored.plannedDate.toISOString(), '2026-09-14T00:00:00.000Z');
  assert.equal(stored.status, TOUR_STATUS_PREPARATION);
  assert.ok(stored.createdAt >= startedAt);
  assert.ok(stored.createdBy.equals(readerId));
  assert.equal(stored.creationKey, creationKey);
  assert.equal(
    await database.collection('stockMovements').countDocuments(),
    stockBefore,
  );
  assert.equal(await database.collection('reservations').countDocuments(), 0);
});

test('refuse un livreur désactivé, un livreur inexistant et une date invalide', async () => {
  const inactiveDelivererId = await insertDeliverer({ active: false });
  const inactiveCreationKey = randomUUID();
  const missingCreationKey = randomUUID();
  const invalidDateCreationKey = randomUUID();
  const inactive = await createTour({
    createdBy: readerId.toString(),
    creationKey: inactiveCreationKey,
    delivererId: inactiveDelivererId.toString(),
    plannedDate: '2026-09-14',
  });
  const missing = await createTour({
    createdBy: readerId.toString(),
    creationKey: missingCreationKey,
    delivererId: new ObjectId().toString(),
    plannedDate: '2026-09-14',
  });
  const invalidDate = await createTour({
    createdBy: readerId.toString(),
    creationKey: invalidDateCreationKey,
    delivererId: inactiveDelivererId.toString(),
    plannedDate: '2026-02-30',
  });

  assert.equal(inactive.errors.delivererId, 'Ce livreur est désactivé.');
  assert.equal(missing.errors.delivererId, 'Ce livreur n’existe plus.');
  assert.equal(invalidDate.errors.plannedDate, 'Saisissez une date prévue valide.');
  assert.equal(await database.collection('tours').countDocuments({
    creationKey: {
      $in: [
        inactiveCreationKey,
        missingCreationKey,
        invalidDateCreationKey,
      ],
    },
  }), 0);
  assert.equal(await database.collection('tours').countDocuments({
    delivererId: { $in: [inactiveDelivererId] },
  }), 0);
});

test('rend deux créations concurrentes identiques idempotentes et refuse un autre contenu', async () => {
  const delivererId = await insertDeliverer();
  const creationKey = randomUUID();
  const request = {
    createdBy: readerId.toString(),
    creationKey,
    delivererId: delivererId.toString(),
    plannedDate: '2026-09-15',
  };
  const [first, second] = await Promise.all([
    createTour(request),
    createTour(request),
  ]);
  const conflict = await createTour({
    ...request,
    plannedDate: '2026-09-16',
  });
  const sameDelivererAndDate = await createTour({
    ...request,
    creationKey: randomUUID(),
  });

  assert.equal(first.tour.id, second.tour.id);
  assert.notEqual(first.replayed, second.replayed);
  assert.equal(await database.collection('tours').countDocuments({
    creationKey,
  }), 1);
  assert.notEqual(sameDelivererAndDate.tour.id, first.tour.id);
  assert.equal(await database.collection('tours').countDocuments({
    delivererId,
    plannedDate: new Date('2026-09-15T00:00:00.000Z'),
  }), 2);
  assert.equal(
    conflict.errors.form,
    'Cette demande a déjà été utilisée avec un contenu différent.',
  );
});

test('sérialise la création avec une désactivation concurrente du livreur', async () => {
  const delivererId = await insertDeliverer();
  const [creation] = await Promise.all([
    createTour({
      createdBy: readerId.toString(),
      creationKey: randomUUID(),
      delivererId: delivererId.toString(),
      plannedDate: '2026-09-17',
    }),
    deactivateDeliverer({
      changedBy: readerId.toString(),
      delivererId: delivererId.toString(),
    }),
  ]);
  const deliverer = await database.collection('deliverers').findOne({
    _id: delivererId,
  });
  const tours = await database.collection('tours').find({
    delivererId,
  }).toArray();

  assert.equal(deliverer.active, false);
  assert.ok(creation.tour || creation.errors?.delivererId);
  assert.equal(tours.length, creation.tour ? 1 : 0);
  if (creation.tour) {
    assert.equal(tours[0].delivererCode, deliverer.code);
    assert.equal(tours[0].delivererName, deliverer.name);
  } else {
    assert.equal(creation.errors.delivererId, 'Ce livreur est désactivé.');
  }
});

test('consulte une tournée après désactivation et protège lecture et absence', async () => {
  const delivererId = await insertDeliverer({
    code: 'LIV-HISTORIQUE',
    name: 'Livreur historique',
  });
  const creation = await createTour({
    createdBy: readerId.toString(),
    creationKey: randomUUID(),
    delivererId: delivererId.toString(),
    plannedDate: '2026-09-18',
  });

  await deactivateDeliverer({
    changedBy: readerId.toString(),
    delivererId: delivererId.toString(),
  });

  const detail = await getTourById(creation.tour.id, {
    userId: readerId.toString(),
  });
  const list = await listToursByDeliverer({
    delivererId: delivererId.toString(),
    userId: readerId.toString(),
  });
  const unauthorizedId = new ObjectId();

  await database.collection('users').insertOne({
    _id: unauthorizedId,
    active: true,
    roleIds: [],
    username: 'sans-lecture-tournees',
  });

  await assert.rejects(
    getTourById(creation.tour.id, { userId: unauthorizedId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'tours.read',
  );
  assert.equal(
    await getTourById(new ObjectId().toString(), {
      userId: readerId.toString(),
    }),
    null,
  );
  assert.equal(detail.delivererCode, 'LIV-HISTORIQUE');
  assert.equal(detail.delivererName, 'Livreur historique');
  assert.equal(detail.createdBy, 'lecteur-tournees');
  assert.equal(list.totalItems, 1);
  assert.equal(list.tours[0].id, creation.tour.id);
});

test('préserve recherche, filtre de date et pagination dans les liens de fiche', () => {
  const delivererId = new ObjectId().toString();
  const state = readDelivererTourListState({
    tourneeDate: '2026-09-14',
    tourneePage: '3',
    tourneeRecherche: '  TRN-ABC  ',
  });
  const href = buildDelivererToursHref({
    delivererId,
    ...state,
    returnHref: '/livreurs?q=Atlas&statut=all&page=2',
  });

  assert.deepEqual(state, {
    page: 3,
    plannedDate: '2026-09-14',
    query: 'TRN-ABC',
  });
  assert.equal(
    href,
    `/livreurs/${delivererId}?retour=%2Flivreurs%3Fq%3DAtlas%26statut%3Dall%26page%3D2&tourneeRecherche=TRN-ABC&tourneeDate=2026-09-14&tourneePage=3`,
  );
  assert.equal(validateTourReturnHref(href, delivererId), href);
  assert.equal(
    validateTourReturnHref('https://example.com', delivererId),
    `/livreurs/${delivererId}?retour=%2Flivreurs`,
  );
  assert.equal(
    formatTourDateInput(new Date('2026-09-13T23:30:00.000Z')),
    '2026-09-14',
  );
});
