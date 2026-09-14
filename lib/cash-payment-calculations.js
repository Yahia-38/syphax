import { parseReceptionAmountInCentimes } from './receptions.js';

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

  const amountInCentimes = parseReceptionAmountInCentimes(normalizedAmount);

  if (amountInCentimes === null) {
    return {
      amountInCentimes: null,
      error: 'Saisissez un montant valide avec deux décimales maximum.',
      remainingAfterPaymentInCentimes: null,
    };
  }

  if (amountInCentimes <= 0) {
    return {
      amountInCentimes: null,
      error: 'Le montant reçu doit être strictement positif.',
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
