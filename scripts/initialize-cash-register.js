import { ensureCashPaymentIndexes } from '../lib/cash-payments.js';
import { initializeMainCashRegister } from '../lib/cash-registers.js';
import { ensureCashWithdrawalIndexes } from '../lib/cash-withdrawals.js';
import { closeMongoConnection, getDatabase } from '../lib/mongodb.js';

try {
  const cashRegister = await initializeMainCashRegister();
  const database = await getDatabase();

  await Promise.all([
    ensureCashPaymentIndexes(database),
    ensureCashWithdrawalIndexes(database),
  ]);

  console.log(
    cashRegister.created
      ? `Caisse « ${cashRegister.name} » (${cashRegister.code}, ${cashRegister.currency}) créée avec l’identifiant ${cashRegister.id}.`
      : `Caisse « ${cashRegister.name} » (${cashRegister.code}, ${cashRegister.currency}) déjà initialisée avec l’identifiant ${cashRegister.id}.`,
  );
  console.log(
    `Base d’ouverture ${cashRegister.openingBalance.reference} : ${cashRegister.openingBalance.amountInCentimes} centime, déclarée le ${cashRegister.openingBalance.declaredAt} par ${cashRegister.openingBalance.source}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
