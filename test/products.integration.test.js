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

const {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  updateProduct,
} = await import('../lib/products.js');
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

test('liste les produits par code et filtre sur le code ou la désignation', async () => {
  const authorId = new ObjectId().toString();

  await createProduct({
    code: 'CATALOGUE-B',
    designation: 'Produit courant',
    baseUnit: 'PIECE',
    createdBy: authorId,
  });
  await createProduct({
    code: 'CATALOGUE-A',
    designation: 'Boisson [Spéciale]',
    baseUnit: 'BOUTEILLE',
    createdBy: authorId,
  });

  const productsByCode = await listProducts({ query: 'catalogue-' });

  assert.deepEqual(
    productsByCode.map((product) => product.code),
    ['CATALOGUE-A', 'CATALOGUE-B'],
  );
  assert.deepEqual(Object.keys(productsByCode[0]).sort(), [
    'baseUnit',
    'code',
    'designation',
    'id',
  ]);

  const productsByDesignation = await listProducts({ query: '[Spéciale]' });

  assert.equal(productsByDesignation.length, 1);
  assert.equal(productsByDesignation[0].code, 'CATALOGUE-A');
});

test('retourne la fiche détaillée d’un produit et son créateur', async () => {
  const authorId = new ObjectId();

  await database.collection('users').insertOne({
    _id: authorId,
    username: 'gestionnaire',
  });

  const created = await createProduct({
    code: 'FICHE-01',
    designation: 'Produit avec fiche',
    baseUnit: 'BOITE',
    createdBy: authorId.toString(),
  });
  const product = await getProductById(created.product.id);

  assert.deepEqual(product, {
    id: created.product.id,
    baseUnit: 'BOITE',
    code: 'FICHE-01',
    createdAt: product.createdAt,
    createdBy: 'gestionnaire',
    designation: 'Produit avec fiche',
    updatedAt: null,
    updatedBy: null,
  });
  assert.equal(typeof product.createdAt, 'string');
  assert.equal(await getProductById('identifiant-invalide'), null);
  assert.equal(await getProductById(new ObjectId().toString()), null);
});

test('modifie un produit avec sa traçabilité et protège l’unicité du code', async () => {
  const authorId = new ObjectId();
  const editorId = new ObjectId();

  await database.collection('users').insertMany([
    { _id: authorId, username: 'auteur' },
    { _id: editorId, username: 'editeur' },
  ]);

  const product = await createProduct({
    code: 'MODIFIER-01',
    designation: 'Avant modification',
    baseUnit: 'PIECE',
    createdBy: authorId.toString(),
  });
  await createProduct({
    code: 'CODE-OCCUPE',
    designation: 'Autre produit',
    baseUnit: 'SACHET',
    createdBy: authorId.toString(),
  });

  const updated = await updateProduct({
    id: product.product.id,
    code: '  modifier-02  ',
    designation: '  Après modification  ',
    baseUnit: 'BOUTEILLE',
    updatedBy: editorId.toString(),
  });

  assert.deepEqual(updated.product, {
    id: product.product.id,
    code: 'MODIFIER-02',
    designation: 'Après modification',
    baseUnit: 'BOUTEILLE',
  });

  const details = await getProductById(product.product.id);

  assert.equal(details.createdBy, 'auteur');
  assert.equal(details.updatedBy, 'editeur');
  assert.equal(typeof details.updatedAt, 'string');

  const duplicate = await updateProduct({
    id: product.product.id,
    code: 'code-occupe',
    designation: 'Modification interdite',
    baseUnit: 'BOITE',
    updatedBy: editorId.toString(),
  });

  assert.equal(
    duplicate.errors.code,
    'Un produit avec ce code existe déjà.',
  );
  assert.equal((await getProductById(product.product.id)).code, 'MODIFIER-02');
  assert.deepEqual(
    await updateProduct({
      id: 'identifiant-invalide',
      code: 'CODE',
      designation: 'Produit',
      baseUnit: 'PIECE',
      updatedBy: editorId.toString(),
    }),
    { notFound: true },
  );
});

test('supprime uniquement le produit demandé', async () => {
  const authorId = new ObjectId().toString();
  const productToDelete = await createProduct({
    code: 'SUPPRIMER-01',
    designation: 'Produit à supprimer',
    baseUnit: 'PIECE',
    createdBy: authorId,
  });
  const productToKeep = await createProduct({
    code: 'CONSERVER-01',
    designation: 'Produit à conserver',
    baseUnit: 'BOITE',
    createdBy: authorId,
  });

  assert.deepEqual(await deleteProduct(productToDelete.product.id), {
    deleted: true,
  });
  assert.equal(await getProductById(productToDelete.product.id), null);
  assert.ok(await getProductById(productToKeep.product.id));
  assert.deepEqual(await deleteProduct(productToDelete.product.id), {
    notFound: true,
  });
  assert.deepEqual(await deleteProduct('identifiant-invalide'), {
    notFound: true,
  });
});
