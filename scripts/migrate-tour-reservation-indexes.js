import { closeMongoConnection, getDatabase } from '../lib/mongodb.js';
import { ensureTourReservationIndexes } from '../lib/tour-reservations.js';

try {
  const database = await getDatabase();

  await ensureTourReservationIndexes(database);
  console.log(
    'Index des réservations de tournée migrés sans suppression de données.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
