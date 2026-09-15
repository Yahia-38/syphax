'use server';

import { revalidatePath } from 'next/cache.js';

import {
  addProductPackaging as savePackaging,
  removeProductPackaging,
} from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const addProductPackaging = async (
  productId,
  previousState,
  formData,
) => {
  const session = await requirePermission('packaging.create');
  await requirePermission('packaging.read');
  const values = {
    label: readTextField(formData, 'label'),
    quantity: readTextField(formData, 'quantity'),
  };
  const previousRevision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision
    : 0;
  const revision = previousRevision + 1;

  try {
    const result = await savePackaging({
      productId,
      ...values,
      createdBy: session.userId,
    });

    if (result.errors) {
      return { errors: result.errors, message: null, revision, values };
    }

    if (result.notFound) {
      return {
        errors: { form: 'Ce produit n’existe plus.' },
        message: null,
        revision,
        values,
      };
    }

    revalidatePath(`/produits/${productId}`);

    return {
      errors: {},
      message: `Le conditionnement ${result.packaging.label} a été ajouté.`,
      revision,
      values: { label: '', quantity: '' },
    };
  } catch (error) {
    console.error('Échec de l’ajout du conditionnement :', error);

    return {
      errors: {
        form: 'L’ajout du conditionnement est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }
};

export const removePackagingAction = async (
  productId,
  packagingId,
  previousState,
) => {
  await requirePermission('packaging.delete');
  await requirePermission('packaging.read');
  const previousRevision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision
    : 0;
  const revision = previousRevision + 1;

  try {
    const result = await removeProductPackaging({ productId, packagingId });

    if (result.notFound) {
      return {
        error: 'Ce conditionnement n’existe plus.',
        revision,
        success: false,
      };
    }

    revalidatePath(`/produits/${productId}`);

    return {
      error: null,
      revision,
      success: true,
    };
  } catch (error) {
    console.error('Échec du retrait du conditionnement :', error);

    return {
      error: 'Le retrait du conditionnement est momentanément indisponible.',
      revision,
      success: false,
    };
  }
};
