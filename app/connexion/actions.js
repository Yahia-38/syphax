'use server';

import { redirect } from 'next/navigation';

import { createSession } from '../../lib/sessions.js';
import { authenticateUser } from '../../lib/users.js';

const INVALID_CREDENTIALS = 'Identifiant ou mot de passe incorrect.';

export const login = async (previousState, formData) => {
  const username = formData.get('username');
  const password = formData.get('password');

  if (typeof username !== 'string' || typeof password !== 'string') {
    return { error: INVALID_CREDENTIALS };
  }

  if (!username.trim() || !password) {
    return { error: 'Saisissez votre identifiant et votre mot de passe.' };
  }

  try {
    const user = await authenticateUser(username, password);

    if (!user) {
      return { error: INVALID_CREDENTIALS };
    }

    await createSession(user._id.toString());
  } catch (error) {
    console.error('Échec de la connexion :', error);
    return { error: 'La connexion est momentanément indisponible.' };
  }

  redirect('/');
};
