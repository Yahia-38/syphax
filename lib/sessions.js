import { createHash, randomBytes } from 'node:crypto';

import { ObjectId } from 'mongodb';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDatabase } from './mongodb.js';

const COOKIE_NAME = 'syphax-session';
const SESSION_DURATION = 8 * 60 * 60 * 1000;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export const createSession = async (userId) => {
  const database = await getDatabase();
  const sessions = database.collection('sessions');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION);

  await sessions.createIndex(
    { expiresAt: 1 },
    { name: 'expired_sessions', expireAfterSeconds: 0 },
  );

  await sessions.insertOne({
    tokenHash: hashToken(token),
    userId: new ObjectId(userId),
    createdAt: new Date(),
    expiresAt,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
};

export const getSession = async () => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const database = await getDatabase();
  const session = await database.collection('sessions').findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return null;
  }

  return { userId: session.userId.toString() };
};

export const requireSession = async () => {
  const session = await getSession();

  if (!session) {
    redirect('/connexion');
  }

  return session;
};
