import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_da_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { workAsyncStorage } = await import(
  'next/dist/server/app-render/work-async-storage.external.js'
);
const { workUnitAsyncStorage } = await import(
  'next/dist/server/app-render/work-unit-async-storage.external.js'
);
const { RequestCookies } = await import(
  'next/dist/server/web/spec-extension/cookies.js'
);
const { PermissionDeniedError } = await import('../lib/access.js');
const { getObjectiveCurrentMonth } = await import('../lib/deliverer-objective-calculations.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const {
  getDelivererById,
  listDeliverers,
  requireDelivererEditPermission,
} = await import('../lib/deliverers.js');
const { requirePermission } = await import('../lib/sessions.js');
const { createDeliverer } = await import(
  '../app/(protected)/livreurs/nouveau/actions.js'
);
const {
  deactivateDeliverer,
  reactivateDeliverer,
  updateDeliverer,
  updateDelivererCreditLimit,
  updateDelivererObjective,
} = await import(
  '../app/(protected)/livreurs/[id]/actions.js'
);

let database;

before(async () => {
  database = await getDatabase();
});

after(async () => {
  if (database) {
    await database.dropDatabase();
  }

  await closeMongoConnection();
});

const createUserSession = async (username, permissions = []) => {
  const userId = new ObjectId();
  const roleId = new ObjectId();
  const token = randomBytes(32).toString('base64url');

  await Promise.all([
    database.collection('users').insertOne({
      _id: userId,
      username,
      active: true,
      roleIds: permissions.length > 0 ? [roleId] : [],
    }),
    ...(permissions.length > 0
      ? [database.collection('roles').insertOne({
          _id: roleId,
          permissions,
        })]
      : []),
    database.collection('sessions').insertOne({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }),
  ]);

  return { token, userId };
};

