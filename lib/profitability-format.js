// Profitability amounts are read the way they are spoken: in dinars below
// 10 000 DA, in millions from there, where 1 million is 10 000 DA.
export const CENTIMES_PER_MILLION = 1_000_000;

const formatNumber = (value) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
}).format(value);

// The sign is kept, never hidden: margins and results can be negative.
export const formatProfitabilityAmount = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) return null;

  const sign = amountInCentimes < 0 ? '−' : '';
  const absolute = Math.abs(amountInCentimes);

  if (absolute < CENTIMES_PER_MILLION) return `${sign}${formatNumber(absolute / 100)} DA`;

  const millions = Math.round((absolute / CENTIMES_PER_MILLION) * 100) / 100;

  return `${sign}${formatNumber(millions)} ${millions < 2 ? 'million' : 'millions'}`;
};

// The exact amount in dinars, for the reader who needs every dinar.
export const formatProfitabilityExactAmount = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) return null;

  const sign = amountInCentimes < 0 ? '−' : '';

  return `${sign}${formatNumber(Math.abs(amountInCentimes) / 100)} DA`;
};
