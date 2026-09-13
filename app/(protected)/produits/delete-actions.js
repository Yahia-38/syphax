'use server';

import { revalidatePath } from 'next/cache.js';
import { redirect } from 'next/navigation.js';

import { deleteProduct as removeProduct } from '../../../lib/products.js';
import { requirePermission } from '../../../lib/sessions.js';

export const deleteProduct = async (productId) => {
  await requirePermission('products.delete');

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

  if (result.inUse) {
    return {
      error: 'Ce produit ne peut pas être supprimé car il possède un historique de réception.',
    };
  }

  revalidatePath('/produits');
  redirect('/produits?deleted=1');
};
