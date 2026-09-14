import { requireUserPermission } from './access.js';
import { LOADED_RESERVATION_STATUS } from './tour-reservations.js';
import { TOUR_STATUS_LOADED, getTourById } from './tours.js';

export const TOUR_COUNTING_PERMISSIONS = Object.freeze([
  'tours.read',
  'tours.count.prepare',
  'pricing.read',
]);

export const getTourCountingSheet = async ({ tourId, userId }) => {
  for (const permission of TOUR_COUNTING_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  const tour = await getTourById(tourId, {
    includePricing: true,
    userId,
  });

  if (!tour) {
    return null;
  }

  if (tour.status !== TOUR_STATUS_LOADED) {
    return {
      errors: {
        form: 'La feuille de comptage est disponible uniquement pour une tournée chargée.',
      },
      lines: [],
      tourId: tour.id,
    };
  }

  const lines = tour.lines
    .filter((line) => line.status === LOADED_RESERVATION_STATUS)
    .map((line) => ({
      baseUnit: line.baseUnit,
      id: line.id,
      productCode: line.productCode,
      productDesignation: line.productDesignation,
      quantityInBaseUnits: line.quantityInBaseUnits,
      salePriceAtLoading: line.salePriceAtLoading
        ? {
            amountInCentimes: line.salePriceAtLoading.amountInCentimes,
            currency: line.salePriceAtLoading.currency,
            taxIncluded: line.salePriceAtLoading.taxIncluded,
            unit: line.salePriceAtLoading.unit,
          }
        : null,
    }));

  return {
    errors: lines.length > 0
      ? {}
      : { form: 'Cette tournée ne contient aucune ligne chargée à compter.' },
    lines,
    tourId: tour.id,
  };
};
