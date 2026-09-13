import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_receptions_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');
const { getReceptionById, listReceptions } = await import(
  '../lib/reception-records.js'
);
const { deleteProduct, updateProduct } = await import('../lib/products.js');
const { removeSupplier } = await import('../lib/suppliers.js');
const { createReception } = await import(
  '../app/(protected)/receptions/actions.js'
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
    route: '/receptions',
  };

  return workAsyncStorage.run(workStore, () =>
    workUnitAsyncStorage.run(requestStore, callback));
};

const createReceptionFormData = ({
  lines,
  packagingId,
  productId,
  submissionKey = randomUUID(),
  supplierId,
  supplierReference = ' BL-2026-0042 ',
}) => {
  const formData = new FormData();

  formData.set('submissionKey', submissionKey);
  formData.set('supplierId', supplierId.toString());
  formData.set('receptionDate', '2026-09-13');
  formData.set('supplierReference', supplierReference);
  formData.set('lines', JSON.stringify(lines ?? [{
    baseUnit: 'BOUTEILLE',
    productId: productId.toString(),
    quantityMode: 'PACKAGING',
    packagingId: packagingId.toString(),
    packagingCount: '10',
    quantityInBaseUnits: 999,
  }]));

  return formData;
};

test('refuse un appel direct sans receptions.create', async () => {
  const { token } = await createUserSession('sans-creation-reception', [
    'receptions.read',
  ]);
  const formData = new FormData();

  await assert.rejects(
    callWithSession(token, () =>
      createReception({ revision: 0 }, formData)),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.create',
  );
  assert.equal(await database.collection('receptions').countDocuments({}), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({}), 0);
});

