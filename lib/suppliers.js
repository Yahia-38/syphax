import { ObjectId } from 'mongodb';

import { getDatabase } from './mongodb.js';

const normalizeOptionalText = (value) =>
  typeof value === 'string' ? value.trim() : '';

export const validateSupplier = ({
  address,
  contactName,
  email,
  name,
  phone,
}) => {
  const errors = {};
  const data = {
    name: normalizeOptionalText(name),
    contactName: normalizeOptionalText(contactName),
    phone: normalizeOptionalText(phone),
    email: normalizeOptionalText(email).toLocaleLowerCase('fr'),
    address: normalizeOptionalText(address),
  };

  if (!data.name) {
    errors.name = 'Le nom du fournisseur est obligatoire.';
  } else if (Array.from(data.name).length > 150) {
    errors.name = 'Le nom ne doit pas dépasser 150 caractères.';
  }

  if (Array.from(data.contactName).length > 150) {
    errors.contactName = 'Le nom du contact ne doit pas dépasser 150 caractères.';
  }

  if (Array.from(data.phone).length > 30) {
    errors.phone = 'Le numéro ne doit pas dépasser 30 caractères.';
  }

  if (Array.from(data.email).length > 254) {
    errors.email = 'L’adresse e-mail ne doit pas dépasser 254 caractères.';
  } else if (
    data.email
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.email)
  ) {
    errors.email = 'Saisissez une adresse e-mail valide.';
  }

  if (Array.from(data.address).length > 500) {
    errors.address = 'L’adresse ne doit pas dépasser 500 caractères.';
  }

  return Object.keys(errors).length > 0 ? { errors } : { data };
};

export const createSupplier = async ({
  address,
  contactName,
  createdBy,
  email,
  name,
  phone,
}) => {
  const validation = validateSupplier({
    address,
    contactName,
    email,
    name,
    phone,
  });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const suppliers = database.collection('suppliers');

  await suppliers.createIndex(
    { normalizedName: 1 },
    { name: 'unique_supplier_name', unique: true },
  );

  const normalizedName = validation.data.name.toLocaleLowerCase('fr');
  const supplier = {
    ...validation.data,
    normalizedName,
    active: true,
    createdAt: new Date(),
    createdBy: new ObjectId(createdBy),
  };

  try {
    const result = await suppliers.insertOne(supplier);

    return {
      supplier: {
        id: result.insertedId.toString(),
        ...validation.data,
        active: true,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          name: 'Un fournisseur avec ce nom existe déjà.',
        },
      };
    }

    throw error;
  }
};

export const updateSupplier = async ({
  address,
  contactName,
  email,
  name,
  phone,
  supplierId,
  updatedBy,
}) => {
  if (typeof supplierId !== 'string' || !ObjectId.isValid(supplierId)) {
    return { notFound: true };
  }

  const validation = validateSupplier({
    address,
    contactName,
    email,
    name,
    phone,
  });

  if (validation.errors) {
    return validation;
  }

  const database = await getDatabase();
  const suppliers = database.collection('suppliers');
  const supplierObjectId = new ObjectId(supplierId);
  const normalizedName = validation.data.name.toLocaleLowerCase('fr');

  await suppliers.createIndex(
    { normalizedName: 1 },
    { name: 'unique_supplier_name', unique: true },
  );

  const supplierWithSameName = await suppliers.findOne(
    {
      _id: { $ne: supplierObjectId },
      normalizedName,
    },
    { projection: { _id: 1 } },
  );

  if (supplierWithSameName) {
    return {
      errors: {
        name: 'Un fournisseur avec ce nom existe déjà.',
      },
    };
  }

  try {
    const result = await suppliers.updateOne(
      { _id: supplierObjectId },
      {
        $set: {
          ...validation.data,
          normalizedName,
          updatedAt: new Date(),
          updatedBy: new ObjectId(updatedBy),
        },
      },
    );

    if (result.matchedCount === 0) {
      return { notFound: true };
    }

    return {
      supplier: {
        id: supplierId,
        ...validation.data,
      },
    };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        errors: {
          name: 'Un fournisseur avec ce nom existe déjà.',
        },
      };
    }

    throw error;
  }
};

export const removeSupplier = async ({ removedBy, supplierId }) => {
  if (typeof supplierId !== 'string' || !ObjectId.isValid(supplierId)) {
    return { notFound: true };
  }

  const database = await getDatabase();
  const supplierObjectId = new ObjectId(supplierId);
  const suppliers = database.collection('suppliers');
  const supplier = await suppliers.findOne(
    { _id: supplierObjectId },
    { projection: { active: 1, name: 1, receptionReferenceVersion: 1 } },
  );

  if (!supplier) {
    return { notFound: true };
  }

  const receptionUsingSupplier = await database.collection('receptions').findOne(
    { supplierId: supplierObjectId },
    { projection: { _id: 1 } },
  );

  const deactivateSupplier = async (currentSupplier) => {
    if (currentSupplier.active !== false) {
      const deactivatedAt = new Date();
      const deactivatedBy = new ObjectId(removedBy);

      await suppliers.updateOne(
        { _id: supplierObjectId, active: { $ne: false } },
        {
          $set: {
            active: false,
            deactivatedAt,
            deactivatedBy,
            updatedAt: deactivatedAt,
            updatedBy: deactivatedBy,
          },
        },
      );
    }

    return {
      deactivated: true,
      name: currentSupplier.name,
    };
  };

  if (
    receptionUsingSupplier
    || Number.isSafeInteger(supplier.receptionReferenceVersion)
  ) {
    return deactivateSupplier(supplier);
  }

  const result = await suppliers.deleteOne({
    _id: supplierObjectId,
    receptionReferenceVersion: { $exists: false },
  });

  if (result.deletedCount === 0) {
    const currentSupplier = await suppliers.findOne(
      { _id: supplierObjectId },
      {
        projection: {
          active: 1,
          name: 1,
          receptionReferenceVersion: 1,
        },
      },
    );

    if (
      currentSupplier
      && Number.isSafeInteger(currentSupplier.receptionReferenceVersion)
    ) {
      return deactivateSupplier(currentSupplier);
    }

    return { notFound: true };
  }

  return { deleted: true, name: supplier.name };
};

export const listSuppliers = async () => {
  const database = await getDatabase();
  const suppliers = await database.collection('suppliers').find(
    {},
    {
      projection: {
        name: 1,
        contactName: 1,
        phone: 1,
        email: 1,
        address: 1,
        active: 1,
      },
    },
  ).sort({ normalizedName: 1, name: 1 }).toArray();

  return suppliers.map((supplier) => ({
    id: supplier._id.toString(),
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    active: supplier.active !== false,
  }));
};
