import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission, userHasPermission } from './access.js';
import { getMongoClient } from './mongodb.js';
import { isPackagingEnabledForSale } from './product-packaging.js';
import { calculateSaleValueInCentimes } from './tour-counting-calculations.js';
import { ensureStockValuationIndexes } from './stock-valuations.js';
import {
  applyTourLoadingStockValuations,
  prepareTourLoadingStockValuations,
} from './tour-loading-stock-valuations.js';
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

const serializePackagingSalePrice = (packaging) => ({
  amountInCentimes: packaging.amountInCentimes,
  currency: packaging.currency,
  label: packaging.label,
  packagingId: normalizeIdentifier(packaging.packagingId),
  quantity: packaging.quantity,
  sourceUpdatedAt: normalizeDate(packaging.sourceUpdatedAt),
  sourceUpdatedBy: normalizeIdentifier(packaging.sourceUpdatedBy),
  sourceVersionId: normalizeIdentifier(packaging.sourceVersionId),
  taxIncluded: packaging.taxIncluded,
});

const serializeSalePrice = (salePrice) => salePrice
  ? {
      amountInCentimes: salePrice.amountInCentimes,
      currency: salePrice.currency,
      sourceUpdatedAt: normalizeDate(salePrice.sourceUpdatedAt),
      sourceUpdatedBy: normalizeIdentifier(salePrice.sourceUpdatedBy),
      sourceVersionId: normalizeIdentifier(salePrice.sourceVersionId),
      taxIncluded: salePrice.taxIncluded,
      unit: salePrice.unit,
      ...(salePrice.packaging
        ? { packaging: serializePackagingSalePrice(salePrice.packaging) }
        : {}),
    }
  : null;

