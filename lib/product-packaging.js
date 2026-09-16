export const PACKAGING_USAGES = [
  { code: 'RECEPTION', label: 'Réception uniquement' },
  { code: 'SALE', label: 'Vente uniquement' },
  { code: 'BOTH', label: 'Réception et vente' },
];

export const getPackagingUsageLabel = (usage) => PACKAGING_USAGES
  .find(({ code }) => code === usage)?.label ?? 'Usage à définir';

export const isPackagingEnabledForReception = (packaging) =>
  packaging?.usage === 'RECEPTION' || packaging?.usage === 'BOTH';

export const SALE_PACKAGING_USAGES = Object.freeze(['SALE', 'BOTH']);

export const isPackagingEnabledForSale = (packaging) =>
  SALE_PACKAGING_USAGES.includes(packaging?.usage);

export const getSalePackagings = (packagings) =>
  (Array.isArray(packagings) ? packagings : []).filter(isPackagingEnabledForSale);
