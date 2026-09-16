'use server';

import { revalidatePath } from 'next/cache.js';
import { createDeliverer as saveDeliverer } from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const createDeliverer = async (previousState, formData) => {
  const session = await requirePermission('deliverers.create');
  const values = {
    code: readTextField(formData, 'code'),
    name: readTextField(formData, 'name'),
    phone: readTextField(formData, 'phone'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  let result;
  try {
    result = await saveDeliverer({
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
  } catch (error) {
    console.error('Échec de la création du livreur :', error);

    return {
      errors: {
        form: 'La création du livreur est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }

  revalidatePath('/livreurs');
  const { id, code, name, phone, active } = result.deliverer;
  return {
    errors: {},
    message: `Le livreur ${code} a été créé avec succès.`,
    deliverer: { id, code, name, phone, active },
    revision,
    values: { code: '', name: '', phone: '' },
  };
};
