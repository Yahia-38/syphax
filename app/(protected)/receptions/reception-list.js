'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { buildReceptionHistoryHref, formatReceptionDate, readReceptionHistoryState } from '../../../lib/receptions.js';
import { Pagination, ReadError } from './reception-ui.js';
import styles from './receptions.module.css';

const RECEPTIONS_PER_PAGE = 10;
const BASE_UNIT_LABELS = new Map([
  ['PIECE', 'pièces'], ['BOUTEILLE', 'bouteilles'], ['BOITE', 'boîtes'], ['SACHET', 'sachets'],
]);
const formatLineSummary = (line) => {
  const product = line.productDesignation ? `${line.productCode} — ${line.productDesignation}` : line.productCode;
  if (!Number.isSafeInteger(line.quantityInBaseUnits) || line.quantityInBaseUnits <= 0) return product;
  return `${product} · ${line.quantityInBaseUnits} ${BASE_UNIT_LABELS.get(line.baseUnit) ?? line.baseUnit ?? 'unités'}`;
};

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
    <section className={styles.card} aria-labelledby='reception-list-title'>
      <div className={styles.cardHeader}><div><h2 id='reception-list-title'>Historique des réceptions</h2><p>Un document, sa date et un aperçu des marchandises reçues.</p></div></div>
      <div className={styles.filters} role='search'>
        <div><label htmlFor='reception-search'>Rechercher une réception</label><input id='reception-search' maxLength={100} onChange={(event) => changeFilters({ query: event.target.value, page: 1 })} placeholder='Référence, fournisseur, code ou produit' type='search' value={query} /></div>
        <div><label htmlFor='reception-supplier-filter'>Fournisseur</label><select id='reception-supplier-filter' onChange={(event) => changeFilters({ supplierId: event.target.value, page: 1 })} value={supplierId}>
          <option value='ALL'>Tous les fournisseurs</option>
          {supplierId !== 'ALL' && !supplierOptions.some(({ id }) => id === supplierId) && <option value={supplierId}>Fournisseur sélectionné</option>}
          {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></div>
      </div>
      <div className={styles.band}><p>{readError ? 'Lecture indisponible' : filteredReceptions.length ? `${firstIndex + 1}–${firstIndex + paginatedReceptions.length} sur ${filteredReceptions.length} réceptions` : '0 réception'}</p>{filtersActive && <button onClick={resetFilters} type='button'>Réinitialiser</button>}</div>
      {readError ? <div className='px-5'><ReadError>{readError}</ReadError></div> : filteredReceptions.length ? <>
        <table className={styles.table}><caption className='sr-only'>Historique des réceptions</caption><thead><tr><th scope='col'>Document fournisseur</th><th scope='col'>Date de réception</th><th scope='col'>Fournisseur</th><th scope='col'>Marchandises reçues</th><th scope='col'>Accès</th></tr></thead><tbody>
          {paginatedReceptions.map((reception) => <tr key={reception.id}>
            <td><Link className={styles.reference} href={getReceptionHref(reception.id)}>{reception.supplierReference}</Link><small>{reception.lines.length} ligne{reception.lines.length > 1 ? 's' : ''}</small></td>
            <td><span className={styles.mobileLabel}>Date de réception</span>{formatReceptionDate(reception.receptionDate)}</td>
            <td><span className={styles.mobileLabel}>Fournisseur</span>{reception.supplierName}</td>
            <td><span className={styles.mobileLabel}>Marchandises reçues</span><div className={styles.preview}>{reception.lines.slice(0, 2).map((line, index) => <span key={index}>{formatLineSummary(line)}</span>)}</div>{reception.lines.length > 2 && <small>+ {reception.lines.length - 2} ligne{reception.lines.length > 3 ? 's' : ''} dans la fiche</small>}</td>
            <td><Link className='font-semibold text-blue-700 hover:underline' aria-label={`Ouvrir la réception ${reception.supplierReference}`} href={getReceptionHref(reception.id)}>Ouvrir <span aria-hidden='true'>↗</span></Link></td>
          </tr>)}
        </tbody></table>
        <Pagination page={activePage} totalPages={totalPages} onChange={(page) => changeFilters({ page })} label='Pagination des réceptions' />
      </> : <div className={styles.empty}><h3>{filtersActive ? 'Aucune réception trouvée' : 'Aucune réception enregistrée'}</h3><p>{filtersActive ? 'Essayez une autre référence, un produit ou un fournisseur.' : 'Les réceptions enregistrées apparaîtront ici.'}</p>{filtersActive && <button className={styles.secondary} onClick={resetFilters} type='button'>Voir toutes les réceptions</button>}</div>}
    </section>
  );
};

export default ReceptionList;
