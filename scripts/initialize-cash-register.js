import { ensureCashPaymentIndexes } from '../lib/cash-payments.js';
import { initializeMainCashRegister } from '../lib/cash-registers.js';
import { closeMongoConnection, getDatabase } from '../lib/mongodb.js';

try {
  const cashRegister = await initializeMainCashRegister();
  const database = await getDatabase();

  await ensureCashPaymentIndexes(database);

  console.log(
    cashRegister.created
      ? `Caisse « ${cashRegister.name} » (${cashRegister.code}, ${cashRegister.currency}) créée avec l’identifiant ${cashRegister.id}.`
      : `Caisse « ${cashRegister.name} » (${cashRegister.code}, ${cashRegister.currency}) déjà initialisée avec l’identifiant ${cashRegister.id}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
