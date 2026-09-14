import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectId } from 'mongodb';

import {
  calculateCashPaymentPreview,
  calculateDelivererCashAllocationPreview,
} from '../lib/cash-payment-calculations.js';
import {
  calculateStoredPaymentTotal,
  normalizeStoredPaymentAllocations,
} from '../lib/cash-payments.js';

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

const allocationTours = [
  {
    countedAt: '2026-09-01T08:00:00.000Z',
    id: '000000000000000000000001',
    reference: 'TRN-A',
    remainingDueInCentimes: 200_000,
  },
  {
    countedAt: '2026-09-02T08:00:00.000Z',
    id: '000000000000000000000002',
    reference: 'TRN-B',
    remainingDueInCentimes: 400_000,
  },
];

test('répartit un montant partiel, exact ou multi-tournées par ancienneté', () => {
  const partialFirst = calculateDelivererCashAllocationPreview({
    amount: '1000',
    tours: allocationTours,
  });
  const exactFirst = calculateDelivererCashAllocationPreview({
    amount: '2000',
    tours: allocationTours,
  });
  const partialLast = calculateDelivererCashAllocationPreview({
    amount: '5000',
    tours: allocationTours,
  });
  const exactAll = calculateDelivererCashAllocationPreview({
    amount: '6000',
    tours: allocationTours,
  });

  assert.deepEqual(
    partialFirst.allocations.map(({
      allocatedAmountInCentimes,
      remainingAfterPaymentInCentimes,
      tourReference,
    }) => ({
      allocatedAmountInCentimes,
      remainingAfterPaymentInCentimes,
      tourReference,
    })),
    [{
      allocatedAmountInCentimes: 100_000,
      remainingAfterPaymentInCentimes: 100_000,
      tourReference: 'TRN-A',
    }],
  );
  assert.equal(exactFirst.allocations.length, 1);
  assert.equal(exactFirst.allocations[0].remainingAfterPaymentInCentimes, 0);
  assert.deepEqual(
    partialLast.allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [200_000, 300_000],
  );
  assert.equal(partialLast.totalAllocatedInCentimes, 500_000);
  assert.equal(partialLast.totalRemainingAfterPaymentInCentimes, 100_000);
  assert.deepEqual(
    exactAll.allocations.map((allocation) =>
      allocation.remainingAfterPaymentInCentimes),
    [0, 0],
  );
  assert.equal(exactAll.totalRemainingAfterPaymentInCentimes, 0);
});

test('départage les comptages simultanés par identifiant de tournée', () => {
  const result = calculateDelivererCashAllocationPreview({
    amount: '2500',
    tours: [
      {
        ...allocationTours[1],
        countedAt: allocationTours[0].countedAt,
      },
      allocationTours[0],
    ],
  });

  assert.deepEqual(
    result.allocations.map((allocation) => allocation.tourReference),
    ['TRN-A', 'TRN-B'],
  );
  assert.deepEqual(
    result.allocations.map((allocation) =>
      allocation.allocatedAmountInCentimes),
    [200_000, 50_000],
  );
});

test('refuse saisie invalide, dépassement, anomalie et date de comptage absente', () => {
  for (const amount of ['', '0', '1,001', '6000,01']) {
    const result = calculateDelivererCashAllocationPreview({
      amount,
      tours: allocationTours,
    });

    assert.equal(result.amountInCentimes, null);
    assert.deepEqual(result.allocations, []);

    if (amount) {
      assert.ok(result.error);
    }
  }

  const anomaly = calculateDelivererCashAllocationPreview({
    amount: '1000',
    blockingAnomalies: [{ code: 'INVALID_PAYMENTS' }],
    tours: allocationTours,
  });
  const missingDate = calculateDelivererCashAllocationPreview({
    amount: '1000',
    tours: [{ ...allocationTours[0], countedAt: null }],
  });

  assert.equal(anomaly.blocked, true);
  assert.deepEqual(anomaly.allocations, []);
  assert.match(anomaly.error, /anomalies financières/u);
  assert.equal(missingDate.blocked, true);
  assert.deepEqual(missingDate.allocations, []);
  assert.match(missingDate.error, /date du comptage/u);
});

test('normalise exclusivement le format historique ou les affectations explicites', () => {
  const firstTourId = new ObjectId();
  const firstCountingId = new ObjectId();
  const secondTourId = new ObjectId();
  const secondCountingId = new ObjectId();
  const legacy = normalizeStoredPaymentAllocations({
    amountInCentimes: 200_000,
    currency: 'DZD',
    sourceTourCountingId: firstCountingId,
    tourId: firstTourId,
    tourReference: 'TRN-A',
  });
  const explicit = normalizeStoredPaymentAllocations({
    allocations: [
      {
        allocatedAmountInCentimes: 200_000,
        sourceTourCountingId: firstCountingId,
        tourId: firstTourId,
        tourReference: 'TRN-A',
      },
      {
        allocatedAmountInCentimes: 300_000,
        sourceTourCountingId: secondCountingId,
        tourId: secondTourId,
        tourReference: 'TRN-B',
      },
    ],
    amountInCentimes: 500_000,
    currency: 'DZD',
    sourceTourCountingId: new ObjectId(),
    tourId: new ObjectId(),
  });

  assert.equal(legacy.usesExplicitAllocations, false);
  assert.equal(legacy.allocations[0].allocatedAmountInCentimes, 200_000);
  assert.equal(explicit.usesExplicitAllocations, true);
  assert.deepEqual(
    explicit.allocations.map(({ allocatedAmountInCentimes }) =>
      allocatedAmountInCentimes),
    [200_000, 300_000],
  );
  assert.equal(
    calculateStoredPaymentTotal(
      [
        {
          amountInCentimes: 200_000,
          currency: 'DZD',
          sourceTourCountingId: firstCountingId,
          tourId: firstTourId,
        },
        {
          allocations: explicit.allocations,
          amountInCentimes: 500_000,
          currency: 'DZD',
        },
      ],
      firstCountingId,
      firstTourId,
    ),
    400_000,
  );
});

test('refuse toute liste explicite vide, nulle, incohérente ou dupliquée sans repli historique', () => {
  const tourId = new ObjectId();
  const countingId = new ObjectId();
  const basePayment = {
    amountInCentimes: 500_000,
    currency: 'DZD',
    sourceTourCountingId: countingId,
    tourId,
  };
  const allocation = {
    allocatedAmountInCentimes: 200_000,
    sourceTourCountingId: countingId,
    tourId,
  };
  const invalidPayments = [
    { ...basePayment, allocations: [] },
    { ...basePayment, allocations: null },
    { ...basePayment, allocations: [allocation] },
    {
      ...basePayment,
      allocations: [allocation, { ...allocation, allocatedAmountInCentimes: 300_000 }],
    },
    {
      ...basePayment,
      allocations: [{ ...allocation, allocatedAmountInCentimes: 0 }],
    },
    {
      ...basePayment,
      allocations: [{
        ...allocation,
        allocatedAmountInCentimes: Number.MAX_SAFE_INTEGER,
      }, {
        ...allocation,
        tourId: new ObjectId(),
      }],
    },
  ];

  for (const payment of invalidPayments) {
    assert.equal(normalizeStoredPaymentAllocations(payment), null);
  }
});
