'use client';

import { useMemo, useRef, useState } from 'react';

import { formatReceptionMoney, formatReceptionUnitCost } from '../../../../lib/receptions.js';
import {
  formatReceptionQuantity,
  getReceptionEntryDetail,
  getReceptionUnitLabel,
  hasReceptionQuantityMismatch,
  isKnownReceptionAmount,
} from '../../../../lib/reception-detail.js';
import styles from './reception-detail.module.css';

const LINES_PER_PAGE = 10;

const ReceptionLine = ({ index, line, unitLabels }) => {
  const unitCost = formatReceptionUnitCost(line);
  const hasQuantity = Number.isSafeInteger(line.quantityInBaseUnits) && line.quantityInBaseUnits >= 0;
  return (
    <article className={styles.line} aria-label={`Ligne ${index + 1}`}>
      <div className={styles.lineGrid}>
        <div className={styles.product}>
          <p className={styles.lineNumber}>Ligne {index + 1}</p>
          <h3>{line.productDesignation || line.productCode || 'Produit non renseigné'}</h3>
          <code>{line.productCode || 'Code non renseigné'}</code>
        </div>
        <dl className={styles.lineNumbers}>
          <div><dt>Quantité reçue</dt><dd>{hasQuantity ? new Intl.NumberFormat('fr-DZ').format(line.quantityInBaseUnits) : '—'}</dd><small>{hasQuantity ? getReceptionUnitLabel(line.baseUnit, unitLabels, line.quantityInBaseUnits) : 'Non renseignée'}</small></div>
          <div><dt>Coût unitaire TTC</dt><dd className={unitCost === 'Non calculable' ? styles.missing : undefined}>{unitCost}</dd>{unitCost !== 'Non calculable' && <small>/ {getReceptionUnitLabel(line.baseUnit, unitLabels)}</small>}</div>
          <div><dt>Montant ligne TTC</dt><dd className={!isKnownReceptionAmount(line.amountInCentimes) ? styles.missing : undefined}>{formatReceptionMoney(line.amountInCentimes)}</dd></div>
        </dl>
      </div>
      <details className={styles.lineDetails}>
        <summary>{line.quantityMode === 'PACKAGING' ? 'Voir le conditionnement' : line.quantityMode === 'DIRECT' ? 'Voir la saisie directe' : 'Voir le détail disponible'}</summary>
        <div className={styles.conversion}>
          <p>{getReceptionEntryDetail(line, unitLabels)}</p>
          {hasReceptionQuantityMismatch(line) && <p className={styles.missing}>Incohérence historique : le détail de saisie diffère de la quantité reçue enregistrée. La quantité enregistrée est conservée.</p>}
          <p>{unitCost === 'Non calculable' ? 'Le coût unitaire nécessite un montant renseigné et une quantité de base positive.' : `Coût unitaire = ${formatReceptionMoney(line.amountInCentimes)} ÷ ${formatReceptionQuantity(line.quantityInBaseUnits, line.baseUnit, unitLabels)}.`}</p>
        </div>
      </details>
    </article>
  );
};

