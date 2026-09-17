import { grantYahiaFullAccessPermission } from '../lib/access.js';
import { closeMongoConnection } from '../lib/mongodb.js';

try {
  for (const permission of ['deliverers.objectives.read', 'deliverers.objectives.update']) {
    const result = await grantYahiaFullAccessPermission(permission);
    console.log(`Permission « ${permission} » ${result.granted ? 'attribuée' : 'déjà attribuée'} au rôle « yahia-full-access » du compte « yahia ».`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
