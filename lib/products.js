import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

export const BASE_UNITS = [
  { code: 'PIECE', label: 'Pièce' },
  { code: 'BOUTEILLE', label: 'Bouteille' },
  { code: 'BOITE', label: 'Boîte' },
  { code: 'SACHET', label: 'Sachet' },
];

const BASE_UNIT_CODES = new Set(BASE_UNITS.map((unit) => unit.code));

export const validateProduct = ({ code, designation, baseUnit }) => {
  const errors = {};
  const normalizedCode = typeof code === 'string'
    ? code.trim().toLocaleUpperCase('fr')
    : '';
  const normalizedDesignation = typeof designation === 'string'
    ? designation.trim()
    : '';

  if (!normalizedCode) {
    errors.code = 'Le code est obligatoire.';
  } else if (Array.from(normalizedCode).length > 50) {
    errors.code = 'Le code ne doit pas dépasser 50 caractères.';
  } else if (/\s/u.test(normalizedCode)) {
    errors.code = 'Le code ne doit contenir aucun espace intérieur.';
  }

  if (!normalizedDesignation) {
    errors.designation = 'La désignation est obligatoire.';
  } else if (Array.from(normalizedDesignation).length > 150) {
    errors.designation = 'La désignation ne doit pas dépasser 150 caractères.';
  }

  if (!BASE_UNIT_CODES.has(baseUnit)) {
    errors.baseUnit = 'Sélectionnez une unité de base valide.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      code: normalizedCode,
      designation: normalizedDesignation,
      baseUnit,
    },
  };
};

export const createProduct = async ({ code, designation, baseUnit, createdBy }) => {
  const validation = validateProduct({ code, designation, baseUnit });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const products = database.collection('products');

  await products.createIndex(
    { code: 1 },
    { name: 'unique_product_code', unique: true },
  );

  const product = {
    ...validation.data,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };

  try {
    const result = await products.insertOne(product);

    return {
      product: {
        id: result.insertedId.toString(),
        ...validation.data,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          code: 'Un produit avec ce code existe déjà.',
        },
      };
    }

    throw error;
  }
};
