import { createHash, randomBytes } from 'node:crypto';

import { ObjectId } from 'mongodb';
import { cookies } from 'next/headers.js';
import { redirect } from 'next/navigation.js';

import { getDatabase } from './mongodb.js';
import { requireUserPermission } from './access.js';

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

export const deleteSession = async () => {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    const database = await getDatabase();

    await database.collection('sessions').deleteOne({
      tokenHash: hashToken(token),
    });
  }

  cookieStore.delete(COOKIE_NAME);
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

  const user = await database.collection('users').findOne(
    { _id: session.userId, active: { $ne: false } },
    { projection: { username: 1 } },
  );

  if (!user) {
    return null;
  }

  return { userId: user._id.toString(), username: user.username };
};

export const requireSession = async () => {
  const session = await getSession();

  if (!session) {
    redirect('/connexion');
  }

  return session;
};

export const requirePermission = async (permission) => {
  const session = await requireSession();

  await requireUserPermission(session.userId, permission);

  return session;
};
