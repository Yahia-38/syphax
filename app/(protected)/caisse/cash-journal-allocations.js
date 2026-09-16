'use client';

import { useId, useState } from 'react';
import { EditingLink } from '../components/editing-session.js';
import { formatCashSignedAmount } from '../../../lib/cash-navigation.js';
import styles from './cash.module.css';

const CashJournalAllocations = ({ allocations, canReadTours }) => {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searchId = useId();
  const filtered = allocations.filter((allocation) => allocation.reference.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 5));
  const activePage = Math.min(page, totalPages);
  return <details className={styles.journalAllocations}>
    <summary>{allocations.length} affectation{allocations.length > 1 ? 's' : ''}</summary>
    <div>
      <label htmlFor={searchId}>Référence de tournée</label>
      <input id={searchId} type='search' value={query} placeholder='Rechercher une affectation' onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      {filtered.slice((activePage - 1) * 5, activePage * 5).map((allocation) => <div className={styles.journalAllocation} key={allocation.id}>
        <p>{canReadTours && allocation.id ? <EditingLink href={`/tournees/${allocation.id}`}>{allocation.reference}</EditingLink> : allocation.reference}</p>
        <p>{formatCashSignedAmount(allocation.amountInCentimes)}</p>
      </div>)}
      {!filtered.length && <p>Aucune affectation pour cette référence.</p>}
      <nav className={styles.allocationPagination} aria-label='Pagination des affectations du mouvement'>
        <button type='button' disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>Précédent</button>
        <span>{activePage}/{totalPages}</span>
        <button type='button' disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)}>Suivant</button>
      </nav>
    </div>
  </details>;
};

export default CashJournalAllocations;
