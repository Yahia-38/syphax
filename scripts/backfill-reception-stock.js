import { closeMongoConnection } from '../lib/mongodb.js';
import { backfillReceptionStockMovements } from '../lib/stock-movements.js';

try {
  const result = await backfillReceptionStockMovements();

  console.log(
    `${result.receptionCount} réception(s) et ${result.lineCount} ligne(s) analysées.`,
  );
  console.log(
    `${result.createdMovementCount} mouvement(s) créé(s), ${result.existingMovementCount} déjà présent(s).`,
  );

  if (result.skippedLineCount > 0) {
    console.error(
      `${result.skippedLineCount} ligne(s) invalide(s) ignorée(s).`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    await closeMongoConnection();
  } catch {
    process.exitCode = 1;
  }
}