const callWithSession = async (token, callback) => {
  const cookies = new RequestCookies(new Headers({
    cookie: `syphax-session=${token}`,
  }));
  const requestStore = {
    type: 'request',
    phase: 'action',
    cookies,
    userspaceMutableCookies: cookies,
  };
  const workStore = {
    incrementalCache: {},
    route: '/livreurs/nouveau',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

test('la définition d’objectif refuse un utilisateur sans permission dédiée', async () => {
  const { token } = await createUserSession('objectif-lecture-seule', ['deliverers.read', 'deliverers.update', 'deliverers.objectives.read']);
  const formData = new FormData();
  formData.set('objectiveAmount', '100000');
  formData.set('objectiveEffectiveMonth', '2099-01');
  formData.set('objectiveExpectedVersion', '0');
  await assert.rejects(
    callWithSession(token, () => updateDelivererObjective(new ObjectId().toString(), { revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError && error.permission === 'deliverers.objectives.update',
  );
});

test('la définition d’objectif détermine sa date et son auteur depuis la session', async () => {
  const { token, userId } = await createUserSession('objectif-responsable', ['deliverers.objectives.update']);
  const delivererId = new ObjectId();
  await database.collection('deliverers').insertOne({ _id: delivererId, name: 'Livreur objectif action' });
  const formData = new FormData();
  formData.set('objectiveAmount', '100000');
  formData.set('objectiveEffectiveMonth', '2099-01');
  formData.set('objectiveExpectedVersion', '0');
  formData.set('updatedBy', new ObjectId().toString());
  formData.set('changedAt', '2000-01-01T00:00:00Z');
  const startedAt = new Date();
  const result = await callWithSession(token, () => updateDelivererObjective(delivererId.toString(), { revision: 0 }, formData));
  assert.equal(result.message, 'L’objectif mensuel a été enregistré.');
  assert.deepEqual(result.errors, {});
  const stored = await database.collection('deliverers').findOne({ _id: delivererId });
  assert.ok(stored.objectiveHistory[0].changedBy.equals(userId));
  assert.ok(stored.objectiveHistory[0].changedAt >= startedAt);
  await database.collection('deliverers').deleteOne({ _id: delivererId });
});

test('un appel direct d’objectif refuse les montants et mois invalides côté serveur', async () => {
  const { token } = await createUserSession('objectif-validation-serveur', ['deliverers.objectives.update']);
  const delivererId = new ObjectId();
  await database.collection('deliverers').insertOne({ _id: delivererId, name: 'Objectif validé côté serveur' });
  for (const [amount, month, field] of [
    ['0', '2099-01', 'amount'], ['-1', '2099-01', 'amount'], ['12.345', '2099-01', 'amount'],
    ['90071992547410', '2099-01', 'amount'], ['1000', '2099-13', 'effectiveMonth'], ['1000', '2000-01', 'effectiveMonth'],
  ]) {
    const data = new FormData();
    data.set('objectiveAmount', amount);
    data.set('objectiveEffectiveMonth', month);
    data.set('objectiveExpectedVersion', '0');
    const result = await callWithSession(token, () => updateDelivererObjective(delivererId.toString(), { revision: 0 }, data));
    assert.ok(result.errors[field]);
    assert.equal(result.message, null);
    assert.deepEqual(result.values, { amount, effectiveMonth: month });
  }
  const stored = await database.collection('deliverers').findOne({ _id: delivererId });
  assert.equal('objectiveHistory' in stored, false);
  assert.equal('objectiveVersion' in stored, false);
  await database.collection('deliverers').deleteOne({ _id: delivererId });
});

test('un appel direct avec une version périmée conserve la proposition et refuse tout écrasement', async () => {
  const { token, userId } = await createUserSession('objectif-conflit-serveur', ['deliverers.objectives.update']);
  const delivererId = new ObjectId();
  const currentMonth = getObjectiveCurrentMonth();
  const history = [{ version: 1, amountInCentimes: 100000, effectiveMonth: currentMonth, changedAt: new Date(), changedBy: userId }];
  await database.collection('deliverers').insertOne({ _id: delivererId, name: 'Conflit objectif', objectiveVersion: 1, objectiveHistory: history });
  for (const version of ['', '0', '-1', '1.5', 'invalide', '9007199254740992']) {
    const data = new FormData();
    data.set('objectiveAmount', '2000');
    data.set('objectiveEffectiveMonth', currentMonth);
    data.set('objectiveExpectedVersion', version);
    const result = await callWithSession(token, () => updateDelivererObjective(delivererId.toString(), { revision: 7 }, data));
    assert.equal(result.stale, true);
    assert.equal(result.revision, 8);
    assert.equal(result.message, null);
    assert.ok(result.errors.form);
    assert.deepEqual(result.values, { amount: '2000', effectiveMonth: currentMonth });
  }
  const unchanged = await database.collection('deliverers').findOne({ _id: delivererId });
  assert.equal(unchanged.objectiveVersion, 1);
  assert.deepEqual(unchanged.objectiveHistory, history);
  const reviewed = new FormData();
  reviewed.set('objectiveAmount', '2000');
  reviewed.set('objectiveEffectiveMonth', currentMonth);
  reviewed.set('objectiveExpectedVersion', '1');
  const saved = await callWithSession(token, () => updateDelivererObjective(delivererId.toString(), { revision: 8 }, reviewed));
  assert.equal(saved.stale, false);
  assert.equal(saved.revision, 9);
  assert.equal(saved.message, 'L’objectif mensuel a été enregistré.');
  assert.equal((await database.collection('deliverers').findOne({ _id: delivererId })).objectiveVersion, 2);
  await database.collection('deliverers').deleteOne({ _id: delivererId });
});

test('autorise la consultation avec deliverers.read', async () => {
  const { token, userId } = await createUserSession(
    'consultation-livreur-autorisee',
    ['deliverers.read'],
  );

  const session = await callWithSession(token, () =>
    requirePermission('deliverers.read'));
  const result = await listDeliverers({ userId: userId.toString() });

  assert.equal(session.username, 'consultation-livreur-autorisee');
  assert.deepEqual(result.deliverers, []);
});

test('refuse la consultation sans deliverers.read', async () => {
  const { token, userId } = await createUserSession(
    'creation-sans-consultation-livreur',
    ['deliverers.create'],
  );

  await assert.rejects(
    callWithSession(token, () => requirePermission('deliverers.read')),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
  await assert.rejects(
    listDeliverers({ userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
  await assert.rejects(
    getDelivererById(new ObjectId().toString(), {
      userId: userId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.read',
  );
});

test('refuse un appel direct sans deliverers.create', async () => {
  const { token } = await createUserSession('sans-creation-livreur');
  const formData = new FormData();

  formData.set('code', 'LIV-INTERDIT');
  formData.set('name', 'Création interdite');

  await assert.rejects(
    callWithSession(token, () =>
      createDeliverer({ revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.create',
  );
  assert.equal(await database.collection('deliverers').countDocuments({}), 0);
});

test('autorise la création et détermine les métadonnées depuis le serveur', async () => {
  const { token, userId } = await createUserSession(
    'creation-livreur-autorisee',
    ['deliverers.create'],
  );
  const formData = new FormData();

  formData.set('code', ' liv-autorise ');
  formData.set('name', ' Livreur autorisé ');
  formData.set('phone', ' 0550 00 00 00 ');
  formData.set('createdBy', new ObjectId().toString());
  formData.set('createdAt', '2000-01-01T00:00:00.000Z');

  const startedAt = new Date();
  const result = await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, formData));
  const deliverer = await database.collection('deliverers').findOne({
    code: 'LIV-AUTORISE',
  });

  assert.equal(
    result.message,
    'Le livreur LIV-AUTORISE a été créé avec succès.',
  );
  assert.deepEqual(result.values, { code: '', name: '', phone: '' });
  assert.deepEqual(result.deliverer, {
    id: deliverer._id.toString(), code: 'LIV-AUTORISE', name: 'Livreur autorisé', phone: '0550 00 00 00', active: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.deliverer)), result.deliverer);
  assert.equal(deliverer.name, 'Livreur autorisé');
  assert.equal(deliverer.phone, '0550 00 00 00');
  assert.ok(deliverer.createdBy.equals(userId));
  assert.ok(deliverer.createdAt >= startedAt);
});

test('conserve les valeurs soumises lorsque le code existe déjà', async () => {
  const { token } = await createUserSession(
    'creation-livreur-doublon',
    ['deliverers.create'],
  );
  const firstFormData = new FormData();

  firstFormData.set('code', 'LIV-DOUBLON');
  firstFormData.set('name', 'Premier livreur');
  await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, firstFormData));

  const duplicateFormData = new FormData();
  duplicateFormData.set('code', ' liv-doublon ');
  duplicateFormData.set('name', ' Deuxième livreur ');
  duplicateFormData.set('phone', ' 0770 00 00 00 ');

  const result = await callWithSession(token, () =>
    createDeliverer({ revision: 0 }, duplicateFormData));

  assert.equal(result.errors.code, 'Un livreur avec ce code existe déjà.');
  assert.equal(result.deliverer, undefined);
  assert.deepEqual(result.values, {
    code: ' liv-doublon ',
    name: ' Deuxième livreur ',
    phone: ' 0770 00 00 00 ',
  });
  assert.equal(
    await database.collection('deliverers').countDocuments({
      code: 'LIV-DOUBLON',
    }),
    1,
  );
});

test('autorise la modification et détermine sa traçabilité depuis la session', async () => {
  const { token, userId } = await createUserSession(
    'modification-livreur-autorisee',
    ['deliverers.read', 'deliverers.update'],
  );
  const delivererId = new ObjectId();
  const creatorId = new ObjectId();
  const createdAt = new Date('2026-09-13T09:00:00.000Z');

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    code: 'LIV-ACTION',
    name: 'Nom avant action',
    phone: '',
    createdAt,
    createdBy: creatorId,
  });

  const formData = new FormData();
  formData.set('code', ' liv-action ');
  formData.set('name', ' Nom après action ');
  formData.set('phone', ' 0550 12 34 56 ');
  formData.set('updatedBy', new ObjectId().toString());
  formData.set('updatedAt', '2000-01-01T00:00:00.000Z');
  const startedAt = new Date();

  const result = await callWithSession(token, () => updateDeliverer(
    delivererId.toString(),
    '/livreurs?q=action&page=2',
    { revision: 0 },
    formData,
  ));
  assert.equal(result.message, 'L’identification du livreur a été mise à jour.');
  assert.equal(result.revision, 1);
  assert.deepEqual(result.errors, {});

  const updated = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(updated.code, 'LIV-ACTION');
  assert.equal(updated.name, 'Nom après action');
  assert.equal(updated.phone, '0550 12 34 56');
  assert.equal(updated.createdAt.getTime(), createdAt.getTime());
  assert.ok(updated.createdBy.equals(creatorId));
  assert.ok(updated.updatedAt >= startedAt);
  assert.ok(updated.updatedBy.equals(userId));
});

test('conserve les valeurs de modification invalides ou en doublon', async () => {
  const { token, userId } = await createUserSession(
    'erreurs-modification-livreur',
    ['deliverers.update'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertMany([
    {
      _id: delivererId,
      code: 'LIV-A-MODIFIER',
      name: 'Livreur à modifier',
      phone: '',
      createdAt: new Date(),
      createdBy: userId,
    },
    {
      code: 'LIV-DEJA-UTILISE',
      name: 'Livreur existant',
      phone: '',
      createdAt: new Date(),
      createdBy: userId,
    },
  ]);

  const invalidFormData = new FormData();
  invalidFormData.set('code', ' CODE INTERDIT ');
  invalidFormData.set('name', '   ');
  invalidFormData.set('phone', ` ${'0'.repeat(31)} `);
  const invalidResult = await callWithSession(token, () =>
    updateDeliverer(
      delivererId.toString(),
      '/livreurs',
      { revision: 0 },
      invalidFormData,
    ));

  assert.deepEqual(Object.keys(invalidResult.errors).sort(), [
    'code',
    'name',
    'phone',
  ]);
  assert.deepEqual(invalidResult.values, {
    code: ' CODE INTERDIT ',
    name: '   ',
    phone: ` ${'0'.repeat(31)} `,
  });

  const duplicateFormData = new FormData();
  duplicateFormData.set('code', ' liv-deja-utilise ');
  duplicateFormData.set('name', ' Nouvelle valeur ');
  duplicateFormData.set('phone', ' 0770 ');
  const duplicateResult = await callWithSession(token, () =>
    updateDeliverer(
      delivererId.toString(),
      '/livreurs',
      invalidResult,
      duplicateFormData,
    ));

  assert.equal(
    duplicateResult.errors.code,
    'Un livreur avec ce code existe déjà.',
  );
  assert.deepEqual(duplicateResult.values, {
    code: ' liv-deja-utilise ',
    name: ' Nouvelle valeur ',
    phone: ' 0770 ',
  });

  const unchanged = await database.collection('deliverers').findOne({
    _id: delivererId,
  });
  assert.equal(unchanged.code, 'LIV-A-MODIFIER');
  assert.equal(unchanged.name, 'Livreur à modifier');
  assert.equal(unchanged.updatedAt, undefined);
  assert.equal(unchanged.updatedBy, undefined);
});

test('signale un livreur introuvable sans écrire', async () => {
  const { token } = await createUserSession(
    'modification-livreur-absent',
    ['deliverers.update'],
  );
  const missingId = new ObjectId().toString();
  const formData = new FormData();
  formData.set('code', 'LIV-ABSENT');
  formData.set('name', 'Livreur absent');
  const countBefore = await database.collection('deliverers').countDocuments();

  const result = await callWithSession(token, () =>
    updateDeliverer(
      missingId,
      '/livreurs',
      { revision: 0 },
      formData,
    ));

  assert.equal(result.errors.form, 'Ce livreur n’existe plus.');
  assert.deepEqual(result.values, {
    code: 'LIV-ABSENT',
    name: 'Livreur absent',
    phone: '',
  });
  assert.equal(
    await database.collection('deliverers').countDocuments(),
    countBefore,
  );
});

test('refuse la modification sans deliverers.update et n’écrit rien', async () => {
  const { token, userId } = await createUserSession(
    'sans-modification-livreur',
    ['deliverers.read'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    code: 'LIV-PROTEGE',
    name: 'Livreur protégé',
    phone: '',
    createdAt: new Date(),
    createdBy: userId,
  });

  const formData = new FormData();
  formData.set('code', 'LIV-INTERDIT');
  formData.set('name', 'Modification interdite');

  await assert.rejects(
    callWithSession(token, () =>
      updateDeliverer(
        delivererId.toString(),
        '/livreurs',
        { revision: 0 },
        formData,
      )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.update',
  );

  const unchanged = await database.collection('deliverers').findOne({
    _id: delivererId,
  });
  assert.equal(unchanged.code, 'LIV-PROTEGE');
  assert.equal(unchanged.name, 'Livreur protégé');
  assert.equal(unchanged.updatedAt, undefined);
  assert.equal(unchanged.updatedBy, undefined);
});

test('autorise la Server Action de limite et détermine son auteur côté serveur', async () => {
  const { token, userId } = await createUserSession(
    'limite-credit-autorisee',
    ['deliverers.credit-limit.update'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-LIMITE-ACTION',
    name: 'Livreur avec limite',
  });

  const formData = new FormData();

  formData.set('creditLimitAmount', '12500,75');
  formData.set('creditLimitExpectedVersion', '0');
  formData.set('updatedBy', new ObjectId().toString());
  formData.set('updatedAt', '2000-01-01T00:00:00.000Z');
  const startedAt = new Date();
  const result = await callWithSession(token, () =>
    updateDelivererCreditLimit(
      delivererId.toString(),
      { revision: 0 },
      formData,
    ));
  const stored = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(result.succeeded, true);
  assert.equal(result.message, 'La limite de crédit a été mise à jour.');
  assert.equal(stored.creditLimit.amountInCentimes, 1_250_075);
  assert.ok(stored.creditLimit.updatedBy.equals(userId));
  assert.ok(stored.creditLimit.updatedAt >= startedAt);
  assert.ok(stored.creditLimitHistory[0].changedBy.equals(userId));
});

test('refuse la Server Action de limite avec les droits livreur ou caisse génériques', async () => {
  const { token } = await createUserSession(
    'limite-credit-interdite',
    ['cash.payments.create', 'deliverers.read', 'deliverers.update'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-LIMITE-INTERDITE',
    name: 'Livreur sans droit limite',
  });

  const formData = new FormData();

  formData.set('creditLimitAmount', '5000');
  formData.set('creditLimitExpectedVersion', '0');

  await assert.rejects(
    callWithSession(token, () => updateDelivererCreditLimit(
      delivererId.toString(),
      { revision: 0 },
      formData,
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.credit-limit.update',
  );

  const unchanged = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal('creditLimit' in unchanged, false);
  assert.equal('creditLimitHistory' in unchanged, false);
  assert.ok(unchanged._id.equals(delivererId));
});

test('protège aussi l’ouverture directe du formulaire de modification', async () => {
  const { userId } = await createUserSession(
    'lecture-seule-fiche-livreur',
    ['deliverers.read'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    code: 'LIV-FORMULAIRE-PROTEGE',
    name: 'Formulaire protégé',
    phone: '',
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    requireDelivererEditPermission({
      editing: true,
      userId: userId.toString(),
    }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.update',
  );
});

test('désactive et réactive avec la traçabilité de session sans doubler les demandes', async () => {
  const { token, userId } = await createUserSession(
    'statut-livreur-autorise',
    ['deliverers.status.update'],
  );
  const delivererId = new ObjectId();
  const creatorId = new ObjectId();
  const createdAt = new Date('2026-09-12T10:00:00.000Z');

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    code: 'LIV-STATUT-ACTION',
    name: 'Livreur avec statut',
    phone: '0550 20 20 20',
    createdAt,
    createdBy: creatorId,
  });

  const callStatusAction = (action) => assert.rejects(
    callWithSession(token, () => action(
      delivererId.toString(),
      '/livreurs?q=statut&statut=all&page=2',
      { revision: 0 },
    )),
    (error) => typeof error?.digest === 'string'
      && error.digest.startsWith('NEXT_REDIRECT;'),
  );

  const startedAt = new Date();

  await callStatusAction(deactivateDeliverer);
  await callStatusAction(deactivateDeliverer);
  await callStatusAction(reactivateDeliverer);
  await callStatusAction(reactivateDeliverer);

  const deliverer = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(deliverer.active, true);
  assert.equal(deliverer.code, 'LIV-STATUT-ACTION');
  assert.equal(deliverer.name, 'Livreur avec statut');
  assert.equal(deliverer.phone, '0550 20 20 20');
  assert.equal(deliverer.createdAt.getTime(), createdAt.getTime());
  assert.ok(deliverer.createdBy.equals(creatorId));
  assert.equal(deliverer.statusHistory.length, 2);
  assert.deepEqual(
    deliverer.statusHistory.map(({ active }) => active),
    [false, true],
  );
  assert.ok(deliverer.statusHistory.every(({ changedAt, changedBy }) =>
    changedAt >= startedAt && changedBy.equals(userId)));
});

test('refuse un changement de statut sans permission et n’écrit rien', async () => {
  const { token, userId } = await createUserSession(
    'statut-livreur-interdit',
    ['deliverers.read', 'deliverers.update'],
  );
  const delivererId = new ObjectId();

  await database.collection('deliverers').insertOne({
    _id: delivererId,
    active: true,
    code: 'LIV-STATUT-PROTEGE',
    name: 'Statut protégé',
    phone: '',
    createdAt: new Date(),
    createdBy: userId,
  });

  await assert.rejects(
    callWithSession(token, () => deactivateDeliverer(
      delivererId.toString(),
      '/livreurs',
      { revision: 0 },
    )),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'deliverers.status.update',
  );

  const unchanged = await database.collection('deliverers').findOne({
    _id: delivererId,
  });

  assert.equal(unchanged.active, true);
  assert.equal(unchanged.statusHistory, undefined);
});


test('le changement de statut conserve la section et les filtres avec un retour validé', async () => {
  const { token, userId } = await createUserSession('statut-contexte', ['deliverers.status.update']);
  const delivererId = new ObjectId();
  await database.collection('deliverers').insertOne({ _id: delivererId, code: 'LIV-CONTEXTE', name: 'Contexte', createdBy: userId });
  const context = `/livreurs/${delivererId}?retour=%2Flivreurs%3Fq%3DAtlas%26page%3D2&onglet=identification&tourneeRecherche=TRN&tourneeDate=2026-09-14&tourneePage=3`;
  await assert.rejects(callWithSession(token, () => deactivateDeliverer(delivererId.toString(), context, { revision: 0 })),
    (error) => error.digest?.includes(context));
});
