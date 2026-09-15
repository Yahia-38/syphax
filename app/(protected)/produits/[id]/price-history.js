'use client';

import { useMemo, useState } from 'react';

import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

const HISTORY_PER_PAGE = 5;

const CHANGE_TYPES = [
  { label: 'Premier prix', value: 'INITIAL' },
  { label: 'Hausses', value: 'INCREASE' },
  { label: 'Baisses', value: 'DECREASE' },
  { label: 'Sans variation', value: 'UNCHANGED' },
];

const formatDate = (value) => {
  if (!value) {
    return 'Date non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatMoney = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return 'Non renseigné';
  }

  return `${new Intl.NumberFormat('fr-DZ', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amountInCentimes / 100)} DA`;
};

const getChangeType = (entry) => {
  if (!Number.isSafeInteger(entry.oldAmountInCentimes)) {
    return 'INITIAL';
  }

  if (entry.newAmountInCentimes > entry.oldAmountInCentimes) {
    return 'INCREASE';
  }

  if (entry.newAmountInCentimes < entry.oldAmountInCentimes) {
    return 'DECREASE';
  }

  return 'UNCHANGED';
};

const PriceHistory = ({ history }) => {
  const [query, setQuery] = useState('');
  const [changeType, setChangeType] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const availableChangeTypes = useMemo(() => {
    const usedTypes = new Set(history.map(getChangeType));
    return CHANGE_TYPES.filter(({ value }) => usedTypes.has(value));
  }, [history]);
  const filteredHistory = useMemo(
    () => history.filter((entry) => {
      const searchText = [
        entry.changedBy ?? 'Compte indisponible',
        formatDate(entry.changedAt),
        formatMoney(entry.oldAmountInCentimes),
        formatMoney(entry.newAmountInCentimes),
      ].join(' ').toLocaleLowerCase('fr');
      const matchesQuery = !normalizedQuery
        || searchText.includes(normalizedQuery);
      const matchesType = changeType === 'ALL'
        || getChangeType(entry) === changeType;

      return matchesQuery && matchesType;
    }),
    [changeType, history, normalizedQuery],
  );
  const filtersActive = Boolean(normalizedQuery || changeType !== 'ALL');
  const totalPages = Math.max(
    1,
    Math.ceil(filteredHistory.length / HISTORY_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstHistoryIndex = (activePage - 1) * HISTORY_PER_PAGE;
  const paginatedHistory = filteredHistory.slice(
    firstHistoryIndex,
    firstHistoryIndex + HISTORY_PER_PAGE,
  );

  const resetFilters = () => {
    setQuery('');
    setChangeType('ALL');
    setCurrentPage(1);
  };

  return (
    <section aria-labelledby='price-history-title' className={styles.card}>
      <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='clock' /><h2 id='price-history-title'>Historique du prix</h2></div><span className={styles.pill}>{history.length} changements</span></div>
      <div className={styles.filters} role='search'>
        <div className={styles.search}><ProductIcon name='search' /><label className='sr-only' htmlFor='price-history-search'>Rechercher dans l’historique</label>
          <input id='price-history-search' maxLength={100} placeholder='Rechercher par auteur, date ou montant' type='search' value={query} onChange={(event) => { setQuery(event.target.value); setCurrentPage(1); }} /></div>
        <label className='sr-only' htmlFor='price-change-filter'>Filtrer par type de variation</label>
        <select id='price-change-filter' value={changeType} onChange={(event) => { setChangeType(event.target.value); setCurrentPage(1); }}>
          <option value='ALL'>Toutes les variations</option>{availableChangeTypes.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
        </select>
        {filtersActive && <button className={styles.reset} onClick={resetFilters} type='button'>Réinitialiser</button>}
      </div>
      {paginatedHistory.length ? <table className={styles.table}>
        <caption className='sr-only'>Historique du prix de vente TTC en DA</caption>
        <thead><tr>{['Date', 'Ancien prix', 'Nouveau prix', 'Variation', 'Auteur'].map((label) => <th scope='col' key={label}>{label}</th>)}</tr></thead>
        <tbody>{paginatedHistory.map((entry) => {
          const initial = !Number.isSafeInteger(entry.oldAmountInCentimes);
          const difference = initial ? null : entry.newAmountInCentimes - entry.oldAmountInCentimes;
          return <tr key={entry.id}>
            <td data-label='Date'>{formatDate(entry.changedAt)}</td>
            <td data-label='Ancien prix'>{formatMoney(entry.oldAmountInCentimes)}</td>
            <td data-label='Nouveau prix'><strong>{formatMoney(entry.newAmountInCentimes)}</strong></td>
            <td data-label='Variation'><span className={`${styles.pill} ${difference < 0 ? styles.pillDown : ''}`}>{initial ? 'Premier prix' : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${formatMoney(Math.abs(difference))}`}</span></td>
            <td data-label='Auteur'>{entry.changedBy ?? 'Compte indisponible'}</td>
          </tr>;
        })}</tbody>
      </table> : <div className={styles.empty}><ProductIcon name='price' /><h3>{history.length ? 'Aucun changement trouvé' : 'Aucun changement enregistré'}</h3><p>{history.length ? 'Modifiez la recherche ou le filtre de variation.' : 'Le premier prix renseigné apparaîtra ici.'}</p>{filtersActive && <button className={styles.reset} onClick={resetFilters} type='button'>Voir tout l’historique</button>}</div>}
      <div className={styles.footer}><span>{filteredHistory.length ? `${firstHistoryIndex + 1}–${firstHistoryIndex + paginatedHistory.length}` : '0'} sur {filteredHistory.length} changements{filtersActive ? ` (${history.length} au total)` : ''}</span>
        <nav aria-label='Pagination de l’historique des prix' className={styles.pagination}>
          <button disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)} type='button'>Précédent</button><span aria-live='polite'>Page {activePage} sur {totalPages}</span>
          <button disabled={activePage === totalPages} onClick={() => setCurrentPage(activePage + 1)} type='button'>Suivant</button>
        </nav>
      </div>
    </section>
  );
};

export default PriceHistory;
