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
