import { grantYahiaFullAccessPermission } from '../lib/access.js';
import { closeMongoConnection } from '../lib/mongodb.js';

try {
  const result = await grantYahiaFullAccessPermission('profitability.read');
  console.log(`Permission « ${result.permission} » ${result.granted ? 'attribuée' : 'déjà attribuée'} au rôle « yahia-full-access » du compte « yahia ».`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
