import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASH_WITHDRAWAL_REASON_MAX_LENGTH,
  validateCashWithdrawalPreview,
} from '../lib/cash-withdrawal-calculations.js';

test('prévisualise un montant positif exact et nettoie le motif', () => {
  assert.deepEqual(validateCashWithdrawalPreview({
    amount: ' 12 345 ',
    reason: '  Approvisionnement agence  ',
  }), {
    amountInCentimes: null,
    errors: {
      amount: 'Saisissez un montant valide avec deux décimales maximum, dans la limite numérique autorisée.',
    },
    reason: 'Approvisionnement agence',
  });

  assert.deepEqual(validateCashWithdrawalPreview({
    amount: '12345,67',
    reason: '  Approvisionnement agence  ',
  }), {
    amountInCentimes: 1_234_567,
    errors: {},
    reason: 'Approvisionnement agence',
  });
});

test('refuse les montants vides, nuls, trop précis et hors limite numérique', () => {
  const required = validateCashWithdrawalPreview({ amount: '', reason: 'Motif' });
  const zero = validateCashWithdrawalPreview({ amount: '0,00', reason: 'Motif' });
  const precise = validateCashWithdrawalPreview({ amount: '1,001', reason: 'Motif' });
  const overflow = validateCashWithdrawalPreview({
    amount: String(Number.MAX_SAFE_INTEGER),
    reason: 'Motif',
  });

  assert.match(required.errors.amount, /obligatoire/u);
  assert.match(zero.errors.amount, /strictement positif/u);
  assert.match(precise.errors.amount, /deux décimales/u);
  assert.match(overflow.errors.amount, /limite numérique/u);
  assert.equal(required.amountInCentimes, null);
  assert.equal(zero.amountInCentimes, null);
  assert.equal(precise.amountInCentimes, null);
  assert.equal(overflow.amountInCentimes, null);
});

test('exige un motif nettoyé et applique sa longueur maximale explicite', () => {
  const required = validateCashWithdrawalPreview({
    amount: '10',
    reason: '   ',
  });
  const maximum = validateCashWithdrawalPreview({
    amount: '10',
    reason: 'a'.repeat(CASH_WITHDRAWAL_REASON_MAX_LENGTH),
  });
  const tooLong = validateCashWithdrawalPreview({
    amount: '10',
    reason: 'a'.repeat(CASH_WITHDRAWAL_REASON_MAX_LENGTH + 1),
  });

  assert.match(required.errors.reason, /obligatoire/u);
  assert.equal(maximum.errors.reason, undefined);
  assert.match(tooLong.errors.reason, /200 caractères/u);
  assert.equal(maximum.reason.length, CASH_WITHDRAWAL_REASON_MAX_LENGTH);
});
