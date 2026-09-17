import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { isObjectiveMonth, OBJECTIVE_ACHIEVEMENT_STATUSES, readObjectiveDirectoryState } from './deliverer-objective-calculations.js';
import { getDatabase } from './mongodb.js';

export const DELIVERERS_PER_PAGE = 10;
export const DELIVERER_STATUS_ACTIVE = 'active';
export const DELIVERER_STATUS_DISABLED = 'disabled';
export const DELIVERER_STATUS_ALL = 'all';

const DELIVERER_ID_PATTERN = /^[a-f\d]{24}$/iu;
const DELIVERER_LIST_PARAMETERS = new Set(['page', 'q', 'statut', 'mois', 'realisation']);
const DELIVERER_STATUSES = new Set([
  DELIVERER_STATUS_ACTIVE,
  DELIVERER_STATUS_DISABLED,
  DELIVERER_STATUS_ALL,
]);

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

export const readDelivererListState = (searchParams = {}) => {
  const queryValue = readSingleValue(searchParams.q);
  const pageValue = readSingleValue(searchParams.page);
  const statusValue = readSingleValue(searchParams.statut);
  const query = typeof queryValue === 'string'
    ? queryValue.trim().slice(0, 100)
    : '';
  const page = typeof pageValue === 'string' && /^\d+$/u.test(pageValue)
    ? Number(pageValue)
    : 1;
  const status = DELIVERER_STATUSES.has(statusValue)
    ? statusValue
    : DELIVERER_STATUS_ACTIVE;

  return {
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    query,
    status,
    ...(('mois' in searchParams || 'realisation' in searchParams) ? readObjectiveDirectoryState(searchParams) : {}),
  };
};

export const buildDelivererListHref = ({
  page = 1,
  query = '',
  status = DELIVERER_STATUS_ACTIVE,
  month = '',
  achievementStatus = '',
} = {}) => {
  const parameters = new URLSearchParams();
  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';

  if (normalizedQuery) {
    parameters.set('q', normalizedQuery);
  }

  if (
    DELIVERER_STATUSES.has(status)
    && status !== DELIVERER_STATUS_ACTIVE
  ) {
    parameters.set('statut', status);
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('page', String(page));
  }

  if (isObjectiveMonth(month)) parameters.set('mois', month);
  if (typeof achievementStatus === 'string' && Object.hasOwn(OBJECTIVE_ACHIEVEMENT_STATUSES, achievementStatus)) {
    parameters.set('realisation', achievementStatus);
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
    || [...destination.searchParams.keys()].some((key) => destination.searchParams.getAll(key).length > 1)
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
    active: true,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };

  try {
    const result = await deliverers.insertOne(deliverer);

    return {
      deliverer: {
        id: result.insertedId.toString(),
        ...validation.data,
        active: true,
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
        active: 1,
        createdAt: 1,
        createdBy: 1,
        name: 1,
        phone: 1,
        statusHistory: 1,
        updatedAt: 1,
        updatedBy: 1,
      },
    },
  );

  if (!deliverer) {
    return null;
  }

  const statusHistory = Array.isArray(deliverer.statusHistory)
    ? deliverer.statusHistory
    : [];
  const authorIds = [
    deliverer.createdBy,
    deliverer.updatedBy,
    ...statusHistory.map((change) => change.changedBy),
  ].filter((authorId) => authorId instanceof ObjectId);
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
    active: deliverer.active !== false,
    code: deliverer.code,
    name: deliverer.name,
    phone: deliverer.phone ?? '',
    createdAt: deliverer.createdAt?.toISOString?.() ?? null,
    createdBy: authorsById.get(deliverer.createdBy?.toString()) ?? null,
    updatedAt: deliverer.updatedAt?.toISOString?.() ?? null,
    updatedBy: authorsById.get(deliverer.updatedBy?.toString()) ?? null,
    statusHistory: statusHistory.map((change) => ({
      active: change.active !== false,
      changedAt: change.changedAt?.toISOString?.() ?? null,
      changedBy: authorsById.get(change.changedBy?.toString()) ?? null,
    })),
  };
};

const setDelivererActive = async ({ active, changedBy, delivererId }) => {
  if (typeof delivererId !== 'string' || !DELIVERER_ID_PATTERN.test(delivererId)) {
    return { notFound: true };
  }

  if (typeof active !== 'boolean') {
    throw new Error('Le statut du livreur est invalide.');
  }

  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const delivererObjectId = new ObjectId(delivererId);
  const changedAt = new Date();
  const changedByObjectId = new ObjectId(changedBy);
  const currentStatusFilter = active
    ? { active: false }
    : { active: { $ne: false } };
  const result = await deliverers.updateOne(
    { _id: delivererObjectId, ...currentStatusFilter },
    {
      $push: {
        statusHistory: {
          active,
          changedAt,
          changedBy: changedByObjectId,
        },
      },
      $set: { active },
    },
  );

  if (result.matchedCount === 1) {
    return { active, changed: true };
  }

  const deliverer = await deliverers.findOne(
    { _id: delivererObjectId },
    { projection: { active: 1 } },
  );

  if (!deliverer) {
    return { notFound: true };
  }

  return {
    active: deliverer.active !== false,
    changed: false,
  };
};

export const deactivateDeliverer = async ({ changedBy, delivererId }) =>
  setDelivererActive({ active: false, changedBy, delivererId });

export const reactivateDeliverer = async ({ changedBy, delivererId }) =>
  setDelivererActive({ active: true, changedBy, delivererId });

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

export const buildDelivererListFilter = ({ query = '', status = DELIVERER_STATUS_ACTIVE } = {}) => {
  const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  const normalizedStatus = DELIVERER_STATUSES.has(status) ? status : DELIVERER_STATUS_ACTIVE;
  const statusFilter = normalizedStatus === DELIVERER_STATUS_ALL ? {}
    : normalizedStatus === DELIVERER_STATUS_DISABLED ? { active: false } : { active: { $ne: false } };
  return {
    ...statusFilter,
    ...(normalizedQuery ? { $or: ['code', 'name'].map((field) => ({
      [field]: { $options: 'i', $regex: escapeRegularExpression(normalizedQuery) },
    })) } : {}),
  };
};

export const listDeliverers = async ({
  page = 1,
  pageSize = DELIVERERS_PER_PAGE,
  query = '',
  status = DELIVERER_STATUS_ACTIVE,
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
  const normalizedStatus = DELIVERER_STATUSES.has(status)
    ? status
    : DELIVERER_STATUS_ACTIVE;
  const filter = buildDelivererListFilter({ query: normalizedQuery, status: normalizedStatus });
  const database = await getDatabase();
  const deliverers = database.collection('deliverers');
  const totalItems = await deliverers.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const activePage = Math.min(normalizedPage, totalPages);
  const documents = await deliverers.find(
    filter,
    { projection: { active: 1, code: 1, name: 1, phone: 1 } },
  ).sort({ code: 1, _id: 1 }).skip(
    (activePage - 1) * normalizedPageSize,
  ).limit(normalizedPageSize).toArray();

  return {
    deliverers: documents.map((deliverer) => ({
      id: deliverer._id.toString(),
      active: deliverer.active !== false,
      code: deliverer.code,
      name: deliverer.name,
      phone: deliverer.phone ?? '',
    })),
    page: activePage,
    pageSize: normalizedPageSize,
    query: normalizedQuery,
    status: normalizedStatus,
    totalItems,
    totalPages,
  };
};
