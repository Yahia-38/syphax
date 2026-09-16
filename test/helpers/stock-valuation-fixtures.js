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
