import { ObjectId } from 'mongodb';
import { STOCK_MIGRATION_COLLECTIONS } from '../../lib/stock-valuation-migration-plan.js';

export const createStockMigrationFixture = ({ returnedQuantity = 10, counted = true, amount = 500_000 } = {}) => {
  const snapshot = Object.fromEntries(STOCK_MIGRATION_COLLECTIONS.map((name) => [name, []]));
  const productId = new ObjectId();
  const authorId = new ObjectId();
  const tourId = new ObjectId();
  const reservationId = new ObjectId();
  const countingId = new ObjectId();
  const time = (hour) => new Date(`2026-09-14T${hour}:00:00.000Z`);
  const salePrice = { amountInCentimes: 10_000, currency: 'DZD', taxIncluded: true, unit: 'PIECE' };
  snapshot.products.push({ _id: productId, code: `MIG-${productId}`, designation: 'Produit historique', baseUnit: 'PIECE', createdAt: time('07'), salePrice: { ...salePrice } });
  snapshot.tours.push({ _id: tourId, reference: 'TRN-HISTORIQUE', status: counted ? 'COUNTED' : 'LOADED',
    loadedAt: time('10'), loadedBy: authorId, ...(counted ? { countingId, countedAt: time('13') } : {}) });
  const receipt = (quantity, amountInCentimes, hour) => {
    const receptionId = new ObjectId();
    const lineId = new ObjectId();
    const line = { _id: lineId, productId, baseUnit: 'PIECE', quantityInBaseUnits: quantity, amountInCentimes };
    snapshot.receptions.push({ _id: receptionId, createdAt: time(hour), createdBy: authorId,
      receptionDate: time('06'), supplierReference: `BL-${hour}`, lines: [line] });
    snapshot.stockMovements.push({ _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'RECEPTION_IN',
      quantityDeltaInBaseUnits: quantity, recordedAt: time(hour), occurredOn: time('06'), recordedBy: authorId,
      sourceReceptionId: receptionId, sourceReceptionLineId: lineId });
  };
  receipt(100, amount, '08');
  snapshot.tourReservations.push({ _id: reservationId, tourId, productId, baseUnit: 'PIECE', status: 'LOADED',
    productCode: snapshot.products[0].code, productDesignation: snapshot.products[0].designation,
    quantityInBaseUnits: 40, loadedAt: time('10'), salePriceAtLoading: { ...salePrice } });
  snapshot.stockMovements.push({ _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'TOUR_LOADING_OUT',
    quantityDeltaInBaseUnits: -40, recordedAt: time('10'), occurredOn: time('10'), recordedBy: authorId,
    sourceTourId: tourId, sourceTourReservationId: reservationId });
  receipt(40, 280_000, '12');
  if (counted) {
    snapshot.tourCountings.push({ _id: countingId, tourId, countedAt: time('13'), countedBy: authorId,
      totalDueInCentimes: (40 - returnedQuantity) * 10_000, confirmationKeys: ['historical-key'],
      lines: [{ productId, baseUnit: 'PIECE', quantityInBaseUnits: 40,
        productCode: snapshot.products[0].code, productDesignation: snapshot.products[0].designation,
        returnedQuantityInBaseUnits: returnedQuantity, soldQuantityInBaseUnits: 40 - returnedQuantity,
        sourceTourReservationId: reservationId, salePriceAtLoading: { ...salePrice },
        amountDueInCentimes: (40 - returnedQuantity) * 10_000 }] });
    if (returnedQuantity) snapshot.stockMovements.push({ _id: new ObjectId(), productId, baseUnit: 'PIECE', kind: 'TOUR_RETURN_IN',
      quantityDeltaInBaseUnits: returnedQuantity, recordedAt: time('13'), occurredOn: time('13'), recordedBy: authorId,
      sourceTourId: tourId, sourceTourReservationId: reservationId, sourceTourCountingId: countingId });
  }
  for (const name of STOCK_MIGRATION_COLLECTIONS) snapshot[name].sort((first, second) => first._id.toString().localeCompare(second._id.toString()));
  return { snapshot, productId, tourId, reservationId, countingId, authorId };
};
