'use server';

import { revalidatePath } from 'next/cache.js';

import { requireUserPermission } from '../../../../lib/access.js';
import { requirePermission } from '../../../../lib/sessions.js';
import { addAndReserveTourProduct } from '../../../../lib/tour-reservations.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
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
      message: result.replayed
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
