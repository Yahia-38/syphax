'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache.js';

import { requireUserPermission } from '../../lib/access.js';
import {
  CASH_PAYMENT_CREATE_PERMISSION,
  CASH_READ_PERMISSION,
  recordTourCashPayment,
} from '../../lib/cash-payments.js';
import { requirePermission } from '../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const revalidatePaymentReads = (tourId) => {
  revalidatePath('/caisse');

  if (tourId) {
    revalidatePath(`/tournees/${tourId}`);
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
        revalidatePaymentReads(tourId);
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

    revalidatePaymentReads(tourId);

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
