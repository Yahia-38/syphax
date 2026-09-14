import { parseReceptionAmountInCentimes } from './receptions.js';

export const CASH_WITHDRAWAL_REASON_MAX_LENGTH = 200;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const validateCashWithdrawalPreview = ({
  amount,
  balanceInCentimes = null,
  reason,
} = {}) => {
  const normalizedAmount = normalizeText(amount);
  const normalizedReason = normalizeText(reason);
  const amountInCentimes = parseReceptionAmountInCentimes(normalizedAmount);
  const errors = {};

  if (!normalizedAmount) {
    errors.amount = 'Le montant retiré est obligatoire.';
  } else if (amountInCentimes === 0) {
    errors.amount = 'Le montant retiré doit être strictement positif.';
  } else if (amountInCentimes === null) {
    errors.amount = 'Saisissez un montant valide avec deux décimales maximum, dans la limite numérique autorisée.';
  }

  if (!normalizedReason) {
    errors.reason = 'Le motif du retrait est obligatoire.';
  } else if (normalizedReason.length > CASH_WITHDRAWAL_REASON_MAX_LENGTH) {
    errors.reason = `Le motif ne peut pas dépasser ${CASH_WITHDRAWAL_REASON_MAX_LENGTH} caractères.`;
  }

  const balanceIsValid = Number.isSafeInteger(balanceInCentimes)
    && balanceInCentimes >= 0;
  const balanceAfterWithdrawalInCentimes =
    !Object.hasOwn(errors, 'amount') && balanceIsValid
      ? balanceInCentimes - amountInCentimes
      : null;

  if (
    balanceAfterWithdrawalInCentimes !== null
    && balanceAfterWithdrawalInCentimes < 0
  ) {
    errors.amount = 'Le montant retiré dépasse le solde suivi disponible.';
  }

  return {
    amountInCentimes: Object.hasOwn(errors, 'amount')
      ? null
      : amountInCentimes,
    balanceAfterWithdrawalInCentimes: Object.hasOwn(errors, 'amount')
      ? null
      : balanceAfterWithdrawalInCentimes,
    errors,
    reason: normalizedReason,
  };
};
