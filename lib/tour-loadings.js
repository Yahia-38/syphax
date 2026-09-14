import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { getDatabase, getMongoClient } from './mongodb.js';
import {
  ACTIVE_RESERVATION_STATUS,
  TOUR_LOADING_OUTPUT_KIND,
  ensureStockMovementIndexes,
  getEmptyProductStockSummary,
  getProductStockSummaries,
} from './stock-movements.js';
import {
  LOADED_RESERVATION_STATUS,
  ensureTourReservationIndexes,
} from './tour-reservations.js';
import {
  TOUR_STATUS_LOADED,
  TOUR_STATUS_PREPARATION,
} from './tours.js';

const LOADING_DIGEST_PATTERN = /^[\da-f]{64}$/u;

class TourLoadingValidationError extends Error {
  constructor(errors) {
    super('Le chargement de la tournée est invalide.');
    this.name = 'TourLoadingValidationError';
    this.errors = errors;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeIdentifier = (value) =>
  value instanceof ObjectId ? value.toString() : value ?? null;

const normalizeDate = (value) => value instanceof Date
  ? value.toISOString()
  : typeof value === 'string'
    ? value
    : null;

const serializeSalePrice = (salePrice) => salePrice
  ? {
      amountInCentimes: salePrice.amountInCentimes,
      currency: salePrice.currency,
      sourceUpdatedAt: normalizeDate(salePrice.sourceUpdatedAt),
      sourceUpdatedBy: normalizeIdentifier(salePrice.sourceUpdatedBy),
      sourceVersionId: normalizeIdentifier(salePrice.sourceVersionId),
      taxIncluded: salePrice.taxIncluded,
      unit: salePrice.unit,
    }
  : null;

const serializeLoadingLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({
    baseUnit: line.baseUnit,
    id: line.id ?? line._id?.toString?.(),
    productId: line.productId?.toString?.() ?? line.productId,
    quantityInBaseUnits: line.quantityInBaseUnits,
    salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading),
    status: line.status,
  }))
  .sort((firstLine, secondLine) => firstLine.id.localeCompare(secondLine.id));

export const createTourLoadingDigest = (lines) => createHash('sha256')
  .update(JSON.stringify(serializeLoadingLines(lines)))
  .digest('hex');

const getLoadedProductIds = async ({ database, session, tourId }) => {
  const reservations = await database.collection('tourReservations').find(
    { status: LOADED_RESERVATION_STATUS, tourId },
    { projection: { productId: 1 }, session },
  ).toArray();

  return [...new Set(
    reservations
      .map((reservation) => reservation.productId?.toString?.())
      .filter(Boolean),
  )];
};

const validateLoadingLines = (reservations) => {
  for (const reservation of reservations) {
    if (
      !(reservation._id instanceof ObjectId)
      || !(reservation.productId instanceof ObjectId)
      || typeof reservation.productCode !== 'string'
      || !reservation.productCode
      || typeof reservation.productDesignation !== 'string'
      || !reservation.productDesignation
      || typeof reservation.baseUnit !== 'string'
      || !reservation.baseUnit
      || !Number.isSafeInteger(reservation.quantityInBaseUnits)
      || reservation.quantityInBaseUnits <= 0
    ) {
      throw new TourLoadingValidationError({
        form: 'Une ligne de réservation contient une référence ou une quantité invalide.',
      });
    }
  }
};

const readActiveReservations = async ({ database, session, tourId }) =>
  database.collection('tourReservations').find(
    { status: ACTIVE_RESERVATION_STATUS, tourId },
    {
      projection: {
        baseUnit: 1,
        productCode: 1,
        productDesignation: 1,
        productId: 1,
        quantityInBaseUnits: 1,
        status: 1,
      },
      session,
    },
  ).sort({ _id: 1 }).toArray();

const getProductLabel = (reservation) =>
  `${reservation.productCode} — ${reservation.productDesignation}`;

const createSalePriceSnapshot = ({ product, reservation }) => {
  if (!product) {
    throw new TourLoadingValidationError({
      form: `Le produit ${getProductLabel(reservation)} n’existe plus.`,
    });
  }

  if (product.baseUnit !== reservation.baseUnit) {
    throw new TourLoadingValidationError({
      form: `L’unité de base du produit ${getProductLabel(reservation)} ne correspond plus à la ligne réservée.`,
    });
  }

  const salePrice = product.salePrice;

  if (!Number.isSafeInteger(salePrice?.amountInCentimes)) {
    throw new TourLoadingValidationError({
      form: `Le prix de vente TTC au chargement n’est pas renseigné pour ${getProductLabel(reservation)}.`,
    });
  }

  if (
    salePrice.amountInCentimes < 1
    || salePrice.currency !== 'DZD'
    || salePrice.taxIncluded !== true
  ) {
    throw new TourLoadingValidationError({
      form: `Le tarif de vente de ${getProductLabel(reservation)} n’est pas un prix TTC valide en DZD par ${reservation.baseUnit}.`,
    });
  }

  return {
    amountInCentimes: salePrice.amountInCentimes,
    currency: salePrice.currency,
    ...(salePrice.updatedAt instanceof Date
      ? { sourceUpdatedAt: salePrice.updatedAt }
      : {}),
    ...(salePrice.updatedBy instanceof ObjectId
      ? { sourceUpdatedBy: salePrice.updatedBy }
      : {}),
    ...(salePrice.versionId instanceof ObjectId
      ? { sourceVersionId: salePrice.versionId }
      : {}),
    taxIncluded: salePrice.taxIncluded,
    unit: product.baseUnit,
  };
};

