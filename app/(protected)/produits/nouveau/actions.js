'use server';

import { createProduct as saveProduct } from '../../../../lib/products.js';
import { requireSession } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const createProduct = async (previousState, formData) => {
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

  try {
    const result = await saveProduct({
      ...values,
      createdBy: session.userId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
        values,
      };
    }

    return {
      errors: {},
      message: `Le produit ${result.product.code} a été créé avec succès.`,
      revision,
      values: { code: '', designation: '', baseUnit: '' },
    };
  } catch (error) {
    console.error('Échec de la création du produit :', error);

    return {
      errors: {
        form: 'La création du produit est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }
};
