'use server';

import { revalidatePath } from 'next/cache.js';

import { requireUserPermission } from '../../../../lib/access.js';
import { requirePermission } from '../../../../lib/sessions.js';
import {
  confirmTourCounting,
} from '../../../../lib/tour-countings.js';
import {
  addAndReserveTourProduct,
  releaseTourReservation,
} from '../../../../lib/tour-reservations.js';
import { confirmTourLoading } from '../../../../lib/tour-loadings.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const readCountingLines = (formData) => {
  const lineIds = formData.getAll('lineId');
  const returnedQuantities = formData.getAll('returnedQuantity');
  const length = Math.max(lineIds.length, returnedQuantities.length);

  return Array.from({ length }, (_, index) => ({
    lineId: typeof lineIds[index] === 'string' ? lineIds[index] : '',
    returnedQuantity: typeof returnedQuantities[index] === 'string'
      ? returnedQuantities[index]
      : '',
  }));
};

export const addTourProduct = async (
  tourId,
  previousState,
  formData,
) => {
  const session = await requirePermission('tours.products.add');

  await requireUserPermission(session.userId, 'products.read');
  await requireUserPermission(session.userId, 'packaging.read');

  const values = {
    additionKey: readTextField(formData, 'additionKey'),
    directQuantity: readTextField(formData, 'directQuantity'),
    packagingCount: readTextField(formData, 'packagingCount'),
    packagingId: readTextField(formData, 'packagingId'),
    productId: readTextField(formData, 'productId'),
    quantityMode: readTextField(formData, 'quantityMode'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await addAndReserveTourProduct({
      ...values,
      createdBy: session.userId,
      tourId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
        values,
      };
    }

    revalidatePath(`/tournees/${tourId}`);
    revalidatePath('/produits');
    revalidatePath(`/produits/${result.reservation.productId}`);

    return {
      errors: {},
      message: result.released
        ? 'Cette demande avait déjà été traitée, mais sa réservation a depuis été libérée. Utilisez une nouvelle demande pour réserver à nouveau.'
        : result.replayed
          ? 'Cette demande avait déjà été traitée ; aucune réservation supplémentaire n’a été créée.'
          : 'Le produit a été ajouté et le stock a été réservé.',
      replayed: result.replayed,
      revision,
      values,
    };
  } catch (error) {
    console.error('Échec de l’ajout du produit à la tournée :', error);

    return {
      errors: {
        form: 'L’ajout et la réservation sont momentanément indisponibles.',
      },
      message: null,
      revision,
      values,
    };
  }
};

export const releaseTourProduct = async (
  tourId,
  reservationId,
  previousState,
) => {
  const session = await requirePermission('tours.products.release');
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await releaseTourReservation({
      releasedBy: session.userId,
      reservationId,
      tourId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
      };
    }

    revalidatePath(`/tournees/${tourId}`);
    revalidatePath('/produits');
    revalidatePath(`/produits/${result.reservation.productId}`);

    return {
      errors: {},
      message: result.replayed
        ? 'Cette réservation avait déjà été libérée ; aucune modification supplémentaire n’a été effectuée.'
        : 'La réservation a été libérée.',
      replayed: result.replayed,
      revision,
    };
  } catch (error) {
    console.error('Échec du retrait du produit de la tournée :', error);

    return {
      errors: {
        form: 'Le retrait et la libération sont momentanément indisponibles.',
      },
      message: null,
      revision,
    };
  }
};

export const loadTour = async (tourId, previousState, formData) => {
  const session = await requirePermission('tours.load');

  await requireUserPermission(session.userId, 'tours.read');
  await requireUserPermission(session.userId, 'pricing.read');

  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await confirmTourLoading({
      expectedDigest: readTextField(formData, 'loadingDigest'),
      loadedBy: session.userId,
      tourId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
      };
    }

    revalidatePath(`/tournees/${tourId}`);
    revalidatePath('/produits');

    for (const productId of result.productIds) {
      revalidatePath(`/produits/${productId}`);
    }

    return {
      errors: {},
      message: result.replayed
        ? 'Ce chargement avait déjà été confirmé ; aucune seconde sortie n’a été créée.'
        : 'Le chargement complet de la tournée a été confirmé.',
      replayed: result.replayed,
      revision,
    };
  } catch (error) {
    console.error('Échec de la confirmation du chargement :', error);

    return {
      errors: {
        form: 'La confirmation du chargement est momentanément indisponible.',
      },
      message: null,
      revision,
    };
  }
};

export const countTour = async (tourId, previousState, formData) => {
  const session = await requirePermission('tours.count.confirm');

  await requireUserPermission(session.userId, 'tours.read');
  await requireUserPermission(session.userId, 'pricing.read');

  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await confirmTourCounting({
      confirmationKey: readTextField(formData, 'confirmationKey'),
      countedBy: session.userId,
      expectedSheetDigest: readTextField(formData, 'countingSheetDigest'),
      lines: readCountingLines(formData),
      tourId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
      };
    }

    revalidatePath(`/tournees/${tourId}`);
    revalidatePath('/produits');

    for (const productId of result.productIds) {
      revalidatePath(`/produits/${productId}`);
    }

    return {
      errors: {},
      message: result.replayed
        ? 'Ce comptage avait déjà été enregistré ; aucun second retour n’a été créé.'
        : 'Le comptage a été enregistré et les retours ont réintégré le stock.',
      replayed: result.replayed,
      revision,
    };
  } catch (error) {
    console.error('Échec de l’enregistrement du comptage :', error);

    return {
      errors: {
        form: 'L’enregistrement du comptage est momentanément indisponible.',
      },
      message: null,
      revision,
    };
  }
};
