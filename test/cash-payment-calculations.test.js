import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCashPaymentPreview } from '../lib/cash-payment-calculations.js';

test('prévisualise un versement partiel et un versement exact en centimes', () => {
  assert.deepEqual(calculateCashPaymentPreview({
    amount: '5000',
    remainingDueInCentimes: 750_000,
  }), {
    amountInCentimes: 500_000,
    error: null,
    remainingAfterPaymentInCentimes: 250_000,
  });
  assert.deepEqual(calculateCashPaymentPreview({
    amount: '7500,00',
    remainingDueInCentimes: 750_000,
  }), {
    amountInCentimes: 750_000,
    error: null,
    remainingAfterPaymentInCentimes: 0,
  });
});

test('ne calcule aucun reste pour un montant absent ou invalide', () => {
  const invalidAmounts = ['', '0', '-1', '1,001', '7500.01', 'abc'];

  for (const amount of invalidAmounts) {
    const result = calculateCashPaymentPreview({
      amount,
      remainingDueInCentimes: 750_000,
    });

    assert.equal(result.amountInCentimes, null);
    assert.equal(result.remainingAfterPaymentInCentimes, null);

    if (amount === '') {
      assert.equal(result.error, null);
    } else {
      assert.ok(result.error);
    }
  }
});