const calculateLoadedValueInCentimes = ({
  quantityInBaseUnits,
  salePriceAtLoading,
  reservation,
}) => {
  const valueInCentimes = quantityInBaseUnits
    * salePriceAtLoading.amountInCentimes;

  if (!Number.isSafeInteger(valueInCentimes) || valueInCentimes < 0) {
    throw new TourLoadingValidationError({
      form: `La valeur des marchandises chargées dépasse la limite autorisée pour ${getProductLabel(reservation)}.`,
    });
  }

  return valueInCentimes;
};

const priceLoadingLines = ({ productsById, reservations }) =>
  reservations.map((reservation) => {
    const salePriceAtLoading = createSalePriceSnapshot({
      product: productsById.get(reservation.productId.toString()),
      reservation,
    });
    const loadedValueInCentimes = calculateLoadedValueInCentimes({
      quantityInBaseUnits: reservation.quantityInBaseUnits,
      reservation,
      salePriceAtLoading,
    });

    return {
      ...reservation,
      loadedValueInCentimes,
      salePriceAtLoading,
    };
  });

const summarizeLoadedValue = (lines) => {
  let totalValueInCentimes = 0;

  for (const line of lines) {
    totalValueInCentimes += line.loadedValueInCentimes;

    if (!Number.isSafeInteger(totalValueInCentimes)) {
      throw new TourLoadingValidationError({
        form: 'La valeur totale des marchandises chargées dépasse la limite autorisée.',
      });
    }
  }

  return totalValueInCentimes;
};

const serializePricedLine = (line) => ({
  baseUnit: line.baseUnit,
  id: line._id.toString(),
  loadedValueInCentimes: line.loadedValueInCentimes,
  productCode: line.productCode,
  productDesignation: line.productDesignation,
  productId: line.productId.toString(),
  quantityInBaseUnits: line.quantityInBaseUnits,
  salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading),
  status: line.status,
});

export const getTourLoadingPreview = async ({ tourId, userId }) => {
  await requireUserPermission(userId, 'tours.load');
  await requireUserPermission(userId, 'tours.read');
  await requireUserPermission(userId, 'pricing.read');

  if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
    return { errors: { form: 'Cette tournée n’existe plus.' }, lines: [] };
  }

  const database = await getDatabase();
  const tourObjectId = new ObjectId(tourId);
  const reservations = await readActiveReservations({
    database,
    tourId: tourObjectId,
  });

  if (reservations.length === 0) {
    return {
      errors: {
        form: 'Cette tournée ne contient aucune réservation active à charger.',
      },
      lines: [],
    };
  }

  try {
    validateLoadingLines(reservations);

    const productIds = [...new Map(
      reservations.map((reservation) => [
        reservation.productId.toString(),
        reservation.productId,
      ]),
    ).values()];
    const products = await database.collection('products').find(
      { _id: { $in: productIds } },
      { projection: { baseUnit: 1, salePrice: 1 } },
    ).toArray();
    const productsById = new Map(
      products.map((product) => [product._id.toString(), product]),
    );
    const pricedLines = priceLoadingLines({ productsById, reservations });

    return {
      digest: createTourLoadingDigest(pricedLines),
      errors: {},
      lines: pricedLines.map(serializePricedLine),
      totalValueInCentimes: summarizeLoadedValue(pricedLines),
    };
  } catch (error) {
    if (error instanceof TourLoadingValidationError) {
      return { errors: error.errors, lines: [] };
    }

    throw error;
  }
};

