'use server';

import { revalidatePath } from 'next/cache.js';
import { redirect } from 'next/navigation.js';

import {
  DELIVERER_OBJECTIVE_UPDATE_PERMISSION,
  updateDelivererObjective as saveDelivererObjective,
} from '../../../../lib/deliverer-objectives.js';

import {
  DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION,
  updateDelivererCreditLimit as saveDelivererCreditLimit,
} from '../../../../lib/deliverer-credit-limits.js';
import {
  deactivateDeliverer as saveDelivererDeactivation,
  reactivateDeliverer as saveDelivererReactivation,
  updateDeliverer as saveDeliverer,
  validateDelivererListHref,
} from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';
import {
  createTour as saveTour,
  validateTourReturnHref,
} from '../../../../lib/tours.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

export const updateDelivererObjective = async (delivererId, previousState, formData) => {
  const session = await requirePermission(DELIVERER_OBJECTIVE_UPDATE_PERMISSION);
  const values = {
    amount: readTextField(formData, 'objectiveAmount'),
    effectiveMonth: readTextField(formData, 'objectiveEffectiveMonth'),
  };
  const rawVersion = readTextField(formData, 'objectiveExpectedVersion');
  const expectedVersion = /^\d+$/u.test(rawVersion) ? Number(rawVersion) : null;
  const revision = Number.isSafeInteger(previousState?.revision) ? previousState.revision + 1 : 1;
  try {
    const result = await saveDelivererObjective({ ...values, delivererId, expectedVersion, updatedBy: session.userId });
    if (result.stale || (!result.errors && !result.notFound)) {
      revalidatePath('/livreurs');
      revalidatePath(`/livreurs/${delivererId}`);
    }
    return {
      errors: result.notFound ? { form: 'Ce livreur n’existe plus.' } : result.errors ?? {},
      message: result.errors || result.notFound ? null : result.changed
        ? 'L’objectif mensuel a été enregistré.' : 'L’objectif applicable à ce mois est déjà identique.',
      revision, stale: Boolean(result.stale), values,
    };
  } catch (error) {
    console.error('Échec de la modification de l’objectif mensuel :', error);
    return {
      errors: { form: 'La modification de l’objectif est momentanément indisponible.' },
      message: null, revision, stale: false, values,
    };
  }
};

const buildDelivererHref = (delivererId, returnHref) => {
  if (typeof returnHref === 'string' && returnHref.startsWith(`/livreurs/${delivererId}?`)) {
    return validateTourReturnHref(returnHref, delivererId);
  }

  const parameters = new URLSearchParams({
    retour: validateDelivererListHref(returnHref),
  });

  return `/livreurs/${delivererId}?${parameters.toString()}`;
};

const buildTourHref = (tourId, delivererId, returnHref) => {
  const parameters = new URLSearchParams({
    retour: validateTourReturnHref(returnHref, delivererId),
  });

  return `/tournees/${tourId}?${parameters.toString()}`;
};

export const createTour = async (
  delivererId,
  returnHref,
  previousState,
  formData,
) => {
  const session = await requirePermission('tours.create');
  const values = {
    creationKey: readTextField(formData, 'creationKey'),
    plannedDate: readTextField(formData, 'plannedDate'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;
  let result;

  try {
    result = await saveTour({
      ...values,
      createdBy: session.userId,
      delivererId,
    });
  } catch (error) {
    console.error('Échec de la création de la tournée :', error);

    return {
      errors: {
        form: 'La création de la tournée est momentanément indisponible.',
      },
      revision,
      values,
    };
  }

  if (result.errors) {
    return { errors: result.errors, revision, values };
  }

  revalidatePath(`/livreurs/${delivererId}`);
  redirect(buildTourHref(result.tour.id, delivererId, returnHref));
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
  return { errors: {}, revision, values, message: 'L’identification du livreur a été mise à jour.' };
};

export const updateDelivererCreditLimit = async (
  delivererId,
  previousState,
  formData,
) => {
  const session = await requirePermission(
    DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION,
  );
  const values = {
    amount: readTextField(formData, 'creditLimitAmount'),
  };
  const rawExpectedVersion = readTextField(
    formData,
    'creditLimitExpectedVersion',
  );
  const expectedVersion = /^\d+$/u.test(rawExpectedVersion)
    ? Number(rawExpectedVersion)
    : null;
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await saveDelivererCreditLimit({
      ...values,
      delivererId,
      expectedVersion,
      updatedBy: session.userId,
    });

    if (result.errors) {
      if (result.stale) {
        revalidatePath(`/livreurs/${delivererId}`);
      }

      return {
        errors: result.errors,
        message: null,
        revision,
        stale: Boolean(result.stale),
        succeeded: false,
        values,
      };
    }

    if (result.notFound) {
      return {
        errors: { form: 'Ce livreur n’existe plus.' },
        message: null,
        revision,
        stale: false,
        succeeded: false,
        values,
      };
    }

    revalidatePath(`/livreurs/${delivererId}`);

    return {
      errors: {},
      message: result.changed
        ? 'La limite de crédit a été mise à jour.'
        : 'La limite de crédit est déjà identique.',
      revision,
      stale: false,
      succeeded: true,
      values,
    };
  } catch (error) {
    console.error('Échec de la modification de la limite de crédit :', error);

    return {
      errors: {
        form: 'La modification de la limite de crédit est momentanément indisponible.',
      },
      message: null,
      revision,
      stale: false,
      succeeded: false,
      values,
    };
  }
};
