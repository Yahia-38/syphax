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

export const validateTourExpenseDeclarationInput = ({
  choice,
  expenses = [],
} = {}) => {
  const normalizedChoice = normalizeText(choice);

  if (![TOUR_EXPENSE_CHOICE_NONE, TOUR_EXPENSE_CHOICE_DECLARE]
    .includes(normalizedChoice)) {
    return {
      choice: '',
      choiceError: 'Choisissez explicitement « Aucun frais » ou « Déclarer des frais ».',
      expenseLines: [],
      financialError: null,
      totalExpensesInCentimes: null,
    };
  }

  const expenseLines = normalizedChoice === TOUR_EXPENSE_CHOICE_DECLARE
    ? (Array.isArray(expenses) ? expenses : []).map(validateExpenseLine)
    : [];

  if (
    normalizedChoice === TOUR_EXPENSE_CHOICE_DECLARE
    && expenseLines.length === 0
  ) {
    return {
      choice: normalizedChoice,
      choiceError: 'Ajoutez au moins une ligne de frais.',
      expenseLines,
      financialError: null,
      totalExpensesInCentimes: null,
    };
  }

  if (expenseLines.some((line) => Object.keys(line.errors).length > 0)) {
    return {
      choice: normalizedChoice,
      choiceError: null,
      expenseLines,
      financialError: null,
      totalExpensesInCentimes: null,
    };
  }

  let totalExpensesInCentimes = 0;

  for (const line of expenseLines) {
    totalExpensesInCentimes += line.amountInCentimes;

    if (!Number.isSafeInteger(totalExpensesInCentimes)) {
      return {
        choice: normalizedChoice,
        choiceError: null,
        expenseLines,
        financialError: 'Le total des frais dépasse la limite numérique autorisée.',
        totalExpensesInCentimes: null,
      };
    }
  }

  return {
    choice: normalizedChoice,
    choiceError: null,
    expenseLines,
    financialError: null,
    totalExpensesInCentimes,
  };
};

const createIncompleteResult = ({
  choice,
  choiceError = null,
  expenseLines = [],
  financialError = null,
  grossSalesInCentimes,
  maximumExpensesInCentimes = null,
  netDueInCentimes = null,
  totalPaidInCentimes,
  totalExpensesInCentimes = null,
}) => ({
  choice,
  choiceError,
  complete: false,
  expenseLines,
  financialError,
  grossSalesInCentimes,
  maximumExpensesInCentimes,
  netDueInCentimes,
  remainingDueInCentimes: null,
  totalExpensesInCentimes,
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
    && totalPaidInCentimes >= 0
    && totalPaidInCentimes <= grossSalesInCentimes;

  if (!financialValuesAreValid) {
    return createIncompleteResult({
      choice: normalizedChoice,
      financialError: 'Les montants financiers de la tournée sont invalides.',
      grossSalesInCentimes,
      totalPaidInCentimes,
    });
  }

  const maximumExpensesInCentimes =
    grossSalesInCentimes - totalPaidInCentimes;

  const validatedInput = validateTourExpenseDeclarationInput({
    choice: normalizedChoice,
    expenses,
  });

  if (validatedInput.choiceError) {
    return createIncompleteResult({
      choice: validatedInput.choice,
      choiceError: validatedInput.choiceError,
      grossSalesInCentimes,
      maximumExpensesInCentimes,
      totalPaidInCentimes,
    });
  }

  const { expenseLines } = validatedInput;

  if (validatedInput.totalExpensesInCentimes === null) {
    return createIncompleteResult({
      choice: validatedInput.choice,
      choiceError: validatedInput.choiceError,
      expenseLines,
      financialError: validatedInput.financialError,
      grossSalesInCentimes,
      maximumExpensesInCentimes,
      totalPaidInCentimes,
    });
  }

  const { totalExpensesInCentimes } = validatedInput;

  const netDueInCentimes = grossSalesInCentimes - totalExpensesInCentimes;

  if (!Number.isSafeInteger(netDueInCentimes)) {
    return createIncompleteResult({
      choice: normalizedChoice,
      expenseLines,
      financialError: 'Le résultat financier dépasse la limite numérique autorisée.',
      grossSalesInCentimes,
      maximumExpensesInCentimes,
      totalPaidInCentimes,
    });
  }
  if (totalExpensesInCentimes > maximumExpensesInCentimes) {
    return createIncompleteResult({
      choice: normalizedChoice,
      expenseLines,
      financialError: `Le total des frais dépasse le maximum actuellement déclarable de ${(maximumExpensesInCentimes / 100).toLocaleString('fr-DZ', { maximumFractionDigits: 2 })} DA.`,
      grossSalesInCentimes,
      maximumExpensesInCentimes,
      netDueInCentimes,
      totalExpensesInCentimes,
      totalPaidInCentimes,
    });
  }

  const remainingDueInCentimes = netDueInCentimes - totalPaidInCentimes;

  return {
    choice: normalizedChoice,
    choiceError: null,
    complete: true,
    expenseLines,
    financialError: null,
    grossSalesInCentimes,
    maximumExpensesInCentimes,
    netDueInCentimes,
    remainingDueInCentimes,
    totalExpensesInCentimes,
    totalPaidInCentimes,
  };
};
