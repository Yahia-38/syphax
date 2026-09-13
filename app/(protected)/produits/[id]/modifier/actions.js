'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { updateProduct as saveProduct } from '../../../../../lib/products.js';
import { requireSession } from '../../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const updateProduct = async (productId, previousState, formData) => {
  const session = await requireSession();
  const values = {
    code: readTextField(formData, 'code'),
    designation: readTextField(formData, 'designation'),
    baseUnit: readTextField(formData, 'baseUnit'),
  };
  const previousRevision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision
    : 0;
  const revision = previousRevision + 1;
  let result;

  try {
    result = await saveProduct({
      id: productId,
      ...values,
      updatedBy: session.userId,
    });
  } catch (error) {
    console.error('Échec de la modification du produit :', error);

    return {
      errors: {
        form: 'La modification du produit est momentanément indisponible.',
      },
      revision,
      values,
    };
  }

  if (result.errors) {
    return {
      errors: result.errors,
      revision,
      values,
    };
  }

  if (result.notFound) {
    return {
      errors: {
        form: 'Ce produit n’existe plus.',
      },
      revision,
      values,
    };
  }

  revalidatePath('/produits');
  revalidatePath(`/produits/${result.product.id}`);
  redirect(`/produits/${result.product.id}`);
};