const serializeLoadingLines = (lines) => (Array.isArray(lines) ? lines : [])
  .map((line) => ({
    baseUnit: line.baseUnit,
    id: line.id ?? line._id?.toString?.(),
    productId: line.productId?.toString?.() ?? line.productId,
    quantityInBaseUnits: line.quantityInBaseUnits,
    purchaseCostAtLoading: line.purchaseCostAtLoading ?? null,
    valuationSource: line.valuationSource ?? null,
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
        packaging: 1,
        quantityMode: 1,
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

  // Legacy packaged drafts may have a snapshot without quantityMode.
  let packaging = null;
  if (reservation.quantityMode === 'PACKAGING' || reservation.packaging) {
    const packagingId = reservation.packaging?.packagingId;
    packaging = Array.isArray(product.packagings) && packagingId instanceof ObjectId
      ? product.packagings.find((candidate) => candidate._id?.equals?.(packagingId))
      : null;
    if (!packaging || !isPackagingEnabledForSale(packaging)) {
      throw new TourLoadingValidationError({
        form: `Le conditionnement réservé pour ${getProductLabel(reservation)} n’est plus activé pour la vente. Retirez cette ligne puis ajoutez une quantité ou un conditionnement autorisé.`,
      });
    }
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
    ...(packaging ? { packaging: createPackagingSalePriceSnapshot({ packaging, reservation }) } : {}),
  };
};

// Lines reserved by pack are charged at the pack price for full packs.
const createPackagingSalePriceSnapshot = ({ packaging, reservation }) => {
  const salePrice = packaging.salePrice;

  if (
    !Number.isSafeInteger(salePrice?.amountInCentimes)
    || salePrice.amountInCentimes < 1
    || salePrice.currency !== 'DZD'
    || salePrice.taxIncluded !== true
  ) {
    throw new TourLoadingValidationError({
      form: `Le prix de vente TTC du conditionnement « ${packaging.label} » n’est pas renseigné pour ${getProductLabel(reservation)}.`,
    });
  }

  if (!Number.isSafeInteger(packaging.quantity) || packaging.quantity < 1) {
    throw new TourLoadingValidationError({
      form: `Le conditionnement « ${packaging.label} » de ${getProductLabel(reservation)} n’a pas une quantité valide.`,
    });
  }

  return {
    amountInCentimes: salePrice.amountInCentimes,
    currency: salePrice.currency,
    label: packaging.label,
    packagingId: packaging._id,
    quantity: packaging.quantity,
    ...(salePrice.updatedAt instanceof Date ? { sourceUpdatedAt: salePrice.updatedAt } : {}),
    ...(salePrice.updatedBy instanceof ObjectId ? { sourceUpdatedBy: salePrice.updatedBy } : {}),
    ...(salePrice.versionId instanceof ObjectId ? { sourceVersionId: salePrice.versionId } : {}),
    taxIncluded: salePrice.taxIncluded,
  };
};

const calculateLoadedValueInCentimes = ({
  quantityInBaseUnits,
  salePriceAtLoading,
  reservation,
}) => {
  const valueInCentimes = calculateSaleValueInCentimes(
    quantityInBaseUnits,
    salePriceAtLoading,
  );

  if (valueInCentimes === null) {
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

const summarizePurchaseCost = (lines) => {
  const total = lines.reduce((sum, line) => sum + BigInt(line.purchaseCostAtLoading.valueInCentimes), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Le coût d’achat total du chargement dépasse la limite autorisée.');
  }
  return Number(total);
};

const serializePricedLine = (line, includeValuation) => ({
  baseUnit: line.baseUnit,
  id: line._id.toString(),
  loadedValueInCentimes: line.loadedValueInCentimes,
  productCode: line.productCode,
  productDesignation: line.productDesignation,
  productId: line.productId.toString(),
  quantityInBaseUnits: line.quantityInBaseUnits,
  salePriceAtLoading: serializeSalePrice(line.salePriceAtLoading),
  status: line.status,
  ...(includeValuation ? { purchaseCostAtLoading: line.purchaseCostAtLoading } : {}),
});

export const getTourLoadingPreview = async ({ tourId, userId }) => {
  const client = await getMongoClient();
  const database = client.db();
  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of ['tours.load', 'tours.read', 'pricing.read']) {
        await requireUserPermission(userId, permission, { database, session });
      }
      const includeValuation = await userHasPermission(userId, 'stock.valuation.read', { database, session });
      if (typeof tourId !== 'string' || !ObjectId.isValid(tourId)) {
        return { errors: { form: 'Cette tournée n’existe plus.' }, lines: [] };
      }

      const tourObjectId = new ObjectId(tourId);
      const tour = await database.collection('tours').findOne({ _id: tourObjectId }, { session });
      if (tour?.status !== TOUR_STATUS_PREPARATION) {
        throw new TourLoadingValidationError({
          form: tour ? 'Cette tournée n’est plus en préparation.' : 'Cette tournée n’existe plus.',
        });
      }
      const reservations = await readActiveReservations({ database, session, tourId: tourObjectId });
      if (reservations.length === 0) {
        throw new TourLoadingValidationError({
          form: 'Cette tournée ne contient aucune réservation active à charger.',
        });
      }
      validateLoadingLines(reservations);
      const productIds = [...new Map(reservations.map((reservation) => [
        reservation.productId.toString(), reservation.productId,
      ])).values()];
      const products = await database.collection('products').find(
        { _id: { $in: productIds } },
        { projection: { baseUnit: 1, salePrice: 1, packagings: 1 }, session },
      ).toArray();
      const productsById = new Map(products.map((product) => [product._id.toString(), product]));
      const pricedLines = priceLoadingLines({ productsById, reservations });
      await assertPhysicalStockCoversReservations({ database, productIds, session });
      const valuedLines = await prepareTourLoadingStockValuations({ database, session, lines: pricedLines });
      // Check numeric limits even when purchase costs are hidden from the reader.
      const totalPurchaseCostInCentimes = summarizePurchaseCost(valuedLines);
      return {
        digest: createTourLoadingDigest(valuedLines),
        errors: {},
        lines: valuedLines.map((line) => serializePricedLine(line, includeValuation)),
        totalValueInCentimes: summarizeLoadedValue(valuedLines),
        ...(includeValuation ? { totalPurchaseCostInCentimes } : {}),
      };
    }, { readConcern: { level: 'snapshot' } });
  } catch (error) {
    if (error instanceof TourLoadingValidationError || error instanceof RangeError) {
      return { errors: error.errors ?? { form: error.message }, lines: [] };
    }
    throw error;
  } finally {
    await session.endSession();
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
        projection: { baseUnit: 1, salePrice: 1, packagings: 1 },
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
    ensureStockValuationIndexes(database),
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
      const pricedLines = priceLoadingLines({
        productsById,
        reservations,
      });

      summarizeLoadedValue(pricedLines);
      await assertPhysicalStockCoversReservations({ database, productIds, session });
      const pricedReservations = await prepareTourLoadingStockValuations({
        database, session, lines: pricedLines,
      });
      summarizePurchaseCost(pricedReservations);

      if (
        createTourLoadingDigest(pricedReservations)
        !== normalizedExpectedDigest
      ) {
        throw new TourLoadingValidationError({
          form: 'Les quantités ou les tarifs applicables ont changé depuis le récapitulatif, ou la valorisation du stock a changé. Vérifiez-les puis confirmez à nouveau.',
        });
      }

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

      await applyTourLoadingStockValuations({ database, session, lines: pricedReservations, movements });

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
                  purchaseCostAtLoading: reservation.purchaseCostAtLoading,
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
    if (error instanceof TourLoadingValidationError || error instanceof RangeError) {
      return { errors: error.errors ?? { form: error.message } };
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
