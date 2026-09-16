'use server';

import { revalidatePath } from 'next/cache.js';

import { updateProductSalePrice as saveSalePrice } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const updateProductSalePrice = async (
  productId,
  previousState,
  formData,
) => {
  const session = await requirePermission('pricing.update');
  await requirePermission('pricing.read');
  const packagingId = formData.has('packagingId') ? readTextField(formData, 'packagingId') : undefined;
  if (packagingId !== undefined) await requirePermission('packaging.read');
  const values = { price: readTextField(formData, 'price') };
  const previousRevision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision
    : 0;
  const revision = previousRevision + 1;

  try {
    const result = await saveSalePrice({
      productId,
      price: values.price,
      updatedBy: session.userId,
      packagingId,
    });

    if (result.errors) {
      return { errors: result.errors, message: null, revision, values };
    }

    if (result.notFound) {
      return {
        errors: { form: packagingId === undefined ? 'Ce produit n’existe plus.' : 'Ce produit ou conditionnement n’existe plus.' },
        message: null,
        revision,
        values,
      };
    }

    revalidatePath('/produits');
    revalidatePath(`/produits/${productId}`);

    return {
      errors: {},
      message: 'Le prix de vente a été mis à jour.',
      revision,
      values,
    };
  } catch (error) {
    console.error('Échec de la modification du prix de vente :', error);

    return {
      errors: {
        form: 'La modification du prix est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }
};
