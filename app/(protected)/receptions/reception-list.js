'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buildReceptionHistoryHref, readReceptionHistoryState } from '../../../lib/receptions.js';
import { Pagination, ReadError, formatReceptionShortDate } from './reception-ui.js';
import styles from './receptions.module.css';

const RECEPTIONS_PER_PAGE = 10;
const BASE_UNIT_LABELS = new Map([
  ['PIECE', 'pièces'], ['BOUTEILLE', 'bouteilles'], ['BOITE', 'boîtes'], ['SACHET', 'sachets'],
]);

const ReceptionList = ({ receptions, readError }) => {
  const parameters = useSearchParams();
  // URL state handles detail returns and browser back/forward. Filtering remains local.
  const { query, supplierId, page: currentPage } = readReceptionHistoryState(Object.fromEntries(parameters));
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filtersActive = Boolean(normalizedQuery || supplierId !== 'ALL');
  const supplierOptions = useMemo(() => {
    const suppliers = new Map(receptions.map((reception) => [reception.supplierId, reception.supplierName]));
    return [...suppliers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [receptions]);
  const filteredReceptions = receptions.filter((reception) => {
    const text = [reception.supplierReference, reception.supplierName,
      ...reception.lines.flatMap((line) => [line.productCode, line.productDesignation])].join(' ').toLocaleLowerCase('fr');
    return (!normalizedQuery || text.includes(normalizedQuery)) && (supplierId === 'ALL' || reception.supplierId === supplierId);
  });
  const totalPages = Math.max(1, Math.ceil(filteredReceptions.length / RECEPTIONS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const firstIndex = (activePage - 1) * RECEPTIONS_PER_PAGE;
  const paginatedReceptions = filteredReceptions.slice(firstIndex, firstIndex + RECEPTIONS_PER_PAGE);
  const historyHref = buildReceptionHistoryHref({ page: activePage, query, supplierId });
  const changeFilters = (changes) => window.history.replaceState({ syphaxEditingIndex: window.history.state?.syphaxEditingIndex }, '', buildReceptionHistoryHref({ page: currentPage, query, supplierId, ...changes }));
  const resetFilters = () => changeFilters({ page: 1, query: '', supplierId: 'ALL' });
  const getReceptionHref = (id) => `/receptions/${id}?${new URLSearchParams({ retour: historyHref })}`;

  return (
    <div>
      <div className={styles.sectionLabel}><h2 id='reception-list-title'>Historique des réceptions</h2><p>Documents enregistrés · du plus récent au plus ancien</p></div>
      <section className={styles.card} aria-labelledby='reception-list-title'>
      <form className={styles.compactFilters} key={`${query}:${supplierId}`} role='search' onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        changeFilters({ query: String(data.get('query')).trim(), supplierId: String(data.get('supplierId')), page: 1 });
      }}>
        <div><label htmlFor='reception-search'>Rechercher</label><input id='reception-search' name='query' maxLength={100} placeholder='Référence, fournisseur ou produit' type='search' defaultValue={query} /></div>
        <div><label htmlFor='reception-supplier-filter'>Fournisseur de la réception</label><select id='reception-supplier-filter' name='supplierId' defaultValue={supplierId}>
          <option value='ALL'>Tous les fournisseurs</option>
          {supplierId !== 'ALL' && !supplierOptions.some(({ id }) => id === supplierId) && <option value={supplierId}>Fournisseur sélectionné</option>}
          {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></div>
        <button className={styles.primary} type='submit'>Rechercher</button>
      </form>
      <div className={styles.band}><p>{readError ? 'Résultats indisponibles' : `${filteredReceptions.length} réception${filteredReceptions.length > 1 ? 's' : ''}`}{normalizedQuery && ` pour « ${query} »`}</p>{filtersActive && <button onClick={resetFilters} type='button'>Réinitialiser</button>}</div>
      {readError ? <div className='px-5'><ReadError>{readError}</ReadError></div> : filteredReceptions.length ? <>
        <table className={styles.table}><caption className='sr-only'>Historique des réceptions</caption><thead><tr><th scope='col'>Document fournisseur</th><th scope='col'>Date de réception</th><th scope='col'>Fournisseur</th><th scope='col'>Marchandises reçues</th><th scope='col'>Accès</th></tr></thead><tbody>
          {paginatedReceptions.map((reception) => <tr key={reception.id}>
            <td><Link className={styles.reference} href={getReceptionHref(reception.id)}>{reception.supplierReference}</Link><small>{reception.lines.length} ligne{reception.lines.length > 1 ? 's enregistrées' : ' enregistrée'}</small></td>
            <td><span className={styles.mobileLabel}>Date de réception</span>{formatReceptionShortDate(reception.receptionDate)}</td>
            <td><span className={styles.mobileLabel}>Fournisseur</span>{reception.supplierName}</td>
            <td className={styles.products}>{reception.lines.slice(0, 2).map((line) => line.productDesignation || line.productCode).join(' · ')}{reception.lines.length > 2 && ` · + ${reception.lines.length - 2} lignes`}<div className={styles.quantityBadges}>{reception.lines.slice(0, 2).map((line, index) => Number.isSafeInteger(line.quantityInBaseUnits) && line.quantityInBaseUnits > 0 && <span key={index}>{line.quantityInBaseUnits} {BASE_UNIT_LABELS.get(line.baseUnit) ?? line.baseUnit ?? 'unités'}</span>)}</div></td>
            <td><Link className={styles.openLink} aria-label={`Ouvrir la réception ${reception.supplierReference}`} href={getReceptionHref(reception.id)}>Ouvrir <span aria-hidden='true'>→</span></Link></td>
          </tr>)}
        </tbody></table>
        <Pagination page={activePage} totalPages={totalPages} totalResults={filteredReceptions.length} onChange={(page) => changeFilters({ page })} label='Pagination des réceptions' />
      </> : <div className={styles.empty}><h3>{filtersActive ? 'Aucune réception trouvée' : 'Aucune réception enregistrée'}</h3><p>{filtersActive ? 'Essayez une autre référence, un produit ou un fournisseur.' : 'Les réceptions enregistrées apparaîtront ici.'}</p>{filtersActive && <button className={styles.secondary} onClick={resetFilters} type='button'>Voir toutes les réceptions</button>}</div>}
      <p className={styles.listHelp}>Les quantités restent attachées à chaque produit et unité. Les références et noms affichés proviennent de la réception enregistrée.</p>
      </section>
    </div>
  );
};

export default ReceptionList;
