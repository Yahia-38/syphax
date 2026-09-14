'use server';

import { revalidatePath } from 'next/cache.js';
import { redirect } from 'next/navigation.js';

import {
  updateDeliverer as saveDeliverer,
  validateDelivererListHref,
} from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const buildDelivererHref = (delivererId, returnHref) => {
  const parameters = new URLSearchParams({
    retour: validateDelivererListHref(returnHref),
  });

  return `/livreurs/${delivererId}?${parameters.toString()}`;
};

export const updateDeliverer = async (
  delivererId,
  returnHref,
  previousState,
  formData,
) => {
  const session = await requirePermission('deliverers.update');
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
      delivererId,
      ...values,
      updatedBy: session.userId,
    });
  } catch (error) {
    console.error('Échec de la modification du livreur :', error);

    return {
      errors: {
        form: 'La modification du livreur est momentanément indisponible.',
      },
      revision,
      values,
    };
  }

  if (result.errors) {
    return { errors: result.errors, revision, values };
  }

  if (result.notFound) {
    return {
      errors: { form: 'Ce livreur n’existe plus.' },
      revision,
      values,
    };
  }

  revalidatePath('/livreurs');
  revalidatePath(`/livreurs/${delivererId}`);
  redirect(buildDelivererHref(delivererId, returnHref));
};
