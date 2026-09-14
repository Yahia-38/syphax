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
  { key: 'receptions.read', domain: 'Réceptions', label: 'Consulter' },
  { key: 'receptions.create', domain: 'Réceptions', label: 'Créer' },
  {
    key: 'cash.read',
    domain: 'Caisse',
    label: 'Consulter les montants et mouvements',
  },
  {
    key: 'cash.payments.create',
    domain: 'Caisse',
    label: 'Enregistrer un encaissement',
  },
  { key: 'suppliers.read', domain: 'Fournisseurs', label: 'Consulter' },
  { key: 'suppliers.create', domain: 'Fournisseurs', label: 'Créer' },
  { key: 'suppliers.update', domain: 'Fournisseurs', label: 'Modifier' },
  { key: 'suppliers.delete', domain: 'Fournisseurs', label: 'Supprimer' },
  { key: 'deliverers.read', domain: 'Livreurs', label: 'Consulter' },
  { key: 'deliverers.create', domain: 'Livreurs', label: 'Créer' },
  { key: 'deliverers.update', domain: 'Livreurs', label: 'Modifier' },
  {
    key: 'deliverers.status.update',
    domain: 'Livreurs',
    label: 'Désactiver et réactiver',
  },
  { key: 'tours.read', domain: 'Tournées', label: 'Consulter' },
  { key: 'tours.create', domain: 'Tournées', label: 'Créer' },
  {
    key: 'tours.load',
    domain: 'Tournées',
    label: 'Confirmer le chargement',
  },
  {
    key: 'tours.count.prepare',
    domain: 'Tournées',
    label: 'Préparer le comptage',
  },
  {
    key: 'tours.count.confirm',
    domain: 'Tournées',
    label: 'Enregistrer le comptage',
  },
  {
    key: 'tours.products.add',
    domain: 'Tournées',
    label: 'Ajouter et réserver un produit',
  },
  {
    key: 'tours.products.release',
    domain: 'Tournées',
    label: 'Retirer un produit et libérer sa réservation',
  },
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
  'receptions.read',
  'receptions.create',
  'suppliers.read',
  'suppliers.create',
  'suppliers.update',
  'suppliers.delete',
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
