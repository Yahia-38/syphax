'use server';

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

  try {
    const result = await saveDeliverer({
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
      message: `Le livreur ${result.deliverer.code} a été créé avec succès.`,
      revision,
      values: {
        code: '',
        name: '',
        phone: '',
      },
    };
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
};
