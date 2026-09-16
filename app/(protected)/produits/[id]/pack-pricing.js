'use client';

import { useState } from 'react';
import { sortProductPackagings } from '../../../../lib/product-pricing.js';
import { getSalePackagings } from '../../../../lib/product-packaging.js';

import { useEditingSession } from '../../components/editing-session.js';
import PriceHistory from './price-history.js';
import PricingForm from './pricing-form.js';
import ProductIcon from './product-icon.js';
import styles from './product-detail.module.css';

const PACKS_PER_PAGE = 5;
const formatMoney = (centimes) => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(centimes / 100);
const formatDate = (value) => new Intl.DateTimeFormat('fr-DZ', {
  dateStyle: 'long', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Africa/Algiers',
}).format(new Date(value));

const PackPricing = ({ packagings, productId, baseUnitLabel, basePriceInCentimes, canUpdatePrice, unitPricing, canReadPackaging }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const session = useEditingSession();
  const changeView = (update) => session ? session.request(update) : update();
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const salePackagings = getSalePackagings(packagings);
  const filtered = sortProductPackagings(salePackagings).filter((packaging) => (
    (!normalizedQuery || `${packaging.label} ${packaging.quantity}`.toLocaleLowerCase('fr').includes(normalizedQuery))
    && (status === 'ALL' || Boolean(packaging.salePrice) === (status === 'PRICED'))
  ));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PACKS_PER_PAGE));
  const activePage = Math.min(page, totalPages);
  const offset = (activePage - 1) * PACKS_PER_PAGE;
  const visible = filtered.slice(offset, offset + PACKS_PER_PAGE);
  const filtersActive = Boolean(query || status !== 'ALL');

  return (
    <section aria-labelledby='pack-pricing-title' className={styles.embeddedPackPricing}>
      <h3 className='sr-only' id='pack-pricing-title'>Tarification à l’unité et par pack</h3>
      {canReadPackaging && salePackagings.length > 0 &&
        <div className={styles.filters} role='search'>
          <div className={styles.search}>
            <ProductIcon name='search' />
            <label className='sr-only' htmlFor='pack-pricing-search'>Rechercher un conditionnement</label>
            <input id='pack-pricing-search' maxLength={100} placeholder='Rechercher par libellé ou quantité' type='search' value={query}
              onChange={(event) => { const value = event.target.value; changeView(() => { setQuery(value); setPage(1); }); }} />
          </div>
          <label className='sr-only' htmlFor='pack-pricing-status'>Filtrer les tarifs de packs</label>
          <select id='pack-pricing-status' value={status} onChange={(event) => { const value = event.target.value; changeView(() => { setStatus(value); setPage(1); }); }}>
            <option value='ALL'>Tous les tarifs</option><option value='PRICED'>Prix renseigné</option><option value='UNPRICED'>À renseigner</option>
          </select>
          {filtersActive && <button className={styles.reset} type='button' onClick={() => changeView(() => { setQuery(''); setStatus('ALL'); setPage(1); })}>Réinitialiser</button>}
        </div>}
      <div className={styles.packPricingGrid}>
        {visible.map((packaging) => {
          const price = packaging.salePrice?.amountInCentimes ?? null;
          const referencePrice = Number.isSafeInteger(basePriceInCentimes) ? basePriceInCentimes * packaging.quantity : null;
          const lastChange = packaging.salePriceHistory[0];
          const unitLabel = baseUnitLabel.toLocaleLowerCase('fr');
          return <div data-pack-quantity={packaging.quantity} key={packaging.id}>
            <PricingForm baseUnitLabel={packaging.label} canUpdatePrice={canUpdatePrice} currentPrice={price === null ? '' : (price / 100).toFixed(2)}
              currentPriceInCentimes={price} productId={productId} packagingId={packaging.id} title='Prix par pack'
              description={`${packaging.label} · ${packaging.quantity} ${unitLabel}s`}
              priceHint={Number.isSafeInteger(referencePrice) ? `Référence au prix unitaire : ${formatMoney(referencePrice)} DA TTC.` : 'Par pack · chaque changement est historisé.'}
              lastChange={lastChange?.changedAt ? { author: lastChange.changedBy ?? 'Compte indisponible', date: formatDate(lastChange.changedAt) } : null} />
            <details className={styles.help}>
              <summary>Historique du tarif de ce pack</summary>
              <PriceHistory history={packaging.salePriceHistory} idPrefix={`pack-${packaging.id}`} title={`Historique · ${packaging.label}`} />
            </details>
          </div>;
        })}
        {unitPricing}
      </div>
      {canReadPackaging && !visible.length && <div className={styles.empty}><ProductIcon name='box' /><h3>{salePackagings.length ? 'Aucun conditionnement trouvé' : 'Aucun conditionnement de vente'}</h3><p>{salePackagings.length ? 'Modifiez la recherche ou le filtre de tarif.' : 'Ajoutez un conditionnement activé pour la vente dans l’onglet Conditionnements pour renseigner son tarif.'}</p></div>}
      {canReadPackaging && salePackagings.length > 0 &&
      <div className={styles.footer}>
        <span>{filtered.length ? `${offset + 1}–${offset + visible.length}` : '0'} sur {filtered.length} conditionnements</span>
        <nav aria-label='Pagination des tarifs de packs' className={styles.pagination}>
          <button disabled={activePage === 1} type='button' onClick={() => changeView(() => setPage(activePage - 1))}>Précédent</button>
          <span aria-live='polite'>Page {activePage} sur {totalPages}</span>
          <button disabled={activePage === totalPages} type='button' onClick={() => changeView(() => setPage(activePage + 1))}>Suivant</button>
        </nav>
      </div>}
    </section>
  );
};

export default PackPricing;