test('refuse la lecture d’une réception sans receptions.read', async () => {
  const { userId } = await createUserSession('sans-lecture-reception', [
    'receptions.create',
  ]);

  await assert.rejects(
    getReceptionById(new ObjectId().toString(), { userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.read',
  );
  await assert.rejects(
    listReceptions({ userId: userId.toString() }),
    (error) => error instanceof PermissionDeniedError
      && error.permission === 'receptions.read',
  );
});

test('renvoie une absence pour un identifiant invalide ou inconnu', async () => {
  const { userId } = await createUserSession('lecture-reception-absente', [
    'receptions.read',
  ]);
  const options = { userId: userId.toString() };

  assert.equal(await getReceptionById('identifiant-invalide', options), null);
  assert.equal(
    await getReceptionById(new ObjectId().toString(), options),
    null,
  );
});

test('enregistre une réception et la rend disponible dans l’historique', async () => {
  const { token, userId } = await createUserSession(
    'creation-reception-autorisee',
    ['receptions.create', 'receptions.read'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const packagingId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Distribution Atlas',
      normalizedName: 'distribution atlas',
      active: true,
      createdAt: new Date(),
      createdBy: userId,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'EAU-1L',
      designation: 'Eau 1 L',
      baseUnit: 'BOUTEILLE',
      packagings: [{
        _id: packagingId,
        label: 'Pack de 6',
        quantity: 6,
      }],
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const formData = createReceptionFormData({
    packagingId,
    productId,
    supplierId,
  });
  const result = await callWithSession(token, () =>
    createReception({ revision: 0 }, formData));
  const storedReception = await database.collection('receptions').findOne({
    supplierReference: 'BL-2026-0042',
  });
  const stockMovement = await database.collection('stockMovements').findOne({
    sourceReceptionId: storedReception._id,
  });
  const receptions = await listReceptions({ userId: userId.toString() });

  await Promise.all([
    database.collection('suppliers').updateOne(
      { _id: supplierId },
      { $set: { name: 'Distribution Atlas renommée' } },
    ),
    database.collection('products').updateOne(
      { _id: productId },
      {
        $set: {
          code: 'EAU-1L-NOUVEAU',
          designation: 'Eau renommée',
          'packagings.0.label': 'Nouveau pack',
          'packagings.0.quantity': 12,
        },
      },
    ),
  ]);
  const receptionDetail = await getReceptionById(
    storedReception._id.toString(),
    { userId: userId.toString() },
  );

  assert.equal(
    result.message,
    'La réception BL-2026-0042 a été enregistrée avec succès.',
  );
  assert.ok(storedReception.createdBy.equals(userId));
  assert.ok(storedReception.supplierId.equals(supplierId));
  assert.equal(storedReception.supplierName, 'Distribution Atlas');
  assert.equal(storedReception.lines[0].quantityInBaseUnits, 60);
  assert.equal(storedReception.lines[0].productCode, 'EAU-1L');
  assert.equal(storedReception.lines[0].packaging.count, 10);
  assert.ok(stockMovement.productId.equals(productId));
  assert.equal(stockMovement.baseUnit, 'BOUTEILLE');
  assert.equal(stockMovement.kind, 'RECEPTION_IN');
  assert.equal(stockMovement.quantityDeltaInBaseUnits, 60);
  assert.ok(stockMovement.sourceReceptionId.equals(storedReception._id));
  assert.ok(stockMovement.sourceReceptionLineId.equals(storedReception.lines[0]._id));
  assert.equal(
    stockMovement.occurredOn.getTime(),
    storedReception.receptionDate.getTime(),
  );
  assert.equal(
    stockMovement.recordedAt.getTime(),
    storedReception.createdAt.getTime(),
  );
  assert.ok(stockMovement.recordedBy.equals(userId));
  assert.equal(stockMovement.amountInCentimes, undefined);
  await assert.rejects(
    database.collection('stockMovements').insertOne({
      ...stockMovement,
      _id: new ObjectId(),
    }),
    (error) => error?.code === 11000,
  );
  assert.deepEqual(receptions, [
    {
      id: storedReception._id.toString(),
      supplierId: supplierId.toString(),
      supplierName: 'Distribution Atlas',
      receptionDate: '2026-09-13',
      supplierReference: 'BL-2026-0042',
      createdAt: storedReception.createdAt.toISOString(),
      lines: [{
        productCode: 'EAU-1L',
        productDesignation: 'Eau 1 L',
        quantityInBaseUnits: 60,
        baseUnit: 'BOUTEILLE',
      }],
    },
  ]);
  assert.deepEqual(receptionDetail, {
    id: storedReception._id.toString(),
    supplierId: supplierId.toString(),
    supplierName: 'Distribution Atlas',
    receptionDate: '2026-09-13',
    supplierReference: 'BL-2026-0042',
    createdAt: storedReception.createdAt.toISOString(),
    createdBy: 'creation-reception-autorisee',
    totalAmountInCentimes: null,
    lines: [{
      id: storedReception.lines[0]._id.toString(),
      productId: productId.toString(),
      productCode: 'EAU-1L',
      productDesignation: 'Eau 1 L',
      baseUnit: 'BOUTEILLE',
      quantityMode: 'PACKAGING',
      quantityInBaseUnits: 60,
      directQuantity: null,
      amountInCentimes: null,
      packaging: {
        packagingId: packagingId.toString(),
        label: 'Pack de 6',
        quantity: 6,
        count: 10,
      },
    }],
  });

  assert.deepEqual(await deleteProduct(productId.toString()), { inUse: true });
  assert.deepEqual((await updateProduct({
    productId: productId.toString(),
    code: 'EAU-1L-NOUVEAU',
    designation: 'Eau renommée',
    baseUnit: 'BOITE',
    updatedBy: userId.toString(),
  })).errors, {
    baseUnit: 'L’unité de base ne peut plus être modifiée car ce produit possède un historique de réception.',
  });
  assert.deepEqual(await removeSupplier({
    removedBy: userId.toString(),
    supplierId: supplierId.toString(),
  }), {
    deactivated: true,
    name: 'Distribution Atlas renommée',
  });
});

test('crée un mouvement physique par ligne sans dépendre des coûts', async () => {
  const { token, userId } = await createUserSession(
    'reception-plusieurs-lignes',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const firstProductId = new ObjectId();
  const secondProductId = new ObjectId();

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur multi-lignes',
    active: true,
  });
  await database.collection('products').insertMany([
    {
      _id: firstProductId,
      code: 'MULTI-01',
      designation: 'Premier produit',
      baseUnit: 'PIECE',
      createdAt: new Date(),
      createdBy: userId,
    },
    {
      _id: secondProductId,
      code: 'MULTI-02',
      designation: 'Second produit',
      baseUnit: 'BOITE',
      createdAt: new Date(),
      createdBy: userId,
    },
  ]);
  const result = await callWithSession(token, () => createReception(
    { revision: 0 },
    createReceptionFormData({
      supplierId,
      supplierReference: 'BL-MULTI',
      lines: [
        {
          baseUnit: 'PIECE',
          directQuantity: '4',
          productId: firstProductId.toString(),
          quantityMode: 'DIRECT',
        },
        {
          baseUnit: 'BOITE',
          directQuantity: '7',
          productId: secondProductId.toString(),
          quantityMode: 'DIRECT',
        },
      ],
    }),
  ));
  const reception = await database.collection('receptions').findOne({
    supplierReference: 'BL-MULTI',
  });
  const movements = await database.collection('stockMovements').find({
    sourceReceptionId: reception._id,
  }).sort({ quantityDeltaInBaseUnits: 1 }).toArray();

  assert.deepEqual(result.errors, {});
  assert.deepEqual(
    movements.map((movement) => ({
      amountInCentimes: movement.amountInCentimes,
      baseUnit: movement.baseUnit,
      productId: movement.productId.toString(),
      quantity: movement.quantityDeltaInBaseUnits,
    })),
    [
      {
        amountInCentimes: undefined,
        baseUnit: 'PIECE',
        productId: firstProductId.toString(),
        quantity: 4,
      },
      {
        amountInCentimes: undefined,
        baseUnit: 'BOITE',
        productId: secondProductId.toString(),
        quantity: 7,
      },
    ],
  );
});

test('annule la réception et les mouvements si une écriture échoue', async () => {
  const { token, userId } = await createUserSession(
    'reception-transaction-annulee',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const firstProductId = new ObjectId();
  const secondProductId = new ObjectId();
  const submissionKey = randomUUID();

  await database.collection('suppliers').insertOne({
    _id: supplierId,
    name: 'Fournisseur transaction annulée',
    active: true,
  });
  await database.collection('products').insertMany([
    {
      _id: firstProductId,
      code: 'ROLLBACK-01',
      designation: 'Premier rollback',
      baseUnit: 'PIECE',
    },
    {
      _id: secondProductId,
      code: 'ROLLBACK-02',
      designation: 'Second rollback',
      baseUnit: 'PIECE',
    },
  ]);
  await database.collection('stockMovements').createIndex(
    { recordedBy: 1 },
    {
      name: 'force_transaction_failure',
      partialFilterExpression: { recordedBy: userId },
      unique: true,
    },
  );

  try {
    const result = await callWithSession(token, () => createReception(
      { revision: 0 },
      createReceptionFormData({
        submissionKey,
        supplierId,
        supplierReference: 'BL-ROLLBACK',
        lines: [firstProductId, secondProductId].map((productId) => ({
          baseUnit: 'PIECE',
          directQuantity: '1',
          productId: productId.toString(),
          quantityMode: 'DIRECT',
        })),
      }),
    ));

    assert.equal(
      result.errors.form,
      'L’enregistrement de la réception est momentanément indisponible.',
    );
    assert.equal(await database.collection('receptions').countDocuments({
      submissionKey,
    }), 0);
    assert.equal(await database.collection('stockMovements').countDocuments({
      recordedBy: userId,
    }), 0);
    assert.equal(await database.collection('products').countDocuments({
      _id: { $in: [firstProductId, secondProductId] },
      stockReferenceVersion: { $exists: true },
    }), 0);
    assert.equal(await database.collection('suppliers').countDocuments({
      _id: supplierId,
      receptionReferenceVersion: { $exists: true },
    }), 0);
  } finally {
    await database.collection('stockMovements').dropIndex(
      'force_transaction_failure',
    );
  }
});

test('rend une même soumission concurrente idempotente et refuse un autre contenu', async () => {
  const { token, userId } = await createUserSession(
    'reception-idempotente',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const submissionKey = randomUUID();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Fournisseur idempotent',
      active: true,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'IDEMPOTENT-01',
      designation: 'Produit idempotent',
      baseUnit: 'PIECE',
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const createFormData = (supplierReference = 'BL-IDEMPOTENT') =>
    createReceptionFormData({
      submissionKey,
      supplierId,
      supplierReference,
      lines: [{
        baseUnit: 'PIECE',
        directQuantity: '8',
        productId: productId.toString(),
        quantityMode: 'DIRECT',
      }],
    });
  const [firstResult, secondResult] = await Promise.all([
    callWithSession(token, () => createReception(
      { revision: 0 },
      createFormData(),
    )),
    callWithSession(token, () => createReception(
      { revision: 0 },
      createFormData(),
    )),
  ]);
  const conflict = await callWithSession(token, () => createReception(
    { revision: 0 },
    createFormData('BL-CONTENU-DIFFERENT'),
  ));
  const reception = await database.collection('receptions').findOne({
    submissionKey,
  });

  assert.equal(firstResult.message, secondResult.message);
  assert.equal(firstResult.receptionId, secondResult.receptionId);
  assert.notEqual(firstResult.replayed, secondResult.replayed);
  assert.equal(await database.collection('receptions').countDocuments({
    submissionKey,
  }), 1);
  assert.equal(await database.collection('stockMovements').countDocuments({
    sourceReceptionId: reception._id,
  }), 1);
  assert.equal(
    conflict.errors.form,
    'Cette demande a déjà été utilisée avec un contenu différent.',
  );
});

test('conserve zéro comme montant renseigné et distingue un montant absent', async () => {
  const { userId } = await createUserSession('lecture-montants-reception', [
    'receptions.read',
  ]);
  const receptionId = new ObjectId();

  await database.collection('receptions').insertOne({
    _id: receptionId,
    supplierId: new ObjectId(),
    supplierName: 'Fournisseur historique',
    receptionDate: new Date('2026-09-13T00:00:00.000Z'),
    supplierReference: 'BL-MONTANTS',
    createdAt: new Date('2026-09-13T08:00:00.000Z'),
    createdBy: userId,
    totalAmountInCentimes: 0,
    lines: [
      {
        _id: new ObjectId(),
        productId: new ObjectId(),
        productCode: 'ZERO',
        productDesignation: 'Montant nul',
        baseUnit: 'PIECE',
        quantityMode: 'DIRECT',
        quantityInBaseUnits: 5,
        amountInCentimes: 0,
      },
      {
        _id: new ObjectId(),
        productId: new ObjectId(),
        productCode: 'ABSENT',
        productDesignation: 'Montant absent',
        baseUnit: 'PIECE',
        quantityMode: 'DIRECT',
        quantityInBaseUnits: 2,
      },
    ],
  });
  const reception = await getReceptionById(receptionId.toString(), {
    userId: userId.toString(),
  });

  assert.equal(reception.totalAmountInCentimes, 0);
  assert.equal(reception.lines[0].amountInCentimes, 0);
  assert.equal(reception.lines[0].directQuantity, 5);
  assert.equal(reception.lines[1].amountInCentimes, null);
  assert.equal(reception.lines[1].quantityInBaseUnits, 2);
});

test('refuse un fournisseur désactivé sans créer de réception', async () => {
  const { token, userId } = await createUserSession(
    'reception-fournisseur-inactif',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const packagingId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Ancien fournisseur',
      active: false,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'PRODUIT-INACTIF',
      designation: 'Produit de contrôle',
      baseUnit: 'PIECE',
      packagings: [{
        _id: packagingId,
        label: 'Carton de 10',
        quantity: 10,
      }],
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const beforeCount = await database.collection('receptions').countDocuments();
  const result = await callWithSession(token, () => createReception(
    { revision: 0 },
    createReceptionFormData({ packagingId, productId, supplierId }),
  ));

  assert.equal(result.errors.supplierId, 'Ce fournisseur n’est plus actif.');
  assert.equal(
    await database.collection('receptions').countDocuments(),
    beforeCount,
  );
});

test('refuse une unité de base devenue incompatible avant la transaction', async () => {
  const { token, userId } = await createUserSession(
    'reception-unite-modifiee',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();
  const submissionKey = randomUUID();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Fournisseur unité modifiée',
      active: true,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'UNITE-MODIFIEE',
      designation: 'Produit unité modifiée',
      baseUnit: 'BOITE',
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const result = await callWithSession(token, () => createReception(
    { revision: 0 },
    createReceptionFormData({
      submissionKey,
      supplierId,
      supplierReference: 'BL-UNITE-MODIFIEE',
      lines: [{
        baseUnit: 'PIECE',
        directQuantity: '5',
        productId: productId.toString(),
        quantityMode: 'DIRECT',
      }],
    }),
  ));

  assert.equal(
    result.errors.lines,
    'L’unité de base du produit de la ligne 1 a changé. Rechargez le formulaire.',
  );
  assert.equal(await database.collection('receptions').countDocuments({
    submissionKey,
  }), 0);
  assert.equal(await database.collection('stockMovements').countDocuments({
    productId,
  }), 0);
  assert.equal(await database.collection('products').countDocuments({
    _id: productId,
    stockReferenceVersion: { $exists: true },
  }), 0);
});

test('refuse un mode de quantité forgé côté client', async () => {
  const { token, userId } = await createUserSession(
    'reception-mode-invalide',
    ['receptions.create'],
  );
  const supplierId = new ObjectId();
  const productId = new ObjectId();

  await Promise.all([
    database.collection('suppliers').insertOne({
      _id: supplierId,
      name: 'Fournisseur de contrôle',
      active: true,
    }),
    database.collection('products').insertOne({
      _id: productId,
      code: 'MODE-INVALIDE',
      designation: 'Produit de contrôle',
      baseUnit: 'PIECE',
      createdAt: new Date(),
      createdBy: userId,
    }),
  ]);
  const formData = new FormData();

  formData.set('supplierId', supplierId.toString());
  formData.set('submissionKey', randomUUID());
  formData.set('receptionDate', '2026-09-13');
  formData.set('supplierReference', 'BL-MODE-INVALIDE');
  formData.set('lines', JSON.stringify([{
    baseUnit: 'PIECE',
    productId: productId.toString(),
    quantityMode: 'FORGED',
    directQuantity: '10',
  }]));
  const beforeCount = await database.collection('receptions').countDocuments();
  const result = await callWithSession(token, () =>
    createReception({ revision: 0 }, formData));

  assert.equal(
    result.errors.lines,
    'La ligne 1 contient un mode de quantité invalide.',
  );
  assert.equal(
    await database.collection('receptions').countDocuments(),
    beforeCount,
  );
});
