'use client';

import { EditingLink } from '../../components/editing-session.js';
import { useMemo, useState } from 'react';

import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

const MOVEMENTS_PER_PAGE = 8;

const formatDate = (value) => {
  if (!value) {
    return 'Date indisponible';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(Math.abs(quantity));

const formatMovementKind = (kind) => kind === 'TOUR_LOADING_OUT'
  ? 'Chargement de tournée'
  : kind === 'TOUR_RETURN_IN'
    ? 'Retour de tournée'
  : kind === 'RECEPTION_IN'
    ? 'Réception'
    : 'Mouvement physique';

const StockMovementHistory = ({ movements, movementCount, baseUnitLabel, stock }) => {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const filteredMovements = useMemo(() => movements.filter((movement) => {
    const matchesDirection = direction === 'ALL'
      || (direction === 'IN' && movement.quantityDeltaInBaseUnits > 0)
      || (direction === 'OUT' && movement.quantityDeltaInBaseUnits < 0);
    const searchableText = [
      formatMovementKind(movement.kind),
      movement.author,
      movement.sourceTour?.reference,
      movement.sourceReception?.reference,
      formatDate(movement.occurredOn ?? movement.recordedAt),
    ].filter(Boolean).join(' ').toLocaleLowerCase('fr');

    return matchesDirection
      && (!normalizedQuery || searchableText.includes(normalizedQuery));
  }), [direction, movements, normalizedQuery]);
  const totalPages = Math.max(
    1,
    Math.ceil(filteredMovements.length / MOVEMENTS_PER_PAGE),
  );
  const activePage = Math.min(currentPage, totalPages);
  const firstMovementIndex = (activePage - 1) * MOVEMENTS_PER_PAGE;
  const paginatedMovements = filteredMovements.slice(
    firstMovementIndex,
    firstMovementIndex + MOVEMENTS_PER_PAGE,
  );

  return (
    <section className={styles.card} aria-labelledby='stock-history-title'>
      <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='clock' /><h2 id='stock-history-title'>Historique physique</h2></div></div>
      {stock && <dl className={styles.stockSummary}>
        <div><dt>Entrées</dt><dd className={styles.positive}>+{formatQuantity(stock.inputQuantityInBaseUnits)} {baseUnitLabel.toLocaleLowerCase('fr')}</dd></div>
        <div><dt>Sorties</dt><dd className={styles.negative}>−{formatQuantity(stock.outputQuantityInBaseUnits)} {baseUnitLabel.toLocaleLowerCase('fr')}</dd></div>
        <div><dt>Mouvements</dt><dd>{movementCount}</dd></div>
        <div><dt>Dernier mouvement</dt><dd>{formatDate(stock.lastMovementAt)}</dd></div>
      </dl>}
      <p className={styles.scope}>Compteurs : tous les mouvements physiques du produit. {movements.length} mouvements chargés sur {movementCount ?? movements.length} enregistrés. Les filtres portent sur les mouvements chargés.</p>
      <div className={styles.filters} role='search'>
        <div className={styles.search}><ProductIcon name='search' /><input aria-label='Rechercher un mouvement physique' maxLength={100} placeholder='Type, date, auteur ou source disponible' type='search' value={query}
          onChange={(event) => { setQuery(event.target.value); setCurrentPage(1); }} /></div>
        <div aria-label='Filtrer les mouvements' className={styles.segmented} role='group'>
          {[['ALL', 'Tous'], ['IN', 'Entrées'], ['OUT', 'Sorties']].map(([value, label]) => <button aria-pressed={direction === value} key={value} type='button'
            onClick={() => { setDirection(value); setCurrentPage(1); }}>{label}</button>)}
        </div>
      </div>
      {paginatedMovements.length ? <table className={styles.table}>
        <caption className='sr-only'>Mouvements physiques · quantités en {baseUnitLabel.toLocaleLowerCase('fr')}</caption>
        <thead><tr>{['Type', 'Date', 'Source', 'Auteur', 'Quantité'].map((label) => <th scope='col' key={label}>{label}</th>)}</tr></thead>
        <tbody>{paginatedMovements.map((movement) => {
          const isOutput = movement.quantityDeltaInBaseUnits < 0;
          const source = movement.sourceReception ?? movement.sourceTour;
          return <tr key={movement.id}>
            <td data-label='Type' className={styles.eventCell}><div className={styles.typeLabel}><span className={`${styles.typeIcon} ${isOutput ? styles.negative : ''}`}><ProductIcon name={isOutput ? 'out' : 'in'} /></span><strong>{formatMovementKind(movement.kind)}</strong></div></td>
            <td data-label='Date'>{formatDate(movement.occurredOn ?? movement.recordedAt)}</td>
            <td data-label='Source'>{source ? <EditingLink className={styles.sourceLink} href={`/${movement.sourceReception ? 'receptions' : 'tournees'}/${source.id}`}>{source.reference}<ProductIcon name='arrow' /></EditingLink> : 'Indisponible'}</td>
            <td data-label='Auteur'>{movement.author ?? 'Compte indisponible'}</td>
            <td data-label='Quantité' className={styles.right}><strong className={`${styles.delta} ${isOutput ? styles.negative : styles.positive}`}>{isOutput ? '−' : '+'}{formatQuantity(movement.quantityDeltaInBaseUnits)}</strong><small>{baseUnitLabel?.toLocaleLowerCase('fr') ?? movement.baseUnit ?? ''}</small></td>
          </tr>;
        })}</tbody>
      </table> : <div className={styles.empty}><ProductIcon name='stock' /><h3>{movements.length ? 'Aucun mouvement trouvé' : 'Aucun mouvement enregistré'}</h3><p>{movements.length ? 'Modifiez la recherche ou le filtre.' : 'Les opérations métier alimenteront cet historique.'}</p></div>}
      <div className={styles.footer}><span>{filteredMovements.length ? `${firstMovementIndex + 1}–${firstMovementIndex + paginatedMovements.length}` : '0'} sur {filteredMovements.length} mouvements filtrés</span>
        <nav aria-label='Pagination de l’historique physique' className={styles.pagination}>
          <button disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)} type='button'>Précédent</button>
          <span aria-live='polite'>Page {activePage} sur {totalPages}</span>
          <button disabled={activePage === totalPages} onClick={() => setCurrentPage(activePage + 1)} type='button'>Suivant</button>
        </nav>
      </div>
    </section>
  );
};

export default StockMovementHistory;
