import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase } from './mongodb.js';

export const DELIVERERS_PER_PAGE = 10;

const DELIVERER_ID_PATTERN = /^[a-f\d]{24}$/iu;
const DELIVERER_LIST_PARAMETERS = new Set(['page', 'q']);

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

export const buildDelivererListHref = ({ page = 1, query = '' } = {}) => {
  const parameters = new URLSearchParams();
  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';

  if (normalizedQuery) {
    parameters.set('q', normalizedQuery);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('page', String(page));
  }

  const search = parameters.toString();

  return search ? `/livreurs?${search}` : '/livreurs';
};

export const validateDelivererListHref = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/livreurs';
  }

  let destination;

  try {
    destination = new URL(value, 'https://syphax.invalid');
  } catch {
    return '/livreurs';
  }

  const hasUnexpectedParameter = [...destination.searchParams.keys()].some(
    (key) => !DELIVERER_LIST_PARAMETERS.has(key),
  );

  if (
    destination.origin !== 'https://syphax.invalid'
    || destination.pathname !== '/livreurs'
    || destination.hash
    || hasUnexpectedParameter
  ) {
    return '/livreurs';
  }

  return buildDelivererListHref(readDelivererListState(
    Object.fromEntries(destination.searchParams),
  ));
};

export const formatDelivererCreatedAt = (
  value,
  timeZone = 'Africa/Algiers',
) => {
  if (!value) {
    return 'Non renseignée';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    hourCycle: 'h23',
    timeStyle: 'short',
    timeZone,
  }).format(date);
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

export const requireDelivererEditPermission = async ({ editing, userId }) => {
  if (editing) {
    await requireUserPermission(userId, 'deliverers.update');
  }
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

export const getDelivererById = async (id, { userId } = {}) => {
  await requireUserPermission(userId, 'deliverers.read');

  if (typeof id !== 'string' || !DELIVERER_ID_PATTERN.test(id)) {
    return null;
  }

  const database = await getDatabase();
  const deliverer = await database.collection('deliverers').findOne(
    { _id: new ObjectId(id) },
    {
      projection: {
        code: 1,
        createdAt: 1,
        createdBy: 1,
        name: 1,
        phone: 1,
        updatedAt: 1,
        updatedBy: 1,
      },
    },
  );

  if (!deliverer) {
    return null;
  }

  const authorIds = [deliverer.createdBy, deliverer.updatedBy].filter(
    (authorId) => authorId instanceof ObjectId,
  );
  const authors = authorIds.length > 0
    ? await database.collection('users').find(
        { _id: { $in: authorIds } },
        { projection: { username: 1 } },
      ).toArray()
    : [];
  const authorsById = new Map(
    authors.map((author) => [author._id.toString(), author.username]),
  );

  return {
    id: deliverer._id.toString(),
    code: deliverer.code,
    name: deliverer.name,
    phone: deliverer.phone ?? '',
    createdAt: deliverer.createdAt?.toISOString?.() ?? null,
    createdBy: authorsById.get(deliverer.createdBy?.toString()) ?? null,
    updatedAt: deliverer.updatedAt?.toISOString?.() ?? null,
    updatedBy: authorsById.get(deliverer.updatedBy?.toString()) ?? null,
  };
};

export const updateDeliverer = async ({
  code,
  delivererId,
  name,
  phone,
  updatedBy,
}) => {
  if (typeof delivererId !== 'string' || !DELIVERER_ID_PATTERN.test(delivererId)) {
    return { notFound: true };
  }

  const validation = validateDeliverer({ code, name, phone });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const delivererObjectId = new ObjectId(delivererId);

  await deliverers.createIndex(
    { code: 1 },
    { name: 'unique_deliverer_code', unique: true },
  );

  const delivererWithSameCode = await deliverers.findOne(
    {
      _id: { $ne: delivererObjectId },
      code: validation.data.code,
    },
    { projection: { _id: 1 } },
  );

  if (delivererWithSameCode) {
    return {
      errors: {
        code: 'Un livreur avec ce code existe déjà.',
      },
    };
  }

  try {
    const result = await deliverers.updateOne(
      { _id: delivererObjectId },
      {
        $set: {
          ...validation.data,
          updatedAt: new Date(),
          updatedBy: new ObjectId(updatedBy),
        },
      },
    );

    if (result.matchedCount === 0) {
      return { notFound: true };
    }

    return {
      deliverer: {
        id: delivererId,
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
