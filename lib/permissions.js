export const PERMISSIONS = Object.freeze([
  { key: 'products.read', domain: 'Produits', label: 'Consulter' },
  { key: 'products.create', domain: 'Produits', label: 'Créer' },
  { key: 'products.update', domain: 'Produits', label: 'Modifier' },
  { key: 'products.delete', domain: 'Produits', label: 'Supprimer' },
  {
    key: 'packaging.read',
    domain: 'Conditionnements',
    label: 'Consulter',
  },
  {
    key: 'packaging.create',
    domain: 'Conditionnements',
    label: 'Créer',
  },
  {
    key: 'packaging.update',
    domain: 'Conditionnements',
    label: 'Modifier',
  },
  {
    key: 'packaging.delete',
    domain: 'Conditionnements',
    label: 'Supprimer',
  },
  { key: 'pricing.read', domain: 'Tarifs', label: 'Consulter' },
  { key: 'pricing.update', domain: 'Tarifs', label: 'Modifier' },
  {
    key: 'access.roles.manage',
    domain: 'Accès',
    label: 'Gérer les rôles',
  },
  {
    key: 'access.roles.assign',
    domain: 'Accès',
    label: 'Attribuer les rôles aux utilisateurs',
  },
]);

export const PERMISSION_KEYS = Object.freeze(
  PERMISSIONS.map((permission) => permission.key),
);

// Cette liste est volontairement explicite : une nouvelle permission du
// catalogue ne doit pas être accordée automatiquement au rôle Manager.
export const INITIAL_MANAGER_PERMISSIONS = Object.freeze([
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  'packaging.read',
  'packaging.create',
  'packaging.update',
  'packaging.delete',
  'pricing.read',
  'pricing.update',
  'access.roles.manage',
  'access.roles.assign',
]);

export const ACCESS_ADMINISTRATION_PERMISSIONS = Object.freeze([
  'access.roles.manage',
  'access.roles.assign',
]);

const KNOWN_PERMISSION_KEYS = new Set(PERMISSION_KEYS);

export const isKnownPermission = (permission) =>
  KNOWN_PERMISSION_KEYS.has(permission);
