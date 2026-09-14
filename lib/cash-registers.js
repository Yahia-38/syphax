import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

export const CASH_CURRENCY = 'DZD';
export const MAIN_CASH_REGISTER_CODE = 'MAIN';
export const MAIN_CASH_REGISTER_NAME = 'Caisse principale';

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

  return {
    active: cashRegister.active,
    code: cashRegister.code,
    created: cashRegister._id.equals(cashRegisterId),
    currency: cashRegister.currency,
    id: cashRegister._id.toString(),
    name: cashRegister.name,
  };
};
