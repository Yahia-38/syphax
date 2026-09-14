'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache.js';

import { requireUserPermission } from '../../lib/access.js';
import {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_READ_PERMISSION,
  recordDelivererCashPayment,
  recordTourCashPayment,
} from '../../lib/cash-payments.js';
import { requirePermission } from '../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const revalidatePaymentReads = ({ delivererId, tourIds = [] }) => {
  revalidatePath('/caisse');

  if (delivererId) {
    revalidatePath(`/livreurs/${delivererId}`);
  }

  for (const tourId of new Set(tourIds.filter(Boolean))) {
    revalidatePath(`/tournees/${tourId}`);
  }
};

const readDelivererPaymentRequest = (formData) => {
  if (!formData || typeof formData.get !== 'function') {
    return {
      error: 'La demande d’encaissement est invalide. Rechargez la page.',
    };
  }

  const fieldNames = [
    'amount',
    'confirmationKey',
    'delivererId',
    'expectedCashRegisterId',
    'expectedSummary',
    'note',
  ];
  const fields = Object.fromEntries(fieldNames.map((name) => [
    name,
    formData.get(name),
  ]));

  if (fieldNames.some((name) => typeof fields[name] !== 'string')) {
    return {
      error: 'La forme de la demande d’encaissement est invalide. Rechargez la page.',
    };
  }

  let expectedSummary;

  try {
    expectedSummary = JSON.parse(fields.expectedSummary);
  } catch {
    return {
      error: 'Le récapitulatif confirmé est illisible. Rechargez la page.',
    };
  }

  if (
    !expectedSummary
    || typeof expectedSummary !== 'object'
    || Array.isArray(expectedSummary)
    || !Array.isArray(expectedSummary.allocations)
  ) {
    return {
      error: 'La forme du récapitulatif confirmé est invalide. Rechargez la page.',
    };
  }

  return {
    request: {
      amount: fields.amount,
      confirmationKey: fields.confirmationKey,
      delivererId: fields.delivererId,
      expectedCashRegisterId: fields.expectedCashRegisterId,
      expectedSummary,
      note: fields.note,
    },
  };
};

export const recordDelivererPayment = async (formData) => {
  const session = await requirePermission(CASH_PAYMENT_CREATE_PERMISSION);

  await requireUserPermission(session.userId, CASH_READ_PERMISSION);

  const parsed = readDelivererPaymentRequest(formData);

  if (parsed.error) {
    return {
      errors: { form: parsed.error },
      stale: false,
      succeeded: false,
      uncertain: false,
    };
  }

  try {
    const result = await recordDelivererCashPayment({
      ...parsed.request,
      receivedBy: session.userId,
    });

    if (result.errors) {
      if (result.stale) {
        revalidatePath('/caisse');
      }

      return {
        errors: result.errors,
        stale: Boolean(result.stale),
        succeeded: false,
        summary: result.summary ?? null,
        uncertain: false,
      };
    }

    revalidatePaymentReads({
      delivererId: result.payment.delivererId,
      tourIds: result.payment.allocations.map((allocation) =>
        allocation.tourId),
    });

    return {
      errors: {},
      message: result.replayed
        ? `Le versement ${result.payment.reference} avait déjà été enregistré.`
        : `Le versement ${result.payment.reference} a été enregistré.`,
      nextConfirmationKey: randomUUID(),
      payment: result.payment,
      replayed: result.replayed,
      stale: false,
      succeeded: true,
      uncertain: false,
    };
  } catch (error) {
    console.error('Résultat incertain du versement global :', error);

    return {
      errors: {
        form: 'La réponse du serveur n’a pas permis de déterminer le résultat du versement.',
      },
      stale: false,
      succeeded: false,
      uncertain: true,
    };
  }
};

export const recordTourPayment = async (previousState, formData) => {
  const session = await requirePermission(CASH_PAYMENT_CREATE_PERMISSION);

  await requireUserPermission(session.userId, CASH_READ_PERMISSION);

  const confirmationKey = readTextField(formData, 'confirmationKey');
  const tourId = readTextField(formData, 'tourId');
  const values = {
    amount: readTextField(formData, 'amount'),
    note: readTextField(formData, 'note'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await recordTourCashPayment({
      ...values,
      confirmationKey,
      expectedCashRegisterId: readTextField(
        formData,
        'expectedCashRegisterId',
      ),
      expectedRemainingDueInCentimes: readTextField(
        formData,
        'expectedRemainingDueInCentimes',
      ),
      receivedBy: session.userId,
      tourId,
    });

    if (result.errors) {
      if (result.stale) {
        revalidatePaymentReads({ tourIds: [tourId] });
      }

      return {
        confirmationKey,
        errors: result.errors,
        message: null,
        paymentReference: null,
        revision,
        stale: Boolean(result.stale),
        succeeded: false,
        tourId,
        values,
      };
    }

    revalidatePaymentReads({
      delivererId: result.payment.delivererId,
      tourIds: [tourId],
    });

    return {
      confirmationKey: randomUUID(),
      errors: {},
      message: result.replayed
        ? `Le versement ${result.payment.reference} avait déjà été enregistré.`
        : `Le versement ${result.payment.reference} a été enregistré.`,
      paymentReference: result.payment.reference,
      replayed: result.replayed,
      revision,
      stale: false,
      succeeded: true,
      tourId,
      values: { amount: '', note: '' },
    };
  } catch (error) {
    console.error('Échec de l’enregistrement du versement :', error);

    return {
      confirmationKey,
      errors: {
        form: 'L’enregistrement du versement est momentanément indisponible.',
      },
      message: null,
      paymentReference: null,
      revision,
      stale: false,
      succeeded: false,
      tourId,
      values,
    };
  }
};
