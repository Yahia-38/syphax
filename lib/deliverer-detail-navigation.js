const single = (value) => Array.isArray(value) ? value[0] : value;

export const getDelivererSections = ({ canReadCash, canReadCreditLimit, canReadTours }) => [
  ...((canReadCash || canReadCreditLimit) ? [['ensemble', 'Vue d’ensemble']] : []),
  ...(canReadTours ? [['tournees', 'Tournées']] : []),
  ['identification', 'Identification'],
];

export const readDelivererSection = (query, sections) => {
  if (single(query.modifier) === '1') return 'identification';
  const explicit = single(query.section);
  if (sections.some(([key]) => key === explicit)) return explicit;
  if (!explicit && ['tourneeRecherche', 'tourneeDate', 'tourneePage'].some((key) => key in query)
    && sections.some(([key]) => key === 'tournees')) return 'tournees';
  return sections[0][0];
};
