import { createHash } from 'node:crypto';

import { ObjectId } from 'mongodb';

import { requireUserPermission } from './access.js';
import { coordinateCashRegister } from './cash-payment-coordination.js';
import { validateCashWithdrawalPreview } from './cash-withdrawal-calculations.js';
import { CASH_CURRENCY } from './cash-registers.js';
import { getDatabase, getMongoClient } from './mongodb.js';

export const CASH_WITHDRAWAL_CREATE_PERMISSION = 'cash.withdrawals.create';
export const CASH_WITHDRAWAL_FORM_PERMISSIONS = Object.freeze([
  'cash.read',
  CASH_WITHDRAWAL_CREATE_PERMISSION,
]);
export const CASH_WITHDRAWAL_RECORD_PERMISSIONS =
  CASH_WITHDRAWAL_FORM_PERMISSIONS;

const CONFIRMATION_KEY_PATTERN =
  /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

class CashWithdrawalValidationError extends Error {
  constructor(errors, { stale = false, summary = null } = {}) {
    super('Le retrait d’espèces est invalide.');
    this.name = 'CashWithdrawalValidationError';
    this.errors = errors;
    this.stale = stale;
    this.summary = summary;
  }
}

const normalizeText = (value) =>
  typeof value === 'string' ? value.trim() : '';

const serializeCashRegister = (cashRegister) => ({
  code: cashRegister.code,
  id: cashRegister._id.toString(),
  name: cashRegister.name,
});

const serializeWithdrawal = (withdrawal) => ({
  amountInCentimes: withdrawal.amountInCentimes,
  cashRegister: {
    code: withdrawal.cashRegisterCode,
    id: withdrawal.cashRegisterId.toString(),
    name: withdrawal.cashRegisterName,
  },
  currency: withdrawal.currency,
  id: withdrawal._id.toString(),
  reason: withdrawal.reason,
  reference: withdrawal.reference,
  withdrawnAt: withdrawal.withdrawnAt.toISOString(),
  withdrawnBy: withdrawal.withdrawnBy.toString(),
});

const createWithdrawalReference = (withdrawalId) =>
  `RTR-${withdrawalId.toHexString().toLocaleUpperCase('en')}`;

const createWithdrawalRequestDigest = ({
  amountInCentimes,
  cashRegisterId,
  expectedBalanceInCentimes,
  reason,
  withdrawnBy,
}) => createHash('sha256')
  .update(JSON.stringify({
    amountInCentimes,
    cashRegisterId,
    expectedBalanceInCentimes,
    reason,
    withdrawnBy,
  }))
  .digest('hex');

export const ensureCashWithdrawalIndexes = async (database) => {
  const cashWithdrawals = database.collection('cashWithdrawals');

  await Promise.all([
    cashWithdrawals.createIndex(
      { confirmationKey: 1 },
      { name: 'unique_cash_withdrawal_confirmation_key', unique: true },
    ),
    cashWithdrawals.createIndex(
      { reference: 1 },
      { name: 'unique_cash_withdrawal_reference', unique: true },
    ),
    cashWithdrawals.createIndex(
      { cashRegisterId: 1, withdrawnAt: -1, _id: -1 },
      { name: 'cash_withdrawal_register_journal' },
    ),
  ]);
};

const selectCashWithdrawalRegister = (cashRegisters) => {
  if (cashRegisters.length === 0) {
    return {
      cashRegister: null,
      error: 'Aucune caisse active en DZD n’est disponible.',
    };
  }

  if (cashRegisters.length > 1) {
    return {
      cashRegister: null,
      error: 'Plusieurs caisses actives en DZD sont disponibles ; la caisse du retrait ne peut pas être choisie automatiquement.',
    };
  }

  const [cashRegister] = cashRegisters;

  if (
    typeof cashRegister.code !== 'string'
    || !cashRegister.code
    || typeof cashRegister.name !== 'string'
    || !cashRegister.name
  ) {
    return {
      cashRegister: null,
      error: 'La caisse active en DZD est incomplète.',
    };
  }

  return { cashRegister, error: null };
};

