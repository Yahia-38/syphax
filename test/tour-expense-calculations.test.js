import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOUR_EXPENSE_CHOICE_DECLARE,
  TOUR_EXPENSE_CHOICE_NONE,
  calculateTourExpensePreview,
} from '../lib/tour-expense-calculations.js';

const calculate = (overrides = {}) => calculateTourExpensePreview({
  choice: TOUR_EXPENSE_CHOICE_DECLARE,
  expenses: [{ amount: '2200', id: 'expense-1', reason: 'Carburant' }],
  grossSalesInCentimes: 750_000,
  totalPaidInCentimes: 300_000,
  ...overrides,
});

test('exige un choix explicite et calcule Aucun frais comme zéro frais', () => {
  const missingChoice = calculate({ choice: '' });
  const noExpense = calculate({
    choice: TOUR_EXPENSE_CHOICE_NONE,
    expenses: [{ amount: '999', reason: 'Ligne ignorée' }],
  });

  assert.equal(missingChoice.complete, false);
  assert.match(missingChoice.choiceError, /Choisissez explicitement/u);
  assert.equal(missingChoice.totalExpensesInCentimes, null);
  assert.deepEqual({
    complete: noExpense.complete,
    net: noExpense.netDueInCentimes,
    remaining: noExpense.remainingDueInCentimes,
    total: noExpense.totalExpensesInCentimes,
  }, {
    complete: true,
    net: 750_000,
    remaining: 450_000,
    total: 0,
  });
});

test('calcule plusieurs frais et un encaissement partiel en centimes exacts', () => {
  const result = calculate({
    expenses: [
      { amount: '1200', id: 'expense-1', reason: '  Carburant  ' },
      { amount: '1 000', id: 'expense-2', reason: 'Péage' },
    ],
  });

  assert.equal(result.complete, false);
  assert.match(result.expenseLines[1].errors.amount, /deux décimales/u);

  const valid = calculate({
    expenses: [
      { amount: '1200', id: 'expense-1', reason: '  Carburant  ' },
      { amount: '1000', id: 'expense-2', reason: 'Péage' },
    ],
  });

  assert.equal(valid.complete, true);
  assert.equal(valid.expenseLines[0].reason, 'Carburant');
  assert.equal(valid.totalExpensesInCentimes, 220_000);
  assert.equal(valid.netDueInCentimes, 530_000);
  assert.equal(valid.totalPaidInCentimes, 300_000);
  assert.equal(valid.remainingDueInCentimes, 230_000);
});

test('ne présente aucun total complet si une ligne est incomplète ou invalide', () => {
  const result = calculate({
    expenses: [
      { amount: '', id: 'expense-1', reason: '' },
      { amount: '10,999', id: 'expense-2', reason: 'X'.repeat(201) },
      {
        amount: '90071992547409.92',
        id: 'expense-3',
        reason: 'Dépassement',
      },
    ],
  });

  assert.equal(result.complete, false);
  assert.equal(result.totalExpensesInCentimes, null);
  assert.equal(result.netDueInCentimes, null);
  assert.equal(result.remainingDueInCentimes, null);
  assert.match(result.expenseLines[0].errors.amount, /obligatoire/u);
  assert.match(result.expenseLines[0].errors.reason, /obligatoire/u);
  assert.match(result.expenseLines[1].errors.amount, /deux décimales/u);
  assert.match(result.expenseLines[1].errors.reason, /200/u);
  assert.match(result.expenseLines[2].errors.amount, /limite numérique/u);
});

test('refuse zéro et un total de lignes dépassant la limite numérique', () => {
  const zero = calculate({
    expenses: [{ amount: '0,00', id: 'expense-1', reason: 'Péage' }],
  });
  const overflow = calculate({
    expenses: [
      {
        amount: '90071992547409.91',
        id: 'expense-1',
        reason: 'Premier montant',
      },
      {
        amount: '90071992547409.91',
        id: 'expense-2',
        reason: 'Second montant',
      },
    ],
  });

  assert.match(zero.expenseLines[0].errors.amount, /strictement positif/u);
  assert.equal(overflow.complete, false);
  assert.match(overflow.financialError, /total des frais/u);
});

test('conserve un reste nul sans le transformer', () => {
  const result = calculate({
    expenses: [{ amount: '2500', id: 'expense-1', reason: 'Carburant' }],
    grossSalesInCentimes: 750_000,
    totalPaidInCentimes: 500_000,
  });

  assert.equal(result.complete, true);
  assert.equal(result.remainingDueInCentimes, 0);
  assert.equal(result.reimbursementDueInCentimes, 0);
});

test('conserve le reste négatif et expose séparément le remboursement', () => {
  const result = calculate({
    expenses: [{ amount: '2500', id: 'expense-1', reason: 'Carburant' }],
    grossSalesInCentimes: 500_000,
    totalPaidInCentimes: 300_000,
  });

  assert.equal(result.complete, true);
  assert.equal(result.netDueInCentimes, 250_000);
  assert.equal(result.remainingDueInCentimes, -50_000);
  assert.equal(result.reimbursementDueInCentimes, 50_000);
});