const lockAndValidateProducts = async ({
  database,
  productIds,
  reservations,
  session,
}) => {
  const productsById = new Map();

  for (const productId of productIds) {
    const product = await database.collection('products').findOneAndUpdate(
      { _id: productId },
      { $inc: { stockReferenceVersion: 1 } },
      {
        projection: { baseUnit: 1, salePrice: 1 },
        returnDocument: 'after',
        session,
      },
    );

    if (!product) {
      throw new TourLoadingValidationError({
        form: 'Un produit réservé n’existe plus.',
      });
    }

    productsById.set(product._id.toString(), product);
  }

  for (const reservation of reservations) {
    const product = productsById.get(reservation.productId.toString());

    if (!product || product.baseUnit !== reservation.baseUnit) {
      throw new TourLoadingValidationError({
        form: 'L’unité de base d’un produit réservé est incohérente.',
      });
    }
  }

  return productsById;
};

const assertPhysicalStockCoversReservations = async ({
  database,
  productIds,
  session,
}) => {
  const activeReservations = await database.collection('tourReservations').find(
    {
      productId: { $in: productIds },
      status: ACTIVE_RESERVATION_STATUS,
    },
    { projection: { productId: 1, quantityInBaseUnits: 1 }, session },
  ).toArray();
  const reservedByProduct = new Map(productIds.map((productId) => [
    productId.toString(),
    0,
  ]));

  for (const reservation of activeReservations) {
    if (
      !(reservation.productId instanceof ObjectId)
      || !Number.isSafeInteger(reservation.quantityInBaseUnits)
      || reservation.quantityInBaseUnits <= 0
    ) {
      throw new TourLoadingValidationError({
        form: 'Une réservation active contient une référence ou une quantité invalide.',
      });
    }

    const productId = reservation.productId.toString();
    const total = reservedByProduct.get(productId);

    if (!Number.isSafeInteger(total + reservation.quantityInBaseUnits)) {
      throw new TourLoadingValidationError({
        form: 'Le total réservé dépasse la quantité maximale autorisée.',
      });
    }

    reservedByProduct.set(productId, total + reservation.quantityInBaseUnits);
  }

  const stockSummaries = await getProductStockSummaries(productIds, {
    database,
    session,
  });

  for (const productId of productIds) {
    const normalizedProductId = productId.toString();
    const stock = stockSummaries.get(normalizedProductId)
      ?? getEmptyProductStockSummary();
    const reservedQuantity = reservedByProduct.get(normalizedProductId);

    if (
      !Number.isSafeInteger(stock.quantityInBaseUnits)
      || !Number.isSafeInteger(stock.reservedQuantityInBaseUnits)
      || stock.reservedQuantityInBaseUnits !== reservedQuantity
      || stock.quantityInBaseUnits < reservedQuantity
    ) {
      throw new TourLoadingValidationError({
        form: 'Le stock physique ne couvre plus l’ensemble des réservations actives. Vérifiez le stock avant de confirmer.',
      });
    }
  }
};