const readActiveCashRegisters = ({ database, session }) =>
  database.collection('cashRegisters').find(
    { active: true, currency: CASH_CURRENCY },
    {
      projection: { code: 1, name: 1, openingBalance: 1 },
      session,
    },
  ).sort({ _id: 1 }).limit(2).toArray();

const validateOpeningBalance = (cashRegister) => {
  const openingBalance = cashRegister?.openingBalance;

  if (!openingBalance) {
    return 'Le fonds initial de cette caisse n’est pas configuré.';
  }

  if (
    !Number.isSafeInteger(openingBalance.amountInCentimes)
    || openingBalance.amountInCentimes < 0
    || openingBalance.currency !== CASH_CURRENCY
    || !(openingBalance.declaredAt instanceof Date)
    || typeof openingBalance.reference !== 'string'
    || !openingBalance.reference
    || typeof openingBalance.source !== 'string'
    || !openingBalance.source
  ) {
    return 'Le fonds initial configuré pour cette caisse est incohérent.';
  }

  return null;
};

const readFinancialTotal = async ({
  cashRegisterId,
  collectionName,
  database,
  session,
}) => {
  const cursor = database.collection(collectionName).find(
    { cashRegisterId },
    { projection: { amountInCentimes: 1, currency: 1 }, session },
  );
  let totalInCentimes = 0;

  for await (const entry of cursor) {
    if (
      !Number.isSafeInteger(entry.amountInCentimes)
      || entry.amountInCentimes <= 0
      || entry.currency !== CASH_CURRENCY
    ) {
      return null;
    }

    totalInCentimes += entry.amountInCentimes;

    if (!Number.isSafeInteger(totalInCentimes)) {
      return null;
    }
  }

  return totalInCentimes;
};

export const readCashRegisterBalance = async ({
  cashRegister,
  database,
  session,
}) => {
  const openingBalanceError = validateOpeningBalance(cashRegister);

  if (openingBalanceError) {
    return { error: openingBalanceError };
  }

  const [recordedReceiptsInCentimes, recordedWithdrawalsInCentimes] =
    await Promise.all([
      readFinancialTotal({
        cashRegisterId: cashRegister._id,
        collectionName: 'cashPayments',
        database,
        session,
      }),
      readFinancialTotal({
        cashRegisterId: cashRegister._id,
        collectionName: 'cashWithdrawals',
        database,
        session,
      }),
    ]);

  if (recordedReceiptsInCentimes === null) {
    return {
      error: 'Les encaissements enregistrés pour cette caisse contiennent une donnée financière incohérente.',
    };
  }

  if (recordedWithdrawalsInCentimes === null) {
    return {
      error: 'Les retraits enregistrés pour cette caisse contiennent une donnée financière incohérente.',
    };
  }

  const balanceInCentimes = cashRegister.openingBalance.amountInCentimes
    + recordedReceiptsInCentimes
    - recordedWithdrawalsInCentimes;

  if (!Number.isSafeInteger(balanceInCentimes) || balanceInCentimes < 0) {
    return {
      error: 'Le solde suivi de cette caisse est incohérent.',
    };
  }

  return {
    balanceInCentimes,
    error: null,
    openingBalanceInCentimes: cashRegister.openingBalance.amountInCentimes,
    recordedReceiptsInCentimes,
    recordedWithdrawalsInCentimes,
  };
};

const createBalanceSummary = async ({ cashRegister, database, session }) => {
  const serializedCashRegister = serializeCashRegister(cashRegister);
  const balance = await readCashRegisterBalance({
    cashRegister,
    database,
    session,
  });

  if (balance.error) {
    return {
      balanceInCentimes: null,
      cashRegister: serializedCashRegister,
      error: balance.error,
      openingBalanceInCentimes: null,
      recordedReceiptsInCentimes: null,
      recordedWithdrawalsInCentimes: null,
    };
  }

  return {
    cashRegister: serializedCashRegister,
    ...balance,
  };
};

