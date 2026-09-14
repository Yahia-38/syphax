import { parseReceptionAmountInCentimes } from './receptions.js';

export const parseCashPaymentAmountInCentimes = (amount) => {
  const amountInCentimes = parseReceptionAmountInCentimes(amount);

  return Number.isSafeInteger(amountInCentimes) && amountInCentimes > 0
    ? amountInCentimes
    : null;
};

export const calculateCashPaymentPreview = ({
  amount,
  remainingDueInCentimes,
}) => {
  const normalizedAmount = typeof amount === 'string' ? amount.trim() : '';

  if (!normalizedAmount) {
    return {
      amountInCentimes: null,
      error: null,
      remainingAfterPaymentInCentimes: null,
    };
  }

  const parsedAmountInCentimes = parseReceptionAmountInCentimes(
    normalizedAmount,
  );
  const amountInCentimes = parseCashPaymentAmountInCentimes(normalizedAmount);

  if (parsedAmountInCentimes === 0) {
    return {
      amountInCentimes: null,
      error: 'Le montant reçu doit être strictement positif.',
      remainingAfterPaymentInCentimes: null,
    };
  }

  if (amountInCentimes === null) {
    return {
      amountInCentimes: null,
      error: 'Saisissez un montant valide avec deux décimales maximum.',
      remainingAfterPaymentInCentimes: null,
    };
  }

  if (
    !Number.isSafeInteger(remainingDueInCentimes)
    || remainingDueInCentimes < 0
  ) {
    return {
      amountInCentimes: null,
      error: 'Le reste dû de la tournée est invalide.',
      remainingAfterPaymentInCentimes: null,
    };
  }

  if (amountInCentimes > remainingDueInCentimes) {
    return {
      amountInCentimes: null,
      error: 'Le montant reçu ne peut pas dépasser le reste dû de cette tournée.',
      remainingAfterPaymentInCentimes: null,
    };
  }

  return {
    amountInCentimes,
    error: null,
    remainingAfterPaymentInCentimes:
      remainingDueInCentimes - amountInCentimes,
  };
};

const createEmptyAllocationPreview = ({
  blocked = false,
  error = null,
  totalRemainingDueInCentimes = null,
} = {}) => ({
  allocations: [],
  amountInCentimes: null,
  blocked,
  error,
  totalAllocatedInCentimes: null,
  totalRemainingAfterPaymentInCentimes: null,
  totalRemainingDueInCentimes,
});

export const calculateDelivererCashAllocationPreview = ({
  amount,
  blockingAnomalies = [],
  tours = [],
}) => {
  if (blockingAnomalies.length > 0) {
    return createEmptyAllocationPreview({
      blocked: true,
      error: 'Des anomalies financières empêchent la répartition globale de ce livreur.',
    });
  }

  if (!Array.isArray(tours) || tours.length === 0) {
    return createEmptyAllocationPreview({
      blocked: true,
      error: 'Aucune tournée avec un reste positif n’est disponible.',
      totalRemainingDueInCentimes: 0,
    });
  }

  const normalizedTours = [];
  let totalRemainingDueInCentimes = 0;

  for (const tour of tours) {
    const countedAt = typeof tour?.countedAt === 'string'
      ? tour.countedAt
      : '';
    const countedAtTime = countedAt ? new Date(countedAt).getTime() : NaN;

    if (!countedAt || Number.isNaN(countedAtTime)) {
      return createEmptyAllocationPreview({
        blocked: true,
        error: `La date du comptage de la tournée ${tour?.reference ?? 'inconnue'} est absente ou invalide.`,
      });
    }

    if (
      typeof tour?.id !== 'string'
      || !tour.id
      || !Number.isSafeInteger(tour.remainingDueInCentimes)
      || tour.remainingDueInCentimes <= 0
    ) {
      return createEmptyAllocationPreview({
        blocked: true,
        error: 'Les restes des tournées de ce livreur sont incohérents.',
      });
    }

    totalRemainingDueInCentimes += tour.remainingDueInCentimes;

    if (!Number.isSafeInteger(totalRemainingDueInCentimes)) {
      return createEmptyAllocationPreview({
        blocked: true,
        error: 'Le reste total de ce livreur est trop élevé pour être réparti.',
      });
    }

    normalizedTours.push({
      countedAt,
      countedAtTime,
      expenseDeclarationStatus: tour.expenseDeclarationStatus,
      grossSalesInCentimes: tour.grossSalesInCentimes,
      id: tour.id,
      netDueInCentimes: tour.netDueInCentimes,
      reference: tour.reference ?? 'Référence indisponible',
      remainingDueInCentimes: tour.remainingDueInCentimes,
      totalExpensesInCentimes: tour.totalExpensesInCentimes,
    });
  }

  const calculation = calculateCashPaymentPreview({
    amount,
    remainingDueInCentimes: totalRemainingDueInCentimes,
  });

  if (calculation.amountInCentimes === null) {
    return createEmptyAllocationPreview({
      error: calculation.error,
      totalRemainingDueInCentimes,
    });
  }

  const orderedTours = normalizedTours.sort((first, second) =>
    first.countedAtTime - second.countedAtTime
      || first.id.localeCompare(second.id, 'en'));
  const allocations = [];
  let amountToAllocateInCentimes = calculation.amountInCentimes;

  for (const tour of orderedTours) {
    if (amountToAllocateInCentimes === 0) {
      break;
    }

    const allocatedAmountInCentimes = Math.min(
      tour.remainingDueInCentimes,
      amountToAllocateInCentimes,
    );

    allocations.push({
      allocatedAmountInCentimes,
      countedAt: tour.countedAt,
      expenseDeclarationStatus: tour.expenseDeclarationStatus,
      grossSalesInCentimes: tour.grossSalesInCentimes,
      netDueInCentimes: tour.netDueInCentimes,
      remainingAfterPaymentInCentimes:
        tour.remainingDueInCentimes - allocatedAmountInCentimes,
      remainingBeforePaymentInCentimes: tour.remainingDueInCentimes,
      tourId: tour.id,
      tourReference: tour.reference,
      totalExpensesInCentimes: tour.totalExpensesInCentimes,
    });
    amountToAllocateInCentimes -= allocatedAmountInCentimes;
  }

  const totalAllocatedInCentimes = allocations.reduce(
    (total, allocation) => total + allocation.allocatedAmountInCentimes,
    0,
  );
  const allocationsAreValid = amountToAllocateInCentimes === 0
    && totalAllocatedInCentimes === calculation.amountInCentimes
    && allocations.every((allocation) =>
      allocation.allocatedAmountInCentimes > 0
      && allocation.allocatedAmountInCentimes
        <= allocation.remainingBeforePaymentInCentimes);

  if (!allocationsAreValid) {
    return createEmptyAllocationPreview({
      blocked: true,
      error: 'La répartition calculée est incohérente.',
      totalRemainingDueInCentimes,
    });
  }

  return {
    allocations,
    amountInCentimes: calculation.amountInCentimes,
    blocked: false,
    error: null,
    totalAllocatedInCentimes,
    totalRemainingAfterPaymentInCentimes:
      totalRemainingDueInCentimes - totalAllocatedInCentimes,
    totalRemainingDueInCentimes,
  };
};
