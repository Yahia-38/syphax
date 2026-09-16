import { ObjectId } from 'mongodb';

import {
  calculateStockLoading,
  calculateStockReceipt,
  calculateStockReturn,
} from '../../lib/stock-valuation-calculations.js';
import {
  createStockValuationEntry,
  createStockValuationRecord,
} from '../../lib/stock-valuation-records.js';

export const seedValuedStockReceipt = async ({
  database, productId, baseUnit = 'PIECE', quantityInBaseUnits = 100,
  amountInCentimes = 10_000, recordedBy = new ObjectId(),
}) => {
  const recordedAt = new Date('2026-09-14T08:00:00.000Z');
  const receptionId = new ObjectId();
  const lineId = new ObjectId();
  const movement = {
    _id: new ObjectId(), productId, baseUnit, kind: 'RECEPTION_IN',
    quantityDeltaInBaseUnits: quantityInBaseUnits,
    sourceReceptionId: receptionId, sourceReceptionLineId: lineId,
    occurredOn: recordedAt, recordedAt, recordedBy,
  };
  const transition = calculateStockReceipt({
    balance: { quantityInBaseUnits: 0, valueInCentimes: 0 },
    quantityInBaseUnits, amountInCentimes,
  });
  const entry = createStockValuationEntry({ movement, ...transition, revision: 1 });
  const valuation = createStockValuationRecord({
    productId, baseUnit, ...transition.after, revision: 1,
    lastLedgerEntryId: entry._id, updatedAt: recordedAt,
  });
  await database.collection('receptions').insertOne({
    _id: receptionId, createdAt: recordedAt, createdBy: recordedBy,
    lines: [{ _id: lineId, productId, baseUnit, quantityInBaseUnits, amountInCentimes }],
  });
  await database.collection('stockMovements').insertOne(movement);
  await database.collection('stockValuationEntries').insertOne(entry);
  await database.collection('stockValuations').insertOne(valuation);
  return { movement, entry, valuation };
};

export const createValuationHistory = () => {
  const productId = new ObjectId();
  const baseUnit = 'PIECE';
  const tourId = new ObjectId();
  const reservationId = new ObjectId();
  const authorId = new ObjectId();
  const movement = (kind, quantityDeltaInBaseUnits, sources, minute) => ({
    _id: new ObjectId(),
    productId,
    baseUnit,
    kind,
    quantityDeltaInBaseUnits,
    recordedAt: new Date(`2026-09-17T09:0${minute}:00.000Z`),
    recordedBy: authorId,
    ...sources,
  });
  const movements = [
    movement('RECEPTION_IN', 3, { sourceReceptionId: new ObjectId(), sourceReceptionLineId: new ObjectId() }, 0),
    movement('TOUR_LOADING_OUT', -2, { sourceTourId: tourId, sourceTourReservationId: reservationId }, 1),
    movement('TOUR_RETURN_IN', 1, { sourceTourId: tourId, sourceTourReservationId: reservationId, sourceTourCountingId: new ObjectId() }, 2),
  ];
  const receipt = calculateStockReceipt({ balance: { quantityInBaseUnits: 0, valueInCentimes: 0 }, quantityInBaseUnits: 3, amountInCentimes: 100 });
  const loading = calculateStockLoading({ balance: receipt.after, lines: [{ id: reservationId.toHexString(), quantityInBaseUnits: 2 }] });
  const returned = calculateStockReturn({ balance: loading.after, loadedQuantityInBaseUnits: 2, loadedValueInCentimes: loading.loadedValueInCentimes, returnedQuantityInBaseUnits: 1 });
  const entries = [receipt, loading, returned].map((transition, index) => createStockValuationEntry({
    movement: movements[index],
    before: transition.before,
    after: transition.after,
    revision: index + 1,
  }));
  const valuation = createStockValuationRecord({
    productId,
    baseUnit,
    ...returned.after,
    revision: 3,
    lastLedgerEntryId: entries[2]._id,
    updatedAt: entries[2].recordedAt,
  });

  return { productId, baseUnit, movements, entries, valuation };
};