export const confirmTourLoading = async ({
  expectedDigest,
  loadedBy,
  tourId,
}) => {
  const normalizedExpectedDigest = normalizeText(expectedDigest)
    .toLocaleLowerCase('en');
  const normalizedLoadedBy = normalizeText(loadedBy);
  const normalizedTourId = normalizeText(tourId);
  const errors = {};

  if (!LOADING_DIGEST_PATTERN.test(normalizedExpectedDigest)) {
    errors.form = 'Le récapitulatif de chargement est invalide. Rechargez la fiche.';
  }

  if (!ObjectId.isValid(normalizedLoadedBy)) {
    errors.form = 'L’auteur du chargement est invalide.';
  }

  if (!ObjectId.isValid(normalizedTourId)) {
    errors.form = 'Cette tournée n’existe plus.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const loadedByObjectId = new ObjectId(normalizedLoadedBy);
  const tourObjectId = new ObjectId(normalizedTourId);

  await Promise.all([
    ensureStockMovementIndexes(database),
    ensureTourReservationIndexes(database),
  ]);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      await requireUserPermission(normalizedLoadedBy, 'tours.load', {
        database,
        session,
      });
      await requireUserPermission(normalizedLoadedBy, 'tours.read', {
        database,
        session,
      });
      await requireUserPermission(normalizedLoadedBy, 'pricing.read', {
        database,
        session,
      });

      const tour = await database.collection('tours').findOneAndUpdate(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        { $inc: { loadingReferenceVersion: 1 } },
        {
          projection: { delivererId: 1, reference: 1 },
          returnDocument: 'after',
          session,
        },
      );

      if (!tour) {
        const currentTour = await database.collection('tours').findOne(
          { _id: tourObjectId },
          {
            projection: {
              delivererId: 1,
              loadedAt: 1,
              loadedBy: 1,
              loadedReservationDigest: 1,
              status: 1,
            },
            session,
          },
        );

        if (
          currentTour?.status === TOUR_STATUS_LOADED
          && currentTour.loadedReservationDigest === normalizedExpectedDigest
        ) {
          return {
            delivererId: currentTour.delivererId?.toString?.() ?? null,
            loadedAt: currentTour.loadedAt?.toISOString?.() ?? null,
            loadedBy: currentTour.loadedBy?.toString?.() ?? null,
            productIds: await getLoadedProductIds({
              database,
              session,
              tourId: tourObjectId,
            }),
            replayed: true,
            tourId: normalizedTourId,
          };
        }

        throw new TourLoadingValidationError({
          form: currentTour
            ? 'Cette tournée n’est plus en préparation.'
            : 'Cette tournée n’existe plus.',
        });
      }

      if (!(tour.delivererId instanceof ObjectId)) {
        throw new TourLoadingValidationError({
          form: 'Le livreur de cette tournée est invalide.',
        });
      }

      const deliverer = await database.collection('deliverers').findOneAndUpdate(
        { _id: tour.delivererId, active: { $ne: false } },
        { $inc: { loadingReferenceVersion: 1 } },
        { projection: { _id: 1 }, returnDocument: 'after', session },
      );

      if (!deliverer) {
        throw new TourLoadingValidationError({
          form: 'Le livreur de cette tournée est désactivé ou n’existe plus.',
        });
      }

      const reservations = await readActiveReservations({
        database,
        session,
        tourId: tourObjectId,
      });

      if (reservations.length === 0) {
        throw new TourLoadingValidationError({
          form: 'Cette tournée ne contient aucune réservation active à charger.',
        });
      }

      validateLoadingLines(reservations);

      const productIds = [...new Map(
        reservations.map((reservation) => [
          reservation.productId.toString(),
          reservation.productId,
        ]),
      ).values()].sort((firstId, secondId) =>
        firstId.toString().localeCompare(secondId.toString()));

      // Cette écriture partage le document produit avec la mise à jour du
      // tarif. MongoDB sérialise donc les deux opérations ; en cas de conflit,
      // la transaction est retentée puis l’empreinte est vérifiée à nouveau.
      const productsById = await lockAndValidateProducts({
        database,
        productIds,
        reservations,
        session,
      });
      const pricedReservations = priceLoadingLines({
        productsById,
        reservations,
      });

      summarizeLoadedValue(pricedReservations);

      if (
        createTourLoadingDigest(pricedReservations)
        !== normalizedExpectedDigest
      ) {
        throw new TourLoadingValidationError({
          form: 'Les quantités ou les tarifs applicables ont changé depuis le récapitulatif. Vérifiez-les puis confirmez à nouveau.',
        });
      }

      await assertPhysicalStockCoversReservations({
        database,
        productIds,
        session,
      });

      const loadedAt = new Date();
      const movements = reservations.map((reservation) => ({
        _id: new ObjectId(),
        kind: TOUR_LOADING_OUTPUT_KIND,
        productId: reservation.productId,
        baseUnit: reservation.baseUnit,
        quantityDeltaInBaseUnits: -reservation.quantityInBaseUnits,
        occurredOn: loadedAt,
        recordedAt: loadedAt,
        recordedBy: loadedByObjectId,
        sourceTourId: tourObjectId,
        sourceTourReservationId: reservation._id,
        tourReference: tour.reference,
      }));

      await database.collection('stockMovements').insertMany(movements, {
        session,
      });

      const reservationTransition = await database
        .collection('tourReservations')
        .bulkWrite(
          pricedReservations.map((reservation) => ({
            updateOne: {
              filter: {
                _id: reservation._id,
                status: ACTIVE_RESERVATION_STATUS,
                tourId: tourObjectId,
              },
              update: {
                $set: {
                  loadedAt,
                  loadedBy: loadedByObjectId,
                  salePriceAtLoading: reservation.salePriceAtLoading,
                  status: LOADED_RESERVATION_STATUS,
                },
              },
            },
          })),
          { session },
        );

      if (reservationTransition.modifiedCount !== reservations.length) {
        throw new TourLoadingValidationError({
          form: 'Les réservations ont changé pendant le chargement.',
        });
      }

      const tourTransition = await database.collection('tours').updateOne(
        { _id: tourObjectId, status: TOUR_STATUS_PREPARATION },
        {
          $set: {
            loadedAt,
            loadedBy: loadedByObjectId,
            loadedReservationDigest: normalizedExpectedDigest,
            status: TOUR_STATUS_LOADED,
          },
        },
        { session },
      );

      if (tourTransition.modifiedCount !== 1) {
        throw new TourLoadingValidationError({
          form: 'La tournée a changé pendant le chargement.',
        });
      }

      return {
        delivererId: tour.delivererId.toString(),
        loadedAt: loadedAt.toISOString(),
        loadedBy: normalizedLoadedBy,
        productIds: productIds.map((productId) => productId.toString()),
        replayed: false,
        tourId: normalizedTourId,
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof TourLoadingValidationError) {
      return { errors: error.errors };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
