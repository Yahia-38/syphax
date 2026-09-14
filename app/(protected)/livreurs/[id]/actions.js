'use server';

import { revalidatePath } from 'next/cache.js';
import { redirect } from 'next/navigation.js';

import {
  deactivateDeliverer as saveDelivererDeactivation,
  reactivateDeliverer as saveDelivererReactivation,
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

const updateDelivererStatus = async ({
  delivererId,
  previousState,
  returnHref,
  saveStatus,
}) => {
  const session = await requirePermission('deliverers.status.update');
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;
  let result;

  try {
    result = await saveStatus({
      changedBy: session.userId,
      delivererId,
    });
  } catch (error) {
    console.error('Échec du changement de statut du livreur :', error);

    return {
      error: 'Le changement de statut du livreur est momentanément indisponible.',
      revision,
    };
  }

  if (result.notFound) {
    return {
      error: 'Ce livreur n’existe plus.',
      revision,
    };
  }

  revalidatePath('/livreurs');
  revalidatePath(`/livreurs/${delivererId}`);
  redirect(buildDelivererHref(delivererId, returnHref));
};

export const deactivateDeliverer = async (
  delivererId,
  returnHref,
  previousState,
) => updateDelivererStatus({
  delivererId,
  previousState,
  returnHref,
  saveStatus: saveDelivererDeactivation,
});

export const reactivateDeliverer = async (
  delivererId,
  returnHref,
  previousState,
) => updateDelivererStatus({
  delivererId,
  previousState,
  returnHref,
  saveStatus: saveDelivererReactivation,
});

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
