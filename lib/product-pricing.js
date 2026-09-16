export const sortProductPackagings = (packagings) => (
  Array.isArray(packagings) ? [...packagings] : []
).sort((first, second) => second.quantity - first.quantity
  || first.label.localeCompare(second.label, 'fr', { numeric: true }));

export const validateProductSalePrice = (price) => {
  const normalizedPrice = typeof price === 'string' ? price.trim() : '';
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/u.exec(normalizedPrice);

  if (!match) {
    return {
      errors: {
        price: 'Saisissez un prix positif avec deux décimales maximum.',
      },
    };
  }

  const amountInCentimes = Number(match[1]) * 100
    + Number((match[2] ?? '').padEnd(2, '0'));

  if (!Number.isSafeInteger(amountInCentimes) || amountInCentimes < 1) {
    return {
      errors: {
        price: 'Saisissez un prix positif avec deux décimales maximum.',
      },
    };
  }

  return { data: { amountInCentimes } };
};
