import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { validateDelivererListHref } from './deliverers.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import { listTourReservations } from './tour-reservations.js';

export const TOURS_PER_PAGE = 5;
export const TOUR_STATUS_PREPARATION = 'PREPARATION';
export const TOUR_STATUS_LOADED = 'LOADED';
export const TOUR_STATUS_COUNTED = 'COUNTED';

const TOUR_ID_PATTERN = /^[a-f\d]{24}$/iu;
const CREATION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const TOUR_LIST_PARAMETERS = new Set([
  'retour',
  'tourneeDate',
  'tourneePage',
  'tourneeRecherche',
]);

class TourCreationValidationError extends Error {
  constructor(errors) {
    super('La tournée est invalide.');
    this.name = 'TourCreationValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

const parseTourDate = (value) => {
  const normalizedValue = normalizeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalizedValue);

  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
};

const formatStoredDate = (value) => value instanceof Date
  && !Number.isNaN(value.getTime())
  ? value.toISOString().slice(0, 10)
  : '';

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const createTourReference = (tourId) =>
  `TRN-${tourId.toHexString().toLocaleUpperCase('en')}`;

const ensureTourIndexes = async (database) => {
  await Promise.all([
    database.collection('tours').createIndex(
      { creationKey: 1 },
      { name: 'unique_tour_creation_key', unique: true },
    ),
    database.collection('tours').createIndex(
      { reference: 1 },
      { name: 'unique_tour_reference', unique: true },
    ),
    database.collection('tours').createIndex(
      { delivererId: 1, plannedDate: -1, createdAt: -1, _id: -1 },
      { name: 'tour_deliverer_history' },
    ),
  ]);
};

const isSameCreationRequest = ({
  createdBy,
  delivererId,
  plannedDate,
  tour,
}) => tour.createdBy instanceof ObjectId
  && tour.createdBy.equals(createdBy)
  && tour.delivererId instanceof ObjectId
  && tour.delivererId.equals(delivererId)
  && tour.plannedDate instanceof Date
  && tour.plannedDate.getTime() === plannedDate.getTime();

const readExistingCreation = async ({
  createdBy,
  creationKey,
  database,
  delivererId,
  plannedDate,
}) => {
  const tour = await database.collection('tours').findOne(
    { creationKey },
    {
      projection: {
        createdBy: 1,
        delivererId: 1,
        plannedDate: 1,
        reference: 1,
      },
    },
  );

  if (!tour) {
    return null;
  }

  if (!isSameCreationRequest({
    createdBy,
    delivererId,
    plannedDate,
    tour,
  })) {
    return {
      errors: {
        form: 'Cette demande a déjà été utilisée avec un contenu différent.',
      },
    };
  }

  return {
    replayed: true,
    tour: {
      id: tour._id.toString(),
      reference: tour.reference,
    },
  };
};

export const createTour = async ({
  createdBy,
  creationKey,
  delivererId,
  plannedDate,
}) => {
  const errors = {};
  const parsedPlannedDate = parseTourDate(plannedDate);

  if (typeof delivererId !== 'string' || !TOUR_ID_PATTERN.test(delivererId)) {
    errors.delivererId = 'Ce livreur n’existe plus.';
  }

  if (typeof createdBy !== 'string' || !TOUR_ID_PATTERN.test(createdBy)) {
    errors.form = 'L’auteur de la demande est invalide.';
  }

  if (!parsedPlannedDate) {
    errors.plannedDate = 'Saisissez une date prévue valide.';
  }

  if (
    typeof creationKey !== 'string'
    || !CREATION_KEY_PATTERN.test(creationKey)
  ) {
    errors.form = 'La clé de création est invalide. Rechargez la fiche.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const authorObjectId = new ObjectId(createdBy);
  const delivererObjectId = new ObjectId(delivererId);
  const normalizedCreationKey = creationKey.toLocaleLowerCase('en');
  const tourId = new ObjectId();
  const reference = createTourReference(tourId);
  const createdAt = new Date();

  await ensureTourIndexes(database);

  const existingCreation = await readExistingCreation({
    createdBy: authorObjectId,
    creationKey: normalizedCreationKey,
    database,
    delivererId: delivererObjectId,
    plannedDate: parsedPlannedDate,
  });

  if (existingCreation) {
    return existingCreation;
  }

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const deliverer = await database.collection('deliverers').findOneAndUpdate(
        { _id: delivererObjectId, active: { $ne: false } },
        { $inc: { tourCreationVersion: 1 } },
        {
          projection: { code: 1, name: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!deliverer) {
        const inactiveDeliverer = await database.collection('deliverers').findOne(
          { _id: delivererObjectId },
          { projection: { active: 1 }, session },
        );

        throw new TourCreationValidationError({
          delivererId: inactiveDeliverer
            ? 'Ce livreur est désactivé.'
            : 'Ce livreur n’existe plus.',
        });
      }

      await database.collection('tours').insertOne({
        _id: tourId,
        reference,
        delivererId: delivererObjectId,
        delivererCode: deliverer.code,
        delivererName: deliverer.name,
        plannedDate: parsedPlannedDate,
        status: TOUR_STATUS_PREPARATION,
        createdAt,
        createdBy: authorObjectId,
        creationKey: normalizedCreationKey,
      }, { session });

      return {
        replayed: false,
        tour: { id: tourId.toString(), reference },
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourCreationValidationError) {
      return { errors: error.errors };
    }

    if (
      error?.code === 11000
      && (
        error?.keyPattern?.creationKey
        || error?.message?.includes('unique_tour_creation_key')
      )
    ) {
      const concurrentCreation = await readExistingCreation({
        createdBy: authorObjectId,
        creationKey: normalizedCreationKey,
        database,
        delivererId: delivererObjectId,
        plannedDate: parsedPlannedDate,
      });

      if (concurrentCreation) {
        return concurrentCreation;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

export const getTourById = async (
  id,
  { includePricing = false, userId } = {},
) => {
  await requireUserPermission(userId, 'tours.read');

  if (includePricing) {
    await requireUserPermission(userId, 'pricing.read');
  }

  if (typeof id !== 'string' || !TOUR_ID_PATTERN.test(id)) {
    return null;
  }

  const database = await getDatabase();
  const tour = await database.collection('tours').findOne({
    _id: new ObjectId(id),
  });

  if (!tour) {
    return null;
  }

  const authorIds = [...new Map(
    [tour.createdBy, tour.loadedBy, tour.countedBy]
      .filter((authorId) => authorId instanceof ObjectId)
      .map((authorId) => [authorId.toString(), authorId]),
  ).values()];
  const [authors, lines] = await Promise.all([
    authorIds.length > 0
      ? database.collection('users').find(
          { _id: { $in: authorIds } },
          { projection: { username: 1 } },
        ).toArray()
      : [],
    listTourReservations({ database, includePricing, tourId: id }),
  ]);
  const authorsById = new Map(
    authors.map((author) => [author._id.toString(), author.username]),
  );

  return {
    id: tour._id.toString(),
    reference: tour.reference,
    delivererId: tour.delivererId?.toString?.() ?? '',
    delivererCode: tour.delivererCode ?? 'Livreur inconnu',
    delivererName: tour.delivererName ?? '',
    plannedDate: formatStoredDate(tour.plannedDate),
    status: tour.status,
    createdAt: tour.createdAt?.toISOString?.() ?? null,
    createdBy: authorsById.get(tour.createdBy?.toString()) ?? null,
    loadedAt: tour.loadedAt?.toISOString?.() ?? null,
    loadedBy: authorsById.get(tour.loadedBy?.toString()) ?? null,
    countedAt: tour.countedAt?.toISOString?.() ?? null,
    countedBy: authorsById.get(tour.countedBy?.toString()) ?? null,
    lines,
  };
};

export const readDelivererTourListState = (searchParams = {}) => {
  const rawPage = readSingleValue(searchParams.tourneePage);
  const rawPlannedDate = readSingleValue(searchParams.tourneeDate);
  const rawQuery = readSingleValue(searchParams.tourneeRecherche);
  const parsedPage = typeof rawPage === 'string' && /^\d+$/u.test(rawPage)
    ? Number(rawPage)
    : 1;

  return {
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    plannedDate: parseTourDate(rawPlannedDate)
      ? normalizeText(rawPlannedDate)
      : '',
    query: typeof rawQuery === 'string'
      ? rawQuery.trim().slice(0, 100)
      : '',
  };
};

export const buildDelivererToursHref = ({
  delivererId,
  page = 1,
  plannedDate = '',
  query = '',
  returnHref = '/livreurs',
} = {}) => {
  if (typeof delivererId !== 'string' || !TOUR_ID_PATTERN.test(delivererId)) {
    return '/livreurs';
  }

  const parameters = new URLSearchParams({
    retour: validateDelivererListHref(returnHref),
  });
  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';

  if (normalizedQuery) {
    parameters.set('tourneeRecherche', normalizedQuery);
  }

  if (parseTourDate(plannedDate)) {
    parameters.set('tourneeDate', normalizeText(plannedDate));
  }

  if (Number.isSafeInteger(page) && page > 1) {
    parameters.set('tourneePage', String(page));
  }

  return `/livreurs/${delivererId}?${parameters.toString()}`;
};

export const validateTourReturnHref = (value, delivererId) => {
  const fallback = buildDelivererToursHref({ delivererId });

  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || !TOUR_ID_PATTERN.test(delivererId)
  ) {
    return fallback;
  }

  let destination;

  try {
    destination = new URL(value, 'http://syphax.local');
  } catch {
    return fallback;
  }

  if (
    destination.origin !== 'http://syphax.local'
    || destination.pathname !== `/livreurs/${delivererId}`
    || [...destination.searchParams.keys()].some(
      (parameter) => !TOUR_LIST_PARAMETERS.has(parameter),
    )
  ) {
    return fallback;
  }

  return buildDelivererToursHref({
    delivererId,
    ...readDelivererTourListState(Object.fromEntries(destination.searchParams)),
    returnHref: destination.searchParams.get('retour') ?? '/livreurs',
  });
};

export const listToursByDeliverer = async ({
  delivererId,
  page = 1,
  pageSize = TOURS_PER_PAGE,
  plannedDate = '',
  query = '',
  userId,
} = {}) => {
  await requireUserPermission(userId, 'tours.read');

  if (typeof delivererId !== 'string' || !TOUR_ID_PATTERN.test(delivererId)) {
    return null;
  }

  const normalizedQuery = typeof query === 'string'
    ? query.trim().slice(0, 100)
    : '';
  const normalizedPlannedDate = parseTourDate(plannedDate);
  const normalizedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const normalizedPageSize = Number.isSafeInteger(pageSize)
    && pageSize > 0
    && pageSize <= 100
    ? pageSize
    : TOURS_PER_PAGE;
  const filter = {
    delivererId: new ObjectId(delivererId),
    ...(normalizedQuery
      ? {
          reference: {
            $regex: escapeRegularExpression(normalizedQuery),
            $options: 'i',
          },
        }
      : {}),
    ...(normalizedPlannedDate ? { plannedDate: normalizedPlannedDate } : {}),
  };
  const database = await getDatabase();
  const tours = database.collection('tours');
  const totalItems = await tours.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const activePage = Math.min(normalizedPage, totalPages);
  const documents = await tours.find(
    filter,
    {
      projection: {
        plannedDate: 1,
        reference: 1,
        status: 1,
      },
    },
  ).sort({ plannedDate: -1, createdAt: -1, _id: -1 }).skip(
    (activePage - 1) * normalizedPageSize,
  ).limit(normalizedPageSize).toArray();

  return {
    page: activePage,
    pageSize: normalizedPageSize,
    plannedDate: normalizedPlannedDate ? formatStoredDate(normalizedPlannedDate) : '',
    query: normalizedQuery,
    totalItems,
    totalPages,
    tours: documents.map((tour) => ({
      id: tour._id.toString(),
      plannedDate: formatStoredDate(tour.plannedDate),
      reference: tour.reference,
      status: tour.status,
    })),
  };
};

export const formatTourDateInput = (date, timeZone = 'Africa/Algiers') => {
  const parts = new Intl.DateTimeFormat('en', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
};

export const formatTourDate = (value) => {
  if (typeof value !== 'string' || !parseTourDate(value)) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    day: '2-digit',
    month: 'long',
    timeZone: 'Africa/Algiers',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00.000Z`));
};

export const formatTourCreatedAt = (value, timeZone = 'Africa/Algiers') => {
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

export const formatTourStatus = (status) => {
  if (status === TOUR_STATUS_PREPARATION) {
    return 'En préparation';
  }

  if (status === TOUR_STATUS_LOADED) {
    return 'Chargée';
  }

  if (status === TOUR_STATUS_COUNTED) {
    return 'Comptée';
  }

  return 'Statut inconnu';
};
