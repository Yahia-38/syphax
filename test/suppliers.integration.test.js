import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_suppliers_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const {
  createSupplier,
  listSuppliers,
  removeSupplier,
  updateSupplier,
} = await import('../lib/suppliers.js');
const { closeMongoConnection, getDatabase } = await import('../lib/mongodb.js');

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

test('crée un fournisseur actif avec sa traçabilité', async () => {
  const authorId = new ObjectId();
  const result = await createSupplier({
    name: '  Distribution Atlas  ',
    contactName: '  Amine Benali ',
    phone: '0550 00 00 00',
    email: ' CONTACT@ATLAS.DZ ',
    address: 'Alger',
    createdBy: authorId.toString(),
  });

  assert.equal(result.supplier.name, 'Distribution Atlas');
  assert.equal(result.supplier.active, true);

  const supplier = await database.collection('suppliers').findOne({
    _id: new ObjectId(result.supplier.id),
  });

  assert.equal(supplier.normalizedName, 'distribution atlas');
  assert.equal(supplier.email, 'contact@atlas.dz');
  assert.equal(supplier.active, true);
  assert.ok(supplier.createdAt instanceof Date);
  assert.ok(supplier.createdBy.equals(authorId));
});

test('empêche les doublons de nom sans tenir compte de la casse', async () => {
  const authorId = new ObjectId().toString();
  const results = await Promise.all([
    createSupplier({ name: 'Fournisseur Unique', createdBy: authorId }),
    createSupplier({ name: ' fournisseur unique ', createdBy: authorId }),
  ]);

  assert.equal(results.filter((result) => result.supplier).length, 1);
  assert.equal(
    results.filter(
      (result) => result.errors?.name === 'Un fournisseur avec ce nom existe déjà.',
    ).length,
    1,
  );
});

test('liste les fournisseurs triés et expose leur état', async () => {
  const authorId = new ObjectId().toString();

  await createSupplier({ name: 'Zéphyr', createdBy: authorId });
  await createSupplier({ name: 'Alpha', createdBy: authorId });

  const suppliers = await listSuppliers();

  assert.deepEqual(
    suppliers.map(({ active, name }) => ({ active, name })),
    [
      { active: true, name: 'Alpha' },
      { active: true, name: 'Distribution Atlas' },
      { active: true, name: 'Fournisseur Unique' },
      { active: true, name: 'Zéphyr' },
    ],
  );
});

test('modifie les données éditables sans toucher aux informations de création', async () => {
  const creatorId = new ObjectId();
  const editorId = new ObjectId();
  const created = await createSupplier({
    name: 'Fournisseur à modifier',
    contactName: 'Ancien contact',
    createdBy: creatorId.toString(),
  });
  const beforeUpdate = await database.collection('suppliers').findOne({
    _id: new ObjectId(created.supplier.id),
  });

  const result = await updateSupplier({
    supplierId: created.supplier.id,
    name: '  FOURNISSEUR À MODIFIER  ',
    contactName: ' Nouveau contact ',
    phone: ' 021 00 00 00 ',
    email: ' CONTACT@MODIFIE.DZ ',
    address: ' Nouvelle adresse ',
    updatedBy: editorId.toString(),
  });

  assert.equal(result.supplier.name, 'FOURNISSEUR À MODIFIER');

  const updated = await database.collection('suppliers').findOne({
    _id: beforeUpdate._id,
  });

  assert.ok(updated._id.equals(beforeUpdate._id));
  assert.equal(updated.contactName, 'Nouveau contact');
  assert.equal(updated.phone, '021 00 00 00');
  assert.equal(updated.email, 'contact@modifie.dz');
  assert.equal(updated.address, 'Nouvelle adresse');
  assert.equal(updated.createdAt.getTime(), beforeUpdate.createdAt.getTime());
  assert.ok(updated.createdBy.equals(creatorId));
  assert.ok(updated.updatedAt instanceof Date);
  assert.ok(updated.updatedBy.equals(editorId));
});