const ReceptionDetailLines = ({ baseUnits, lines }) => {
  const [query, setQuery] = useState('');
  const [quantityMode, setQuantityMode] = useState('ALL');
  const [amountFilter, setAmountFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const searchRef = useRef(null);
  const unitLabels = useMemo(() => new Map(baseUnits.map(({ code, label }) => [code, label])), [baseUnits]);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredLines = useMemo(() => lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => {
      const text = [line.productCode, line.productDesignation, line.packaging?.label].filter(Boolean).join(' ').toLocaleLowerCase('fr');
      return (!normalizedQuery || text.includes(normalizedQuery))
        && (quantityMode === 'ALL' || line.quantityMode === quantityMode)
        && (amountFilter === 'ALL' || (amountFilter === 'KNOWN' ? isKnownReceptionAmount(line.amountInCentimes) : !isKnownReceptionAmount(line.amountInCentimes)));
    }), [lines, normalizedQuery, quantityMode, amountFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredLines.length / LINES_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const start = (activePage - 1) * LINES_PER_PAGE;
  const visibleLines = filteredLines.slice(start, start + LINES_PER_PAGE);
  const filtersActive = Boolean(normalizedQuery || quantityMode !== 'ALL' || amountFilter !== 'ALL');
  const resetFilters = () => {
    setQuery('');
    setQuantityMode('ALL');
    setAmountFilter('ALL');
    setCurrentPage(1);
    searchRef.current?.focus();
  };

  return (
    <section aria-labelledby='reception-lines-title' className={styles.card}>
      <div className={styles.cardHeader}>
        <div><div className={styles.sectionTitle}><h2 id='reception-lines-title'>Produits reçus</h2><span className={styles.count}>{lines.length}</span></div><p>Quantités et libellés enregistrés lors de la réception.</p></div>
      </div>
      <div className={styles.filters} role='search' aria-label='Filtres des lignes de réception'>
        <div className={styles.searchField}>
          <label htmlFor='reception-line-search'>Rechercher une ligne</label>
          <input id='reception-line-search' maxLength={100} onChange={(event) => { setQuery(event.target.value); setCurrentPage(1); }} placeholder='Code, désignation ou conditionnement' ref={searchRef} type='search' value={query} />
        </div>
        <div>
          <label htmlFor='reception-line-mode'>Mode de saisie</label>
          <select id='reception-line-mode' onChange={(event) => { setQuantityMode(event.target.value); setCurrentPage(1); }} value={quantityMode}>
            <option value='ALL'>Tous les modes</option><option value='DIRECT'>Unités directes</option><option value='PACKAGING'>Conditionnements</option>
          </select>
        </div>
        <div>
          <label htmlFor='reception-line-amount'>Montant TTC</label>
          <select id='reception-line-amount' onChange={(event) => { setAmountFilter(event.target.value); setCurrentPage(1); }} value={amountFilter}>
            <option value='ALL'>Tous les montants</option><option value='MISSING'>Non renseignés</option><option value='KNOWN'>Renseignés</option>
          </select>
        </div>
      </div>
      <div className={styles.results}>
        <p role='status'>{filteredLines.length ? `${start + 1}–${start + visibleLines.length} sur ${filteredLines.length} lignes${filtersActive ? ` · ${lines.length} dans la réception` : ''}` : `0 ligne${filtersActive ? ` sur ${lines.length}` : ''}`}</p>
        {filtersActive && <button onClick={resetFilters} type='button'>Réinitialiser</button>}
      </div>
      <div className={styles.lineHead} aria-hidden='true'><span>Produit</span><span>Quantité reçue</span><span>Coût unitaire TTC</span><span>Montant ligne TTC</span></div>
      {visibleLines.length ? (
        <>
          {visibleLines.map(({ index, line }) => <ReceptionLine index={index} key={index} line={line} unitLabels={unitLabels} />)}
        </>
      ) : (
        <div className={styles.empty}><h3>{lines.length ? 'Aucune ligne ne correspond' : 'Aucune ligne enregistrée'}</h3><p>{lines.length ? 'Modifiez la recherche ou réinitialisez les filtres.' : 'Cette réception ne contient aucune ligne disponible à afficher.'}</p></div>
      )}
      <nav aria-label='Pagination des produits reçus' className={styles.pagination}>
        <button disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)} type='button'><span aria-hidden='true'>← </span>Précédent</button>
        <span aria-live='polite'>Page {activePage} sur {totalPages}</span>
        <button disabled={activePage === totalPages} onClick={() => setCurrentPage(activePage + 1)} type='button'>Suivant<span aria-hidden='true'> →</span></button>
      </nav>
    </section>
  );
};

export default ReceptionDetailLines;
