import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase } from './mongodb.js';

export const DELIVERERS_PER_PAGE = 10;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

export const readDelivererListState = (searchParams = {}) => {
  const queryValue = readSingleValue(searchParams.q);
  const pageValue = readSingleValue(searchParams.page);
  const query = typeof queryValue === 'string'
    ? queryValue.trim().slice(0, 100)
    : '';
  const page = typeof pageValue === 'string' && /^\d+$/u.test(pageValue)
    ? Number(pageValue)
    : 1;

  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    query,
  };
};

export const validateDeliverer = ({ code, name, phone }) => {
  const errors = {};
  const data = {
    code: normalizeText(code).toLocaleUpperCase('fr'),
    name: normalizeText(name),
    phone: normalizeText(phone),
  };

  if (!data.code) {
    errors.code = 'Le code est obligatoire.';
  } else if (Array.from(data.code).length > 50) {
    errors.code = 'Le code ne doit pas dépasser 50 caractères.';
  } else if (/\s/u.test(data.code)) {
    errors.code = 'Le code ne doit contenir aucun espace intérieur.';
  }

  if (!data.name) {
    errors.name = 'Le nom du livreur est obligatoire.';
  } else if (Array.from(data.name).length > 150) {
    errors.name = 'Le nom ne doit pas dépasser 150 caractères.';
  }

  if (Array.from(data.phone).length > 30) {
    errors.phone = 'Le téléphone ne doit pas dépasser 30 caractères.';
  }

  return Object.keys(errors).length > 0 ? { errors } : { data };
};

export const createDeliverer = async ({ code, createdBy, name, phone }) => {
  const validation = validateDeliverer({ code, name, phone });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const deliverers = database.collection('deliverers');

  await deliverers.createIndex(
    { code: 1 },
    { name: 'unique_deliverer_code', unique: true },
  );

  const deliverer = {
    ...validation.data,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };

  try {
    const result = await deliverers.insertOne(deliverer);

    return {
      deliverer: {
        id: result.insertedId.toString(),
        ...validation.data,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          code: 'Un livreur avec ce code existe déjà.',
        },
      };
    }

    throw error;
  }
};

export const listDeliverers = async ({
  page = 1,
  pageSize = DELIVERERS_PER_PAGE,
  query = '',
  userId,
} = {}) => {
  await requireUserPermission(userId, 'deliverers.read');

  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';
  const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : DELIVERERS_PER_PAGE;
  const filter = normalizedQuery
    ? {
        $or: [
          {
            code: {
              $options: 'i',
              $regex: escapeRegularExpression(normalizedQuery),
            },
          },
          {
            name: {
              $options: 'i',
              $regex: escapeRegularExpression(normalizedQuery),
            },
          },
        ],
      }
    : {};
  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const totalItems = await deliverers.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const activePage = Math.min(normalizedPage, totalPages);
  const documents = await deliverers.find(
    filter,
    { projection: { code: 1, name: 1, phone: 1 } },
  ).sort({ code: 1, _id: 1 }).skip(
    (activePage - 1) * normalizedPageSize,
  ).limit(normalizedPageSize).toArray();

  return {
    deliverers: documents.map((deliverer) => ({
      id: deliverer._id.toString(),
      code: deliverer.code,
      name: deliverer.name,
      phone: deliverer.phone ?? '',
    })),
    page: activePage,
    pageSize: normalizedPageSize,
    query: normalizedQuery,
    totalItems,
    totalPages,
  };
};
