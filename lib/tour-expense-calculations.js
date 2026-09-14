import { parseReceptionAmountInCentimes } from './receptions.js';

export const TOUR_EXPENSE_CHOICE_NONE = 'NONE';
export const TOUR_EXPENSE_CHOICE_DECLARE = 'DECLARE';
export const TOUR_EXPENSE_REASON_MAX_LENGTH = 200;

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const validateExpenseLine = (line, index) => {
  const amount = normalizeText(line?.amount);
  const reason = normalizeText(line?.reason);
  const parsedAmountInCentimes = parseReceptionAmountInCentimes(amount);
  const errors = {};

  if (!reason) {
    errors.reason = 'Le motif est obligatoire.';
  } else if (reason.length > TOUR_EXPENSE_REASON_MAX_LENGTH) {
    errors.reason = `Le motif ne peut pas dépasser ${TOUR_EXPENSE_REASON_MAX_LENGTH} caractères après nettoyage.`;
  }

  if (!amount) {
    errors.amount = 'Le montant est obligatoire.';
  } else if (parsedAmountInCentimes === 0) {
    errors.amount = 'Le montant doit être strictement positif.';
  } else if (parsedAmountInCentimes === null) {
    errors.amount = 'Saisissez un montant valide avec deux décimales maximum, dans la limite numérique autorisée.';
  }

  return {
    amount,
    amountInCentimes: Object.hasOwn(errors, 'amount')
      ? null
      : parsedAmountInCentimes,
    errors,
    id: typeof line?.id === 'string' && line.id
      ? line.id
      : `expense-${index + 1}`,
    reason,
  };
};

const createIncompleteResult = ({
  choice,
  choiceError = null,
  expenseLines = [],
  financialError = null,
  grossSalesInCentimes,
  totalPaidInCentimes,
}) => ({
  choice,
  choiceError,
  complete: false,
  expenseLines,
  financialError,
  grossSalesInCentimes,
  netDueInCentimes: null,
  reimbursementDueInCentimes: null,
  remainingDueInCentimes: null,
  totalExpensesInCentimes: null,
  totalPaidInCentimes,
});

export const calculateTourExpensePreview = ({
  choice,
  expenses = [],
  grossSalesInCentimes,
  totalPaidInCentimes,
} = {}) => {
  const normalizedChoice = normalizeText(choice);
  const financialValuesAreValid =
    Number.isSafeInteger(grossSalesInCentimes)
    && grossSalesInCentimes >= 0
    && Number.isSafeInteger(totalPaidInCentimes)
    && totalPaidInCentimes >= 0;

  if (!financialValuesAreValid) {
    return createIncompleteResult({
      choice: normalizedChoice,
      financialError: 'Les montants financiers de la tournée sont invalides.',
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  if (![TOUR_EXPENSE_CHOICE_NONE, TOUR_EXPENSE_CHOICE_DECLARE]
    .includes(normalizedChoice)) {
    return createIncompleteResult({
      choice: '',
      choiceError: 'Choisissez explicitement « Aucun frais » ou « Déclarer des frais ».',
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  const expenseLines = normalizedChoice === TOUR_EXPENSE_CHOICE_DECLARE
    ? (Array.isArray(expenses) ? expenses : []).map(validateExpenseLine)
    : [];

  if (
    normalizedChoice === TOUR_EXPENSE_CHOICE_DECLARE
    && expenseLines.length === 0
  ) {
    return createIncompleteResult({
      choice: normalizedChoice,
      choiceError: 'Ajoutez au moins une ligne de frais.',
      expenseLines,
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  if (expenseLines.some((line) => Object.keys(line.errors).length > 0)) {
    return createIncompleteResult({
      choice: normalizedChoice,
      expenseLines,
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  let totalExpensesInCentimes = 0;

  for (const line of expenseLines) {
    totalExpensesInCentimes += line.amountInCentimes;

    if (!Number.isSafeInteger(totalExpensesInCentimes)) {
      return createIncompleteResult({
        choice: normalizedChoice,
        expenseLines,
        financialError: 'Le total des frais dépasse la limite numérique autorisée.',
        grossSalesInCentimes,
        totalPaidInCentimes,
      });
    }
  }

  const netDueInCentimes = grossSalesInCentimes - totalExpensesInCentimes;
  const remainingDueInCentimes = netDueInCentimes - totalPaidInCentimes;

  if (
    !Number.isSafeInteger(netDueInCentimes)
    || !Number.isSafeInteger(remainingDueInCentimes)
  ) {
    return createIncompleteResult({
      choice: normalizedChoice,
      expenseLines,
      financialError: 'Le résultat financier dépasse la limite numérique autorisée.',
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  return {
    choice: normalizedChoice,
    choiceError: null,
    complete: true,
    expenseLines,
    financialError: null,
    grossSalesInCentimes,
    netDueInCentimes,
    reimbursementDueInCentimes: remainingDueInCentimes < 0
      ? Math.abs(remainingDueInCentimes)
      : 0,
    remainingDueInCentimes,
    totalExpensesInCentimes,
    totalPaidInCentimes,
  };
};
