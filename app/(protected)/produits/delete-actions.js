'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { deleteProduct as removeProduct } from '../../../lib/products.js';
import { requireSession } from '../../../lib/sessions.js';

export const deleteProduct = async (productId) => {
  await requireSession();

  let result;

  try {
    result = await removeProduct(productId);
  } catch (error) {
    console.error('Échec de la suppression du produit :', error);

    return {
      error: 'La suppression du produit est momentanément indisponible.',
    };
  }

  if (result.notFound) {
    return {
      error: 'Ce produit n’existe plus.',
    };
  }

  revalidatePath('/produits');
  redirect('/produits?deleted=1');
};