const readTrackedCashBalance = async ({ database, session }) => {
  const cashRegisters = await readActiveCashRegisters({ database, session });
  const selection = selectCashWithdrawalRegister(cashRegisters);

  if (!selection.cashRegister) {
    return {
      balanceInCentimes: null,
      cashRegister: null,
      error: selection.error,
      openingBalanceInCentimes: null,
      recordedReceiptsInCentimes: null,
      recordedWithdrawalsInCentimes: null,
    };
  }

  return createBalanceSummary({
    cashRegister: selection.cashRegister,
    database,
    session,
  });
};

export const getTrackedCashBalance = async ({ userId } = {}) => {
  await requireUserPermission(userId, 'cash.read');

  const database = await getDatabase();
  return readTrackedCashBalance({ database });
};

export const getCashWithdrawalPreviewData = async ({ userId } = {}) => {
  for (const permission of CASH_WITHDRAWAL_FORM_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  const database = await getDatabase();
  return readTrackedCashBalance({ database });
};

const readExistingWithdrawal = async ({
  confirmationKey,
  database,
  requestDigest,
  session,
}) => {
  const existingWithdrawal = await database.collection('cashWithdrawals')
    .findOne({ confirmationKey }, { session });

  if (!existingWithdrawal) {
    return null;
  }

  if (existingWithdrawal.requestDigest !== requestDigest) {
    throw new CashWithdrawalValidationError({
      form: 'Cette clé de confirmation a déjà été utilisée pour une autre demande de retrait.',
    });
  }

  return {
    balanceAfterWithdrawalInCentimes: null,
    replayed: true,
    withdrawal: serializeWithdrawal(existingWithdrawal),
  };
};

const isConfirmationKeyDuplicate = (error) => error?.code === 11000
  && (
    error?.keyPattern?.confirmationKey
    || error?.message?.includes('unique_cash_withdrawal_confirmation_key')
  );

export const recordCashWithdrawal = async ({
  amount,
  confirmationKey,
  expectedBalanceInCentimes,
  expectedCashRegisterId,
  reason,
  withdrawnBy,
}) => {
  const normalizedConfirmationKey = normalizeText(confirmationKey)
    .toLocaleLowerCase('en');
  const normalizedCashRegisterId = normalizeText(expectedCashRegisterId);
  const normalizedExpectedBalance = normalizeText(expectedBalanceInCentimes);
  const normalizedWithdrawnBy = normalizeText(withdrawnBy);
  const validation = validateCashWithdrawalPreview({ amount, reason });
  const parsedExpectedBalance = /^\d+$/u.test(normalizedExpectedBalance)
    ? Number(normalizedExpectedBalance)
    : null;
  const errors = { ...validation.errors };

  if (!CONFIRMATION_KEY_PATTERN.test(normalizedConfirmationKey)) {
    errors.form = 'La clé de confirmation est invalide. Rechargez la page.';
  }

  if (!ObjectId.isValid(normalizedCashRegisterId)) {
    errors.form = 'La caisse du récapitulatif est invalide. Rechargez la page.';
  }

  if (
    !Number.isSafeInteger(parsedExpectedBalance)
    || parsedExpectedBalance < 0
  ) {
    errors.form = 'Le solde du récapitulatif est invalide. Rechargez la page.';
  }

  if (!ObjectId.isValid(normalizedWithdrawnBy)) {
    errors.form = 'L’auteur du retrait est invalide.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const client = await getMongoClient();
  const database = client.db();
  const cashRegisterObjectId = new ObjectId(normalizedCashRegisterId);
  const withdrawnByObjectId = new ObjectId(normalizedWithdrawnBy);
  const requestDigest = createWithdrawalRequestDigest({
    amountInCentimes: validation.amountInCentimes,
    cashRegisterId: normalizedCashRegisterId,
    expectedBalanceInCentimes: parsedExpectedBalance,
    reason: validation.reason,
    withdrawnBy: normalizedWithdrawnBy,
  });
  const withdrawalId = new ObjectId();
  const withdrawnAt = new Date();

  await ensureCashWithdrawalIndexes(database);

  const session = client.startSession();

  try {
    return await session.withTransaction(async () => {
      for (const permission of CASH_WITHDRAWAL_RECORD_PERMISSIONS) {
        await requireUserPermission(normalizedWithdrawnBy, permission, {
          database,
          session,
        });
      }

      const existingWithdrawal = await readExistingWithdrawal({
        confirmationKey: normalizedConfirmationKey,
        database,
        requestDigest,
        session,
      });

      if (existingWithdrawal) {
        return existingWithdrawal;
      }

      const activeCashRegisters = await readActiveCashRegisters({
        database,
        session,
      });
      const selection = selectCashWithdrawalRegister(activeCashRegisters);

      if (
        !selection.cashRegister
        || !selection.cashRegister._id.equals(cashRegisterObjectId)
      ) {
        const summary = selection.cashRegister
          ? await createBalanceSummary({
              cashRegister: selection.cashRegister,
              database,
              session,
            })
          : {
              balanceInCentimes: null,
              cashRegister: null,
              error: selection.error,
            };

        throw new CashWithdrawalValidationError(
          {
            form: 'La caisse du récapitulatif a changé. Vérifiez les informations actualisées puis confirmez à nouveau.',
          },
          { stale: true, summary },
        );
      }

      const cashRegister = await coordinateCashRegister({
        cashRegisterId: cashRegisterObjectId,
        database,
        filter: { active: true, currency: CASH_CURRENCY },
        projection: { code: 1, currency: 1, name: 1, openingBalance: 1 },
        session,
      });

      if (!cashRegister) {
        throw new CashWithdrawalValidationError(
          {
            form: 'La caisse du récapitulatif n’est plus active. Vérifiez les informations actualisées puis confirmez à nouveau.',
          },
          { stale: true },
        );
      }

      const summary = await createBalanceSummary({
        cashRegister,
        database,
        session,
      });

      if (summary.error || summary.balanceInCentimes === null) {
        throw new CashWithdrawalValidationError({ form: summary.error });
      }

      if (summary.balanceInCentimes !== parsedExpectedBalance) {
        throw new CashWithdrawalValidationError(
          {
            form: 'Le solde suivi a changé. Vérifiez le récapitulatif actualisé puis confirmez à nouveau.',
          },
          { stale: true, summary },
        );
      }

      if (validation.amountInCentimes > summary.balanceInCentimes) {
        throw new CashWithdrawalValidationError({
          amount: 'Le montant retiré dépasse le solde suivi disponible.',
        });
      }

      const withdrawal = {
        _id: withdrawalId,
        amountInCentimes: validation.amountInCentimes,
        cashRegisterCode: cashRegister.code,
        cashRegisterId: cashRegister._id,
        cashRegisterName: cashRegister.name,
        confirmationKey: normalizedConfirmationKey,
        currency: CASH_CURRENCY,
        reason: validation.reason,
        reference: createWithdrawalReference(withdrawalId),
        requestDigest,
        withdrawnAt,
        withdrawnBy: withdrawnByObjectId,
      };

      await database.collection('cashWithdrawals').insertOne(withdrawal, {
        session,
      });

      return {
        balanceAfterWithdrawalInCentimes:
          summary.balanceInCentimes - validation.amountInCentimes,
        replayed: false,
        withdrawal: serializeWithdrawal(withdrawal),
      };
    }, {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
      writeConcern: { w: 'majority' },
    });
  } catch (error) {
    if (error instanceof CashWithdrawalValidationError) {
      return {
        errors: error.errors,
        stale: error.stale,
        ...(error.summary ? { summary: error.summary } : {}),
      };
    }

    if (isConfirmationKeyDuplicate(error)) {
      for (const permission of CASH_WITHDRAWAL_RECORD_PERMISSIONS) {
        await requireUserPermission(normalizedWithdrawnBy, permission, {
          database,
        });
      }

      try {
        const concurrentWithdrawal = await readExistingWithdrawal({
          confirmationKey: normalizedConfirmationKey,
          database,
          requestDigest,
        });

        if (concurrentWithdrawal) {
          return concurrentWithdrawal;
        }
      } catch (validationError) {
        if (validationError instanceof CashWithdrawalValidationError) {
          return {
            errors: validationError.errors,
            stale: validationError.stale,
          };
        }

        throw validationError;
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
};
