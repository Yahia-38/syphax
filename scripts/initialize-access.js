import { initializeManagerAccess } from '../lib/access.js';
import { closeMongoConnection } from '../lib/mongodb.js';

const username = process.argv[2];

if (!username) {
  console.error('Utilisation : npm run access:initialize -- <identifiant>');
  process.exitCode = 1;
} else {
  try {
    const result = await initializeManagerAccess({ username });
    console.log(
      `Rôle « ${result.roleName} » initialisé pour « ${result.username} » sans doublon.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closeMongoConnection();
  }
}
