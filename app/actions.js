'use server';

import { redirect } from 'next/navigation';

import { deleteSession } from '../lib/sessions.js';

export const logout = async () => {
  await deleteSession();
  redirect('/connexion');
};
