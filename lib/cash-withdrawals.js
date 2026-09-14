import { requireUserPermission } from './access.js';
import { CASH_CURRENCY } from './cash-registers.js';
import { getDatabase } from './mongodb.js';

export const CASH_WITHDRAWAL_CREATE_PERMISSION = 'cash.withdrawals.create';
export const CASH_WITHDRAWAL_FORM_PERMISSIONS = Object.freeze([
  'cash.read',
  CASH_WITHDRAWAL_CREATE_PERMISSION,
]);

const serializeCashRegister = (cashRegister) => ({
  code: cashRegister.code,
  id: cashRegister._id.toString(),
  name: cashRegister.name,
});

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

const readRecordedReceiptTotal = async ({ cashRegisterId, database }) => {
  const payments = database.collection('cashPayments').find(
    { cashRegisterId },
    { projection: { amountInCentimes: 1, currency: 1 } },
  );
  let totalInCentimes = 0;

  for await (const payment of payments) {
    if (
      !Number.isSafeInteger(payment.amountInCentimes)
      || payment.amountInCentimes <= 0
      || payment.currency !== CASH_CURRENCY
    ) {
      return null;
    }

    totalInCentimes += payment.amountInCentimes;

    if (!Number.isSafeInteger(totalInCentimes)) {
      return null;
    }
  }

  return totalInCentimes;
};

export const getCashWithdrawalPreviewData = async ({ userId } = {}) => {
  for (const permission of CASH_WITHDRAWAL_FORM_PERMISSIONS) {
    await requireUserPermission(userId, permission);
  }

  const database = await getDatabase();
  const cashRegisters = await database.collection('cashRegisters').find(
    { active: true, currency: CASH_CURRENCY },
    { projection: { code: 1, name: 1 } },
  ).sort({ _id: 1 }).limit(2).toArray();
  const selection = selectCashWithdrawalRegister(cashRegisters);

  if (!selection.cashRegister) {
    return {
      cashRegister: null,
      error: selection.error,
      recordedReceiptsInCentimes: null,
    };
  }

  return {
    cashRegister: serializeCashRegister(selection.cashRegister),
    error: null,
    recordedReceiptsInCentimes: await readRecordedReceiptTotal({
      cashRegisterId: selection.cashRegister._id,
      database,
    }),
  };
};
