import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

export const CASH_CURRENCY = 'DZD';
export const MAIN_CASH_REGISTER_CODE = 'MAIN';
export const MAIN_CASH_REGISTER_NAME = 'Caisse principale';
export const MAIN_CASH_REGISTER_OPENING_BALANCE_REFERENCE =
  'OUVERTURE-MAIN-0-DZD';
export const MAIN_CASH_REGISTER_OPENING_BALANCE_SOURCE =
  'INITIALISATION_CAISSE_CONFIRMEE';

export const ensureCashRegisterIndexes = async (database) => {
  await database.collection('cashRegisters').createIndex(
    { code: 1 },
    { name: 'unique_cash_register_code', unique: true },
  );
};

const validateMainCashRegister = (cashRegister) => {
  if (!cashRegister) {
    throw new Error('La « Caisse principale » n’a pas pu être initialisée.');
  }

  if (
    cashRegister.name !== MAIN_CASH_REGISTER_NAME
    || cashRegister.currency !== CASH_CURRENCY
  ) {
    throw new Error(
      'Le code « MAIN » existe déjà avec un nom ou une devise incompatible.',
    );
  }

  if (cashRegister.active !== true) {
    throw new Error('La « Caisse principale » existe mais elle est inactive.');
  }
};

const validateMainCashRegisterOpeningBalance = (cashRegister) => {
  const openingBalance = cashRegister?.openingBalance;

  if (
    !openingBalance
    || openingBalance.amountInCentimes !== 0
    || openingBalance.currency !== CASH_CURRENCY
    || !(openingBalance.declaredAt instanceof Date)
    || openingBalance.reference
      !== MAIN_CASH_REGISTER_OPENING_BALANCE_REFERENCE
    || openingBalance.source !== MAIN_CASH_REGISTER_OPENING_BALANCE_SOURCE
  ) {
    throw new Error(
      'La base d’ouverture de la « Caisse principale » existe avec une configuration incompatible.',
    );
  }
};

export const initializeMainCashRegister = async () => {
  const database = await getDatabase();
  const cashRegisters = database.collection('cashRegisters');
  const cashRegisterId = new ObjectId();
  const createdAt = new Date();

  await ensureCashRegisterIndexes(database);

  let cashRegister;

  try {
    cashRegister = await cashRegisters.findOneAndUpdate(
      { code: MAIN_CASH_REGISTER_CODE },
      {
        $setOnInsert: {
          _id: cashRegisterId,
          active: true,
          code: MAIN_CASH_REGISTER_CODE,
          createdAt,
          currency: CASH_CURRENCY,
          name: MAIN_CASH_REGISTER_NAME,
        },
      },
      { returnDocument: 'after', upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    cashRegister = await cashRegisters.findOne({
      code: MAIN_CASH_REGISTER_CODE,
    });
  }

  validateMainCashRegister(cashRegister);

  if (!Object.hasOwn(cashRegister, 'openingBalance')) {
    await cashRegisters.updateOne(
      {
        _id: cashRegister._id,
        openingBalance: { $exists: false },
      },
      {
        $set: {
          openingBalance: {
            amountInCentimes: 0,
            currency: CASH_CURRENCY,
            declaredAt: createdAt,
            reference: MAIN_CASH_REGISTER_OPENING_BALANCE_REFERENCE,
            source: MAIN_CASH_REGISTER_OPENING_BALANCE_SOURCE,
          },
        },
      },
    );
    cashRegister = await cashRegisters.findOne({ _id: cashRegister._id });
  }

  validateMainCashRegisterOpeningBalance(cashRegister);

  return {
    active: cashRegister.active,
    code: cashRegister.code,
    created: cashRegister._id.equals(cashRegisterId),
    currency: cashRegister.currency,
    id: cashRegister._id.toString(),
    name: cashRegister.name,
    openingBalance: {
      amountInCentimes: cashRegister.openingBalance.amountInCentimes,
      currency: cashRegister.openingBalance.currency,
      declaredAt: cashRegister.openingBalance.declaredAt.toISOString(),
      reference: cashRegister.openingBalance.reference,
      source: cashRegister.openingBalance.source,
    },
  };
};
