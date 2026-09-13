import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';

import { ObjectId } from 'mongodb';

const sourceUri =
  process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/syphax';
const testDatabaseName = `syphax_test_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const testUri = new URL(sourceUri);

testUri.pathname = `/${testDatabaseName}`;
process.env.MONGODB_URI = testUri.toString();

const { createProduct } = await import('../lib/products.js');
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

test('n’écrit aucun document lorsque les données sont invalides', async () => {
  const result = await createProduct({
    code: 'CODE INTERDIT',
    designation: '   ',
    baseUnit: 'CARTON',
    createdBy: new ObjectId().toString(),
  });

  assert.deepEqual(Object.keys(result.errors).sort(), [
    'baseUnit',
    'code',
    'designation',
  ]);
  assert.equal(
    await database.collection('products').countDocuments({}),
    0,
  );
});

test('enregistre uniquement les données métier et les métadonnées serveur', async () => {
  const authorId = new ObjectId();
  const result = await createProduct({
    code: '  prod-é01  ',
    designation: '  Huile végétale 1 L  ',
    baseUnit: 'BOUTEILLE',
    createdBy: authorId.toString(),
  });

  assert.ok(result.product);
  assert.equal(result.product.code, 'PROD-É01');

  const product = await database.collection('products').findOne({
    _id: new ObjectId(result.product.id),
  });

  assert.deepEqual(Object.keys(product).sort(), [
    '_id',
    'baseUnit',
    'code',
    'createdAt',
    'createdBy',
    'designation',
  ]);
  assert.equal(product.code, 'PROD-É01');
  assert.equal(product.designation, 'Huile végétale 1 L');
  assert.equal(product.baseUnit, 'BOUTEILLE');
  assert.ok(product.createdAt instanceof Date);
  assert.ok(product.createdBy.equals(authorId));
});

test('empêche deux créations concurrentes avec le même code normalisé', async () => {
  const authorId = new ObjectId().toString();
  const results = await Promise.all([
    createProduct({
      code: '  concurrent-01  ',
      designation: 'Premier envoi',
      baseUnit: 'PIECE',
      createdBy: authorId,
    }),
    createProduct({
      code: 'CONCURRENT-01',
      designation: 'Deuxième envoi',
      baseUnit: 'SACHET',
      createdBy: authorId,
    }),
  ]);

  assert.equal(results.filter((result) => result.product).length, 1);
  assert.equal(
    results.filter(
      (result) =>
        result.errors?.code === 'Un produit avec ce code existe déjà.',
    ).length,
    1,
  );
  assert.equal(
    await database.collection('products').countDocuments({
      code: 'CONCURRENT-01',
    }),
    1,
  );

  const uniqueIndex = (await database.collection('products').indexes()).find(
    (index) => index.name === 'unique_product_code',
  );

  assert.equal(uniqueIndex.unique, true);
  assert.deepEqual(uniqueIndex.key, { code: 1 });
});
