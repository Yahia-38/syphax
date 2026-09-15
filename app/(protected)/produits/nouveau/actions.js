'use server';

import { revalidatePath } from 'next/cache.js';

import { createProduct as saveProduct, validateProduct, validateProductPackaging } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const createProduct = async (previousState, formData) => {
  const session = await requirePermission('products.create');
  const values = {
    code: readTextField(formData, 'code'),
    designation: readTextField(formData, 'designation'),
    baseUnit: readTextField(formData, 'baseUnit'),
    label: readTextField(formData, 'label'),
    quantity: readTextField(formData, 'quantity'),
  };
  const packagingFlag = readTextField(formData, 'withPackaging');
  values.withPackaging = packagingFlag === 'true'
    || (packagingFlag !== 'false' && Boolean(values.label.trim() || values.quantity.trim()));
  if (!values.withPackaging) {
    values.label = '';
    values.quantity = '';
  }
  const previousRevision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision
    : 0;
  const revision = previousRevision + 1;

  const validation = validateProduct(values);
  const packagingValidation = values.withPackaging ? validateProductPackaging(values) : null;
  if (validation.errors || packagingValidation?.errors) {
    return { errors: { ...validation.errors, ...packagingValidation?.errors }, message: null, revision, values };
  }

  let result;
  try {
    result = await saveProduct({
      code: values.code,
      designation: values.designation,
      baseUnit: values.baseUnit,
      packaging: values.withPackaging ? {
        label: values.label,
        quantity: values.quantity,
      } : undefined,
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

  revalidatePath('/produits');
  revalidatePath(`/produits/${result.product.id}`);
  return {
    errors: {},
    message: 'Produit créé',
    product: result.product,
    revision,
    values,
  };
};
