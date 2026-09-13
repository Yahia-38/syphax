'use server';

import { revalidatePath } from 'next/cache.js';

import { createReception as saveReception } from '../../../lib/reception-records.js';
import {
  createSupplier as saveSupplier,
  removeSupplier as removeSavedSupplier,
  updateSupplier as saveSupplierUpdate,
} from '../../../lib/suppliers.js';
import { requirePermission } from '../../../lib/sessions.js';

const readTextField = (formData, name) => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const readReceptionLines = (formData) => {
  const value = readTextField(formData, 'lines');

  try {
    const lines = JSON.parse(value);

    return Array.isArray(lines) ? lines : [];
  } catch {
    return [];
  }
};

export const createReception = async (previousState, formData) => {
  const session = await requirePermission('receptions.create');
  const values = {
    supplierId: readTextField(formData, 'supplierId'),
    receptionDate: readTextField(formData, 'receptionDate'),
    supplierReference: readTextField(formData, 'supplierReference'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await saveReception({
      ...values,
      lines: readReceptionLines(formData),
      createdBy: session.userId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
      };
    }

    revalidatePath('/receptions');

    return {
      errors: {},
      message: `La réception ${result.reception.supplierReference} a été enregistrée avec succès.`,
      revision,
    };
  } catch (error) {
    console.error('Échec de la création de la réception :', error);

    return {
      errors: {
        form: 'L’enregistrement de la réception est momentanément indisponible.',
      },
      message: null,
      revision,
    };
  }
};

export const createSupplier = async (previousState, formData) => {
  const session = await requirePermission('suppliers.create');
  const values = {
    name: readTextField(formData, 'name'),
    contactName: readTextField(formData, 'contactName'),
    phone: readTextField(formData, 'phone'),
    email: readTextField(formData, 'email'),
    address: readTextField(formData, 'address'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await saveSupplier({
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

    revalidatePath('/receptions');

    return {
      errors: {},
      message: `Le fournisseur ${result.supplier.name} a été créé avec succès.`,
      revision,
      values: {
        name: '',
        contactName: '',
        phone: '',
        email: '',
        address: '',
      },
    };
  } catch (error) {
    console.error('Échec de la création du fournisseur :', error);

    return {
      errors: {
        form: 'La création du fournisseur est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }
};

export const updateSupplier = async (supplierId, previousState, formData) => {
  const session = await requirePermission('suppliers.update');
  const values = {
    name: readTextField(formData, 'name'),
    contactName: readTextField(formData, 'contactName'),
    phone: readTextField(formData, 'phone'),
    email: readTextField(formData, 'email'),
    address: readTextField(formData, 'address'),
  };
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await saveSupplierUpdate({
      supplierId,
      ...values,
      updatedBy: session.userId,
    });

    if (result.errors) {
      return {
        errors: result.errors,
        message: null,
        revision,
        values,
      };
    }

    if (result.notFound) {
      return {
        errors: {
          form: 'Ce fournisseur n’existe plus.',
        },
        message: null,
        revision,
        values,
      };
    }

    revalidatePath('/receptions');

    return {
      errors: {},
      message: `Le fournisseur ${result.supplier.name} a été modifié avec succès.`,
      revision,
      values,
    };
  } catch (error) {
    console.error('Échec de la modification du fournisseur :', error);

    return {
      errors: {
        form: 'La modification du fournisseur est momentanément indisponible.',
      },
      message: null,
      revision,
      values,
    };
  }
};

export const removeSupplier = async (supplierId, previousState) => {
  const session = await requirePermission('suppliers.delete');
  const revision = Number.isSafeInteger(previousState?.revision)
    ? previousState.revision + 1
    : 1;

  try {
    const result = await removeSavedSupplier({
      supplierId,
      removedBy: session.userId,
    });

    if (result.notFound) {
      return {
        error: 'Ce fournisseur n’existe plus.',
        message: null,
        revision,
      };
    }

    revalidatePath('/receptions');

    return {
      error: null,
      message: result.deactivated
        ? `Le fournisseur ${result.name} a été désactivé car il est utilisé dans une réception.`
        : `Le fournisseur ${result.name} a été supprimé.`,
      revision,
    };
  } catch (error) {
    console.error('Échec du retrait du fournisseur :', error);

    return {
      error: 'Le retrait du fournisseur est momentanément indisponible.',
      message: null,
      revision,
    };
  }
};