test('refuse le nom déjà utilisé par un autre fournisseur sans écrire', async () => {
  const authorId = new ObjectId().toString();
  const first = await createSupplier({
    name: 'Premier fournisseur',
    createdBy: authorId,
  });

  await createSupplier({
    name: 'Nom déjà utilisé',
    createdBy: authorId,
  });

  const result = await updateSupplier({
    supplierId: first.supplier.id,
    name: ' nom DÉJÀ utilisé ',
    contactName: 'Ne doit pas être écrit',
    updatedBy: new ObjectId().toString(),
  });

  assert.equal(
    result.errors.name,
    'Un fournisseur avec ce nom existe déjà.',
  );

  const unchanged = await database.collection('suppliers').findOne({
    _id: new ObjectId(first.supplier.id),
  });

  assert.equal(unchanged.name, 'Premier fournisseur');
  assert.equal(unchanged.contactName, '');
  assert.equal(unchanged.updatedAt, undefined);
  assert.equal(unchanged.updatedBy, undefined);
});

test('signale un fournisseur introuvable sans créer de document', async () => {
  const missingId = new ObjectId().toString();
  const supplierCount = await database.collection('suppliers').countDocuments();

  assert.deepEqual(await updateSupplier({
    supplierId: missingId,
    name: 'Fournisseur absent',
    updatedBy: new ObjectId().toString(),
  }), { notFound: true });
  assert.deepEqual(await updateSupplier({
    supplierId: 'identifiant-invalide',
    name: 'Fournisseur absent',
    updatedBy: new ObjectId().toString(),
  }), { notFound: true });
  assert.equal(
    await database.collection('suppliers').countDocuments(),
    supplierCount,
  );
});

test('supprime définitivement un fournisseur sans réception', async () => {
  const authorId = new ObjectId().toString();
  const created = await createSupplier({
    name: 'Fournisseur sans historique',
    createdBy: authorId,
  });

  assert.deepEqual(await removeSupplier({
    supplierId: created.supplier.id,
    removedBy: new ObjectId().toString(),
  }), {
    deleted: true,
    name: 'Fournisseur sans historique',
  });
  assert.equal(await database.collection('suppliers').findOne({
    _id: new ObjectId(created.supplier.id),
  }), null);
});

test('désactive et conserve un fournisseur utilisé dans une réception', async () => {
  const creatorId = new ObjectId();
  const removerId = new ObjectId();
  const created = await createSupplier({
    name: 'Fournisseur avec historique',
    createdBy: creatorId.toString(),
  });
  const supplierId = new ObjectId(created.supplier.id);
  const beforeRemoval = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  await database.collection('receptions').insertOne({
    supplierId,
    receivedAt: new Date(),
  });

  assert.deepEqual(await removeSupplier({
    supplierId: created.supplier.id,
    removedBy: removerId.toString(),
  }), {
    deactivated: true,
    name: 'Fournisseur avec historique',
  });

  const deactivated = await database.collection('suppliers').findOne({
    _id: supplierId,
  });

  assert.equal(deactivated.active, false);
  assert.equal(deactivated.name, beforeRemoval.name);
  assert.equal(deactivated.createdAt.getTime(), beforeRemoval.createdAt.getTime());
  assert.ok(deactivated.createdBy.equals(creatorId));
  assert.ok(deactivated.deactivatedAt instanceof Date);
  assert.ok(deactivated.deactivatedBy.equals(removerId));
  assert.equal(deactivated.updatedAt.getTime(), deactivated.deactivatedAt.getTime());
  assert.ok(deactivated.updatedBy.equals(removerId));
});

test('signale un fournisseur introuvable lors du retrait', async () => {
  assert.deepEqual(await removeSupplier({
    supplierId: new ObjectId().toString(),
    removedBy: new ObjectId().toString(),
  }), { notFound: true });
  assert.deepEqual(await removeSupplier({
    supplierId: 'identifiant-invalide',
    removedBy: new ObjectId().toString(),
  }), { notFound: true });
});
