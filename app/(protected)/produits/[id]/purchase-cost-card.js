import Link from 'next/link';

import {
  formatReceptionDate,
  formatReceptionUnitCost,
} from '../../../../lib/receptions.js';

const formatPriceGap = (amountInCentimes) => {
  const sign = amountInCentimes > 0 ? '+' : amountInCentimes < 0 ? '−' : '';
  const amount = new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 0,
  }).format(Math.abs(amountInCentimes) / 100);

  return `${sign}${amount} DA TTC`;
};

const getPriceGapDescription = (priceGapInCentimes) => {
  if (priceGapInCentimes > 0) {
    return 'Le prix de vente est supérieur au dernier coût d’achat.';
  }

  if (priceGapInCentimes < 0) {
    return 'Le prix de vente est inférieur au dernier coût d’achat.';
  }

  return 'Le prix de vente est identique au dernier coût d’achat.';
};

const PurchaseCostCard = ({
  baseUnitLabel,
  purchaseCost,
  salePriceInCentimes,
  showPriceComparison,
}) => {
  const unitLabel = baseUnitLabel.toLocaleLowerCase('fr');
  const hasSalePrice = Number.isSafeInteger(salePriceInCentimes);
  const hasPurchaseCost = Number.isFinite(purchaseCost?.unitCostInCentimes);
  const priceGapInCentimes = hasSalePrice && hasPurchaseCost
    ? salePriceInCentimes - purchaseCost.unitCostInCentimes
    : null;
  const priceGapTone = priceGapInCentimes === null || priceGapInCentimes === 0
    ? 'border-slate-200 bg-slate-50 text-slate-700'
    : priceGapInCentimes > 0
      ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
      : 'border-red-100 bg-red-50 text-red-800';

  return (
    <section
      aria-labelledby='purchase-cost-title'
      className='overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'
    >
      <div className='border-b border-slate-100 px-6 py-5'>
        <h2
          className='text-lg font-semibold text-slate-900'
          id='purchase-cost-title'
        >
          Dernier coût d’achat renseigné
        </h2>
        <p className='mt-1 text-sm leading-6 text-slate-600'>
          Montant TTC de la ligne divisé par sa quantité dans l’unité de base.
        </p>
      </div>

      <div className='p-6'>
        {purchaseCost ? (
          <div
            className={`grid gap-5 ${showPriceComparison
              ? 'lg:grid-cols-3'
              : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]'}`}
          >
            <div className='rounded-xl border border-amber-100 bg-amber-50 p-5'>
              <p className='text-[12px] font-bold uppercase tracking-[0.08em] text-amber-700'>
                Coût unitaire TTC
              </p>
              <p className='mt-2 flex flex-wrap items-baseline gap-2'>
                <span className='text-[40px] leading-[44px] font-bold text-amber-950'>
                  {formatReceptionUnitCost(purchaseCost)}
                </span>
                <span className='text-base font-semibold text-amber-800'>
                  / {unitLabel}
                </span>
              </p>
              <p className='mt-3 text-xs leading-5 text-amber-800'>
                Dernière ligne compatible disposant d’un montant TTC renseigné.
              </p>
            </div>

            {showPriceComparison && (
              <div className={`rounded-xl border p-5 ${priceGapTone}`}>
                <p className='text-[12px] font-bold uppercase tracking-[0.08em]'>
                  Écart vente − achat
                </p>
                {priceGapInCentimes !== null ? (
                  <>
                    <p className='mt-2 flex flex-wrap items-baseline gap-2'>
                      <span className='text-[40px] leading-[44px] font-bold'>
                        {formatPriceGap(priceGapInCentimes)}
                      </span>
                      <span className='text-base font-semibold'>
                        / {unitLabel}
                      </span>
                    </p>
                    <p className='mt-3 text-xs leading-5'>
                      {getPriceGapDescription(priceGapInCentimes)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className='mt-3 text-2xl font-semibold text-slate-500'>
                      Non calculable
                    </p>
                    <p className='mt-2 text-xs leading-5 text-slate-600'>
                      Renseignez le prix de vente pour calculer cet écart.
                    </p>
                  </>
                )}
              </div>
            )}

            <div className='rounded-xl border border-slate-200 bg-slate-50 p-5'>
              <p className='text-[12px] font-bold uppercase tracking-[0.08em] text-slate-600'>
                Réception source
              </p>
              <p className='mt-2 text-lg font-bold text-slate-900'>
                {purchaseCost.source.supplierReference}
              </p>
              <p className='mt-1 text-sm text-slate-700'>
                {purchaseCost.source.supplierName}
              </p>
              <p className='mt-3 text-sm leading-6 text-slate-600'>
                Reçue le {formatReceptionDate(purchaseCost.source.receptionDate)} · Ligne{' '}
                {purchaseCost.source.lineNumber}
              </p>
              <Link
                className='mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700'
                href={`/receptions/${purchaseCost.source.receptionId}`}
              >
                Voir la réception source
                <span aria-hidden='true'>→</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className='rounded-xl border border-slate-200 bg-slate-50 p-5'>
            <p className='text-2xl font-semibold text-slate-500'>
              Non renseigné
            </p>
            <p className='mt-2 text-sm leading-6 text-slate-600'>
              Aucune ligne de réception compatible ne possède encore de montant TTC calculable.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

export default PurchaseCostCard;
