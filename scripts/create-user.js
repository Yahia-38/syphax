import { closeMongoConnection } from '../lib/mongodb.js';
import { createUser } from '../lib/users.js';

const username = process.argv[2];
const password = process.env.SYPHAX_USER_PASSWORD;

if (!username || !password) {
  console.error(
    'Utilisation : SYPHAX_USER_PASSWORD=<mot-de-passe> npm run user:create -- <identifiant>',
  );
  process.exitCode = 1;
} else {
  try {
    const user = await createUser({ username, password });
    console.log(`Utilisateur « ${user.username} » créé.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closeMongoConnection();
  }
}
