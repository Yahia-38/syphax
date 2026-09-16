export const PACKAGING_USAGES = [
  { code: 'RECEPTION', label: 'Réception uniquement' },
  { code: 'SALE', label: 'Vente uniquement' },
  { code: 'BOTH', label: 'Réception et vente' },
];

export const getPackagingUsageLabel = (usage) => PACKAGING_USAGES
  .find(({ code }) => code === usage)?.label ?? 'Usage à définir';
