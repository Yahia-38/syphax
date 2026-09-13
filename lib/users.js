import bcrypt from 'bcryptjs';

import { getDatabase } from './mongodb.js';

const MINIMUM_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 12;
const INVALID_PASSWORD_HASH =
  '$2b$12$j9YatCUqsEYrWHJ7ls206Oz.M96fnYeRYBbXp1ooLyFaCi78UMhsS';

export const normalizeUsername = (username) =>
  username.trim().toLocaleLowerCase('fr');

const validateUser = (username, password) => {
  const normalizedUsername = normalizeUsername(username);
  const usernameLength = Array.from(normalizedUsername).length;
  const passwordLength = Array.from(password).length;

  if (usernameLength < 3 || usernameLength > 50 || /\s/u.test(normalizedUsername)) {
    throw new Error('L’identifiant doit contenir entre 3 et 50 caractères, sans espace.');
  }

  if (passwordLength < MINIMUM_PASSWORD_LENGTH) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }

  if (bcrypt.truncates(password)) {
    throw new Error('Le mot de passe ne doit pas dépasser 72 octets.');
  }

  return normalizedUsername;
};

export const createUser = async ({ username, password }) => {
  const normalizedUsername = validateUser(username, password);
  const database = await getDatabase();
  const users = database.collection('users');

  await users.createIndex(
    { username: 1 },
    { name: 'unique_username', unique: true },
  );

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const result = await users.insertOne({
      username: normalizedUsername,
      passwordHash,
      createdAt: new Date(),
    });

    return { id: result.insertedId.toString(), username: normalizedUsername };
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('Cet identifiant existe déjà.');
    }

    throw error;
  }
};

export const findUserByUsername = async (username) => {
  const database = await getDatabase();

  return database.collection('users').findOne(
    { username: normalizeUsername(username) },
    { projection: { username: 1, passwordHash: 1 } },
  );
};

export const authenticateUser = async (username, password) => {
  const user = await findUserByUsername(username);
  const passwordHash = user?.passwordHash ?? INVALID_PASSWORD_HASH;
  const passwordMatches =
    !bcrypt.truncates(password) && (await bcrypt.compare(password, passwordHash));

  return passwordMatches ? user : null;
};
