import { grantYahiaFullAccessPermission } from '../lib/access.js';
import { closeMongoConnection } from '../lib/mongodb.js';

const permissions = [
  'cash.read',
  'cash.payments.create',
];

try {
  for (const permission of permissions) {
    const result = await grantYahiaFullAccessPermission(permission);
    const outcome = result.granted ? 'attribuée' : 'déjà attribuée';

    console.log(
      `Permission « ${permission} » ${outcome} au rôle « yahia-full-access » du compte « yahia ».`,
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
