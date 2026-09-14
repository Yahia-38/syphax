'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache.js';

import { requireUserPermission } from '../../lib/access.js';
import {
  CASH_WITHDRAWAL_CREATE_PERMISSION,
  recordCashWithdrawal,
} from '../../lib/cash-withdrawals.js';
import { requirePermission } from '../../lib/sessions.js';

const readWithdrawalRequest = (formData) => {
  if (!formData || typeof formData.get !== 'function') {
    return null;
  }

  const fieldNames = [
    'amount',
    'confirmationKey',
    'expectedBalanceInCentimes',
    'expectedCashRegisterId',
    'reason',
  ];
  const fields = Object.fromEntries(fieldNames.map((name) => [
    name,
    formData.get(name),
  ]));

  return fieldNames.every((name) => typeof fields[name] === 'string')
    ? fields
    : null;
};

export const recordWithdrawal = async (formData) => {
  const session = await requirePermission(CASH_WITHDRAWAL_CREATE_PERMISSION);

  await requireUserPermission(session.userId, 'cash.read');

  const request = readWithdrawalRequest(formData);

  if (!request) {
    return {
      errors: {
        form: 'La forme de la demande de retrait est invalide. Rechargez la page.',
      },
      stale: false,
      succeeded: false,
      uncertain: false,
    };
  }

  try {
    const result = await recordCashWithdrawal({
      ...request,
      withdrawnBy: session.userId,
    });

    if (result.errors) {
      if (result.stale) {
        revalidatePath('/caisse');
      }

      return {
        errors: result.errors,
        nextConfirmationKey: result.stale ? randomUUID() : null,
        stale: Boolean(result.stale),
        succeeded: false,
        summary: result.summary ?? null,
        uncertain: false,
      };
    }

    revalidatePath('/caisse');

    return {
      errors: {},
      message: result.replayed
        ? `Le retrait ${result.withdrawal.reference} avait déjà été enregistré.`
        : `Le retrait ${result.withdrawal.reference} a été enregistré.`,
      nextConfirmationKey: randomUUID(),
      replayed: result.replayed,
      stale: false,
      succeeded: true,
      uncertain: false,
      withdrawal: result.withdrawal,
    };
  } catch (error) {
    console.error('Résultat incertain du retrait d’espèces :', error);

    return {
      errors: {
        form: 'La réponse du serveur n’a pas permis de déterminer le résultat du retrait.',
      },
      stale: false,
      succeeded: false,
      uncertain: true,
    };
  }
};
