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
  addProductPackaging,
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  updateProductSalePrice,
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
    packagings: [],
    salePrice: null,
    salePriceHistory: [],
    updatedAt: null,
    updatedBy: null,
  });
  assert.equal(typeof product.createdAt, 'string');
  assert.equal(await getProductById('identifiant-invalide'), null);
  assert.equal(await getProductById(new ObjectId().toString()), null);
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

test('ajoute un conditionnement à un produit avec sa traçabilité', async () => {
  const authorId = new ObjectId();
  const product = await createProduct({
    code: 'PACK-01',
    designation: 'Produit conditionné',
    baseUnit: 'BOUTEILLE',
    createdBy: authorId.toString(),
  });
  const result = await addProductPackaging({
    productId: product.product.id,
    label: '  Pack de 6  ',
    quantity: '6',
    createdBy: authorId.toString(),
  });

  assert.equal(result.packaging.label, 'Pack de 6');
  assert.equal(result.packaging.quantity, 6);

  const storedProduct = await database.collection('products').findOne({
    _id: new ObjectId(product.product.id),
  });
  const [packaging] = storedProduct.packagings;

  assert.ok(packaging._id instanceof ObjectId);
  assert.equal(packaging.label, 'Pack de 6');
  assert.equal(packaging.quantity, 6);
  assert.ok(packaging.createdAt instanceof Date);
  assert.ok(packaging.createdBy.equals(authorId));
  assert.deepEqual((await getProductById(product.product.id)).packagings, [
    {
      id: packaging._id.toString(),
      label: 'Pack de 6',
      quantity: 6,
    },
  ]);
});

test('crée un produit avec un conditionnement initial facultatif', async () => {
  const authorId = new ObjectId();
  const result = await createProduct({
    code: 'PACK-INITIAL-01',
    designation: 'Produit avec conditionnement initial',
    baseUnit: 'PIECE',
    packaging: {
      label: 'Carton de 24',
      quantity: '24',
    },
    createdBy: authorId.toString(),
  });
  const storedProduct = await database.collection('products').findOne({
    _id: new ObjectId(result.product.id),
  });

  assert.equal(storedProduct.packagings.length, 1);
  assert.equal(storedProduct.packagings[0].label, 'Carton de 24');
  assert.equal(storedProduct.packagings[0].quantity, 24);
  assert.ok(storedProduct.packagings[0].createdBy.equals(authorId));
});

test('modifie le prix de vente et conserve son historique complet', async () => {
  const authorId = new ObjectId();
  const firstEditorId = new ObjectId();
  const secondEditorId = new ObjectId();

  await database.collection('users').insertMany([
    { _id: firstEditorId, username: 'tarif-initial' },
    { _id: secondEditorId, username: 'tarif-suivant' },
  ]);

  const product = await createProduct({
    code: 'PRIX-01',
    designation: 'Produit avec prix',
    baseUnit: 'BOUTEILLE',
    createdBy: authorId.toString(),
  });
  await updateProductSalePrice({
    productId: product.product.id,
    price: '150',
    updatedBy: firstEditorId.toString(),
  });
  await updateProductSalePrice({
    productId: product.product.id,
    price: '175,50',
    updatedBy: secondEditorId.toString(),
  });

  const storedProduct = await database.collection('products').findOne({
    _id: new ObjectId(product.product.id),
  });

  assert.deepEqual(
    storedProduct.salePriceHistory.map((entry) => ({
      oldAmountInCentimes: entry.oldAmountInCentimes,
      newAmountInCentimes: entry.newAmountInCentimes,
      changedBy: entry.changedBy.toString(),
    })),
    [
      {
        oldAmountInCentimes: null,
        newAmountInCentimes: 15000,
        changedBy: firstEditorId.toString(),
      },
      {
        oldAmountInCentimes: 15000,
        newAmountInCentimes: 17550,
        changedBy: secondEditorId.toString(),
      },
    ],
  );
  assert.ok(
    storedProduct.salePriceHistory.every(
      (entry) => entry._id instanceof ObjectId && entry.changedAt instanceof Date,
    ),
  );

  const details = await getProductById(product.product.id);

  assert.deepEqual(details.salePrice, {
    amountInCentimes: 17550,
    currency: 'DZD',
    taxIncluded: true,
    updatedAt: details.salePrice.updatedAt,
    updatedBy: 'tarif-suivant',
  });
  assert.equal(details.salePriceHistory[0].oldAmountInCentimes, 15000);
  assert.equal(details.salePriceHistory[0].newAmountInCentimes, 17550);
  assert.equal(details.salePriceHistory[0].changedBy, 'tarif-suivant');
  assert.equal(details.salePriceHistory[1].oldAmountInCentimes, null);
  assert.equal(details.salePriceHistory[1].changedBy, 'tarif-initial');
});
