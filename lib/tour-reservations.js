import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';
import { isPackagingEnabledForSale } from './product-packaging.js';

import { getMongoClient } from './mongodb.js';
import {
  ACTIVE_RESERVATION_STATUS,
  getEmptyProductStockSummary,
  getProductStockSummaries,
} from './stock-movements.js';

const ADDITION_KEY_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
const QUANTITY_MODES = new Set(['DIRECT', 'PACKAGING']);
export const RELEASED_RESERVATION_STATUS = 'RELEASED';
export const LOADED_RESERVATION_STATUS = 'LOADED';
const TOUR_STATUS_PREPARATION = 'PREPARATION';

class TourReservationValidationError extends Error {
  constructor(errors) {
    super('La réservation de tournée est invalide.');
    this.name = 'TourReservationValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const parsePositiveInteger = (value) => {
  const normalizedValue = normalizeText(value);

  if (!/^\d+$/u.test(normalizedValue)) {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
};

const normalizeRequest = ({
  additionKey,
  createdBy,
  directQuantity,
  packagingCount,
  packagingId,
  productId,
  quantityMode,
  tourId,
}) => ({
  additionKey: normalizeText(additionKey).toLocaleLowerCase('en'),
  createdBy: normalizeText(createdBy),
  directQuantity: normalizeText(directQuantity),
  packagingCount: normalizeText(packagingCount),
  packagingId: normalizeText(packagingId),
  productId: normalizeText(productId),
  quantityMode: normalizeText(quantityMode),
  tourId: normalizeText(tourId),
});

const createRequestDigest = (request) => createHash('sha256')
  .update(JSON.stringify({
    createdBy: request.createdBy,
    tourId: request.tourId,
    productId: request.productId,
    quantityMode: request.quantityMode,
    ...(request.quantityMode === 'PACKAGING'
      ? {
          packagingCount: request.packagingCount,
          packagingId: request.packagingId,
        }
      : { directQuantity: request.directQuantity }),
  }))
  .digest('hex');

const dropIndexIfPresent = async (collection, name) => {
  try {
    await collection.dropIndex(name);
  } catch (error) {
    if (error?.codeName !== 'IndexNotFound' && error?.code !== 27) {
      throw error;
    }
  }
};

export const ensureTourReservationIndexes = async (database) => {
  const reservations = database.collection('tourReservations');

  await reservations.createIndex(
    { additionKey: 1 },
    {
      name: 'unique_tour_product_addition_key',
      partialFilterExpression: { additionKey: { $type: 'string' } },
      unique: true,
    },
  );

  const indexes = await reservations.listIndexes().toArray();
  const indexNames = new Set(indexes.map((index) => index.name));
  const legacyIndexName = 'unique_tour_product';
  const migrationGuardIndexName = 'unique_active_tour_product_migration_guard';

  if (indexNames.has(legacyIndexName)) {
    // Le garde conserve l'unicité ACTIVE pendant la courte fenêtre où
    // l'ancien index global est remplacé par son équivalent partiel.
    await reservations.createIndex(
      { tourId: 1, productId: 1, status: 1 },
      {
        name: migrationGuardIndexName,
        partialFilterExpression: { status: ACTIVE_RESERVATION_STATUS },
        unique: true,
      },
    );
    await dropIndexIfPresent(reservations, legacyIndexName);
  }

  await reservations.createIndex(
    { tourId: 1, productId: 1 },
    {
      name: 'unique_active_tour_product',
      partialFilterExpression: { status: ACTIVE_RESERVATION_STATUS },
      unique: true,
    },
  );
  await dropIndexIfPresent(reservations, migrationGuardIndexName);

  await Promise.all([
    reservations.createIndex(
      { productId: 1, status: 1 },
      { name: 'active_reservation_product' },
    ),
    reservations.createIndex(
      { tourId: 1, reservedAt: 1, _id: 1 },
      { name: 'tour_reserved_lines' },
    ),
  ]);
};

const readExistingAddition = async ({
  additionKey,
  database,
  requestDigest,
  session,
}) => {
  const reservation = await database.collection('tourReservations').findOne(
    { additionKey },
    {
      projection: {
        productId: 1,
        requestDigest: 1,
        status: 1,
        tourId: 1,
      },
      session,
    },
  );

  if (!reservation) {
    return null;
  }

  if (reservation.requestDigest !== requestDigest) {
    return {
      errors: {
        form: 'Cette demande a déjà été utilisée avec un contenu différent.',
      },
    };
  }

  return {
    replayed: true,
    released: reservation.status === RELEASED_RESERVATION_STATUS,
    reservation: {
      id: reservation._id.toString(),
      productId: reservation.productId.toString(),
      tourId: reservation.tourId.toString(),
    },
  };
};

const calculateRequestedQuantity = ({ product, request }) => {
  if (request.quantityMode === 'DIRECT') {
    const directQuantity = parsePositiveInteger(request.directQuantity);

    return directQuantity === null
      ? {
          errors: {
            directQuantity: 'Saisissez une quantité entière strictement positive.',
          },
        }
      : {
          conversionFactor: 1,
          quantityInBaseUnits: directQuantity,
        };
  }

  if (request.quantityMode !== 'PACKAGING') {
    return {
      errors: { quantityMode: 'Sélectionnez un mode de saisie valide.' },
    };
  }

  if (!ObjectId.isValid(request.packagingId)) {
    return {
      errors: { packagingId: 'Sélectionnez un conditionnement existant.' },
    };
  }

  const packagingObjectId = new ObjectId(request.packagingId);
  const packaging = product.packagings.find(
    (candidate) => candidate._id?.equals?.(packagingObjectId),
  );
  const packagingCount = parsePositiveInteger(request.packagingCount);

  if (!packaging) {
    return {
      errors: { packagingId: 'Ce conditionnement n’existe plus.' },
    };
  }

  if (!isPackagingEnabledForSale(packaging)) {
    return {
      errors: { packagingId: 'Ce conditionnement n’est pas activé pour la vente.' },
    };
  }

  if (packagingCount === null) {
    return {
      errors: {
        packagingCount: 'Saisissez un nombre entier de conditionnements strictement positif.',
      },
    };
  }

  const quantityInBaseUnits = packaging.quantity * packagingCount;

  if (!Number.isSafeInteger(quantityInBaseUnits) || quantityInBaseUnits <= 0) {
    return {
      errors: {
        packagingCount: 'La conversion dépasse la quantité maximale autorisée.',
      },
    };
  }

  return {
    conversionFactor: packaging.quantity,
    packaging,
    packagingCount,
    quantityInBaseUnits,
  };
};

export const addAndReserveTourProduct = async (input) => {
  const request = normalizeRequest(input ?? {});
  const errors = {};

  if (!ADDITION_KEY_PATTERN.test(request.additionKey)) {
    errors.form = 'La clé d’ajout est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(request.createdBy)) {
    errors.form = 'L’auteur de la demande est invalide.';
  }

  if (!ObjectId.isValid(request.tourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (!ObjectId.isValid(request.productId)) {
    errors.productId = 'Sélectionnez un produit existant.';
  }

  if (!QUANTITY_MODES.has(request.quantityMode)) {
    errors.quantityMode = 'Sélectionnez un mode de saisie valide.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const requestDigest = createRequestDigest(request);

  await ensureTourReservationIndexes(database);

  const existingAddition = await readExistingAddition({
    additionKey: request.additionKey,
    database,
    requestDigest,
  });

  if (existingAddition) {
    return existingAddition;
  }

  const authorObjectId = new ObjectId(request.createdBy);
  const productObjectId = new ObjectId(request.productId);
  const tourObjectId = new ObjectId(request.tourId);
  const reservationId = new ObjectId();
  const reservedAt = new Date();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        { $inc: { reservationReferenceVersion: 1 } },
        {
          projection: { delivererId: 1, reference: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!tour) {
        const currentTour = await database.collection('tours').findOne(
          { _id: tourObjectId },
          { projection: { status: 1 }, session },
        );

        throw new TourReservationValidationError({
          form: currentTour
            ? 'Cette tournée n’est plus en préparation.'
            : 'Cette tournée n’existe plus.',
        });
      }

      const replayedAddition = await readExistingAddition({
        additionKey: request.additionKey,
        database,
        requestDigest,
        session,
      });

      if (replayedAddition) {
        if (replayedAddition.errors) {
          throw new TourReservationValidationError(
            replayedAddition.errors,
          );
        }

        return replayedAddition;
      }

      const deliverer = await database.collection('deliverers').findOneAndUpdate(
        { _id: tour.delivererId, active: { $ne: false } },
        { $inc: { reservationReferenceVersion: 1 } },
        { projection: { _id: 1 }, returnDocument: 'after', session },
      );

      if (!deliverer) {
        throw new TourReservationValidationError({
          form: 'Le livreur de cette tournée est désactivé ou n’existe plus.',
        });
      }

      // Cette écriture est le point de sérialisation commun aux réceptions,
      // réservations, suppressions et changements d’unité du produit.
      const product = await database.collection('products').findOneAndUpdate(
        { _id: productObjectId, active: { $ne: false } },
        { $inc: { stockReferenceVersion: 1 } },
        {
          projection: {
            baseUnit: 1,
            code: 1,
            designation: 1,
            packagings: 1,
          },
          returnDocument: 'after',
          session,
        },
      );

      if (!product) {
        throw new TourReservationValidationError({
          productId: 'Ce produit est supprimé ou inutilisable.',
        });
      }

      product.packagings = Array.isArray(product.packagings)
        ? product.packagings
        : [];

      const calculation = calculateRequestedQuantity({ product, request });

      if (calculation.errors) {
        throw new TourReservationValidationError(calculation.errors);
      }

      const existingProduct = await database
        .collection('tourReservations')
        .findOne(
          {
            tourId: tourObjectId,
            productId: productObjectId,
            status: ACTIVE_RESERVATION_STATUS,
          },
          { projection: { _id: 1 }, session },
        );

      if (existingProduct) {
        throw new TourReservationValidationError({
          productId: 'Ce produit est déjà présent dans cette tournée.',
        });
      }

      const stockSummaries = await getProductStockSummaries(
        [productObjectId],
        { database, session },
      );
      const stock = stockSummaries.get(productObjectId.toString())
        ?? getEmptyProductStockSummary();

      if (
        !Number.isSafeInteger(stock.availableQuantityInBaseUnits)
        || calculation.quantityInBaseUnits > stock.availableQuantityInBaseUnits
      ) {
        throw new TourReservationValidationError({
          quantity: `Stock insuffisant : ${stock.availableQuantityInBaseUnits} unité(s) disponible(s).`,
        });
      }

      const reservation = {
        _id: reservationId,
        additionKey: request.additionKey,
        requestDigest,
        tourId: tourObjectId,
        tourReference: tour.reference,
        productId: productObjectId,
        productCode: product.code,
        productDesignation: product.designation,
        baseUnit: product.baseUnit,
        quantityMode: request.quantityMode,
        conversionFactor: calculation.conversionFactor,
        quantityInBaseUnits: calculation.quantityInBaseUnits,
        ...(calculation.packaging
          ? {
              packaging: {
                packagingId: calculation.packaging._id,
                label: calculation.packaging.label,
                quantity: calculation.packaging.quantity,
                count: calculation.packagingCount,
              },
            }
          : {}),
        status: ACTIVE_RESERVATION_STATUS,
        reservedAt,
        reservedBy: authorObjectId,
      };

      await database.collection('tourReservations').insertOne(
        reservation,
        { session },
      );

      return {
        replayed: false,
        reservation: {
          id: reservationId.toString(),
          productId: productObjectId.toString(),
          tourId: tourObjectId.toString(),
        },
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourReservationValidationError) {
      return { errors: error.errors };
    }

    if (error?.code === 11000) {
      const concurrentAddition = await readExistingAddition({
        additionKey: request.additionKey,
        database,
        requestDigest,
      });

      if (concurrentAddition) {
        return concurrentAddition;
      }

      if (
        error?.keyPattern?.tourId
        || error?.message?.includes('unique_active_tour_product')
      ) {
        return {
          errors: {
            productId: 'Ce produit est déjà présent dans cette tournée.',
          },
        };
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

class ReleasedTourReservationReplayError extends Error {
  constructor(reservation) {
    super('Cette réservation a déjà été libérée.');
    this.name = 'ReleasedTourReservationReplayError';
    this.reservation = reservation;
  }
}

const normalizeReleaseRequest = ({ releasedBy, reservationId, tourId }) => ({
  releasedBy: normalizeText(releasedBy),
  reservationId: normalizeText(reservationId),
  tourId: normalizeText(tourId),
});

export const releaseTourReservation = async (input) => {
  const request = normalizeReleaseRequest(input ?? {});
  const errors = {};

  if (!ObjectId.isValid(request.releasedBy)) {
    errors.form = 'L’auteur de la demande est invalide.';
  }

  if (!ObjectId.isValid(request.tourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (!ObjectId.isValid(request.reservationId)) {
    errors.form = 'Cette réservation n’existe plus.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const releasedByObjectId = new ObjectId(request.releasedBy);
  const reservationObjectId = new ObjectId(request.reservationId);
  const tourObjectId = new ObjectId(request.tourId);

  await ensureTourReservationIndexes(database);

  const requestedReservation = await database.collection('tourReservations')
    .findOne(
      { _id: reservationObjectId },
      { projection: { productId: 1, tourId: 1 } },
    );

  if (!requestedReservation) {
    return { errors: { form: 'Cette réservation n’existe plus.' } };
  }

  if (!requestedReservation.tourId?.equals?.(tourObjectId)) {
    return {
      errors: {
        form: 'Cette réservation n’appartient pas à la tournée demandée.',
      },
    };
  }

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        { $inc: { reservationReferenceVersion: 1 } },
        {
          projection: { _id: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!tour) {
        const currentTour = await database.collection('tours').findOne(
          { _id: tourObjectId },
          { projection: { status: 1 }, session },
        );

        throw new TourReservationValidationError({
          form: currentTour
            ? 'Cette tournée n’est plus en préparation.'
            : 'Cette tournée n’existe plus.',
        });
      }

      const reservation = await database.collection('tourReservations')
        .findOne(
          { _id: reservationObjectId, tourId: tourObjectId },
          { projection: { productId: 1, status: 1 }, session },
        );

      if (!reservation) {
        throw new TourReservationValidationError({
          form: 'Cette réservation n’appartient pas à la tournée demandée.',
        });
      }

      // Même point de sérialisation produit que les réceptions et ajouts.
      const product = await database.collection('products').findOneAndUpdate(
        { _id: reservation.productId },
        { $inc: { stockReferenceVersion: 1 } },
        { projection: { _id: 1 }, returnDocument: 'after', session },
      );

      if (!product) {
        throw new TourReservationValidationError({
          form: 'Le produit de cette réservation n’existe plus.',
        });
      }

      const releasedReservation = await database
        .collection('tourReservations')
        .findOneAndUpdate(
          {
            _id: reservationObjectId,
            status: ACTIVE_RESERVATION_STATUS,
            tourId: tourObjectId,
          },
          {
            $set: {
              releasedAt: new Date(),
              releasedBy: releasedByObjectId,
              status: RELEASED_RESERVATION_STATUS,
            },
          },
          {
            projection: { productId: 1, tourId: 1 },
            returnDocument: 'after',
            session,
          },
        );

      if (!releasedReservation) {
        if (reservation.status === RELEASED_RESERVATION_STATUS) {
          throw new ReleasedTourReservationReplayError({
            id: reservationObjectId.toString(),
            productId: reservation.productId.toString(),
            tourId: tourObjectId.toString(),
          });
        }

        throw new TourReservationValidationError({
          form: 'Cette réservation n’est plus active.',
        });
      }

      return {
        replayed: false,
        reservation: {
          id: reservationObjectId.toString(),
          productId: releasedReservation.productId.toString(),
          tourId: releasedReservation.tourId.toString(),
        },
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof ReleasedTourReservationReplayError) {
      return {
        replayed: true,
        reservation: error.reservation,
      };
    }

    if (error instanceof TourReservationValidationError) {
      return { errors: error.errors };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

const serializeSalePriceAtLoading = (salePrice) => {
  if (
    !Number.isSafeInteger(salePrice?.amountInCentimes)
    || salePrice.amountInCentimes < 0
    || salePrice.currency !== 'DZD'
    || salePrice.taxIncluded !== true
    || typeof salePrice.unit !== 'string'
    || !salePrice.unit
  ) {
    return null;
  }

  const sourceUpdatedAt = salePrice.sourceUpdatedAt instanceof Date
    && !Number.isNaN(salePrice.sourceUpdatedAt.getTime())
    ? salePrice.sourceUpdatedAt.toISOString()
    : null;

  return {
    amountInCentimes: salePrice.amountInCentimes,
    currency: salePrice.currency,
    sourceUpdatedAt,
    sourceUpdatedBy: salePrice.sourceUpdatedBy?.toString?.() ?? null,
    sourceVersionId: salePrice.sourceVersionId?.toString?.() ?? null,
    taxIncluded: salePrice.taxIncluded,
    unit: salePrice.unit,
  };
};

export const listTourReservations = async ({
  database,
  includeReleased = false,
  includePricing = false,
  tourId,
}) => {
  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return [];
  }

  const documents = await database.collection('tourReservations').find(
    {
      status: {
        $in: [
          ACTIVE_RESERVATION_STATUS,
          LOADED_RESERVATION_STATUS,
          ...(includeReleased ? [RELEASED_RESERVATION_STATUS] : []),
        ],
      },
      tourId: new ObjectId(tourId),
    },
    {
      projection: {
        baseUnit: 1,
        packaging: 1,
        productCode: 1,
        productDesignation: 1,
        productId: 1,
        quantityInBaseUnits: 1,
        quantityMode: 1,
        reservedAt: 1,
        reservedBy: 1,
        ...(includePricing ? { salePriceAtLoading: 1 } : {}),
        status: 1,
      },
    },
  ).sort({ reservedAt: 1, _id: 1 }).toArray();

  return documents.map((reservation) => ({
    id: reservation._id.toString(),
    baseUnit: reservation.baseUnit,
    packaging: reservation.packaging
      ? {
          id: reservation.packaging.packagingId?.toString?.() ?? '',
          count: reservation.packaging.count,
          label: reservation.packaging.label,
          quantity: reservation.packaging.quantity,
        }
      : null,
    productCode: reservation.productCode,
    productDesignation: reservation.productDesignation,
    productId: reservation.productId.toString(),
    quantityInBaseUnits: reservation.quantityInBaseUnits,
    quantityMode: reservation.quantityMode,
    reservedAt: reservation.reservedAt?.toISOString?.() ?? null,
    ...(includePricing
      ? {
          salePriceAtLoading: serializeSalePriceAtLoading(
            reservation.salePriceAtLoading,
          ),
        }
      : {}),
    status: reservation.status,
  }));
};
