import { buildDelivererToursHref, formatTourDate, formatTourStatus } from '../../../../lib/tours.js';
import { EditingLink } from '../../components/editing-session.js';
import styles from './deliverer-detail.module.css';

const statusStyles = { PREPARATION: styles.preparation, LOADED: styles.loaded, COUNTED: styles.counted, CLOSED: styles.closed, CANCELLED: styles.cancelled };
const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true'>{children}</span> : <EditingLink href={href}>{children}</EditingLink>;

const DelivererTourList = ({ delivererId, delivererName, page, pageSize, plannedDate, query, returnHref, totalItems, totalPages, tours }) => {
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const href = (changes = {}) => buildDelivererToursHref({ delivererId, page, plannedDate, query, returnHref, section: 'tournees', ...changes });
  const tourHref = (id) => `/tournees/${id}?${new URLSearchParams({ retour: href() })}`;
  return (
    <section className={styles.card} aria-labelledby='deliverer-tours-title'>
      <div className={styles.cardHead}><h2 id='deliverer-tours-title'>Tournées</h2><p>Retrouvez les tournées de ce livreur, quel que soit leur statut.</p></div>
      <form className={styles.filters} action={`/livreurs/${delivererId}`} method='get' role='search'>
        <input name='retour' type='hidden' value={returnHref} />
        <input name='section' type='hidden' value='tournees' />
        <div><label htmlFor='tour-search'>Référence de tournée</label><input id='tour-search' name='tourneeRecherche' type='search' maxLength={100} defaultValue={query} placeholder='Rechercher par référence' /></div>
        <div><label htmlFor='tour-date-filter'>Date prévue</label><input id='tour-date-filter' name='tourneeDate' type='date' defaultValue={plannedDate} /></div>
        <button type='submit'>Rechercher</button>
        {(query || plannedDate) && <EditingLink href={href({ page: 1, plannedDate: '', query: '' })}>Réinitialiser</EditingLink>}
      </form>
      {tours.length ? <>
        <table className={styles.table}>
          <caption className='sr-only'>Tournées de {delivererName}</caption>
          <thead><tr><th scope='col'>Référence</th><th scope='col'>Date prévue</th><th scope='col'>Statut</th><th scope='col'><span className='sr-only'>Action</span></th></tr></thead>
          <tbody>{tours.map((tour) => <tr key={tour.id}>
            <td><EditingLink className={styles.tourRef} href={tourHref(tour.id)}>{tour.reference}</EditingLink></td>
            <td data-label='Date prévue'>{formatTourDate(tour.plannedDate)}</td>
            <td data-label='Statut'><span className={`${styles.tourState} ${statusStyles[tour.status] ?? styles.preparation}`}>{formatTourStatus(tour.status)}</span></td>
            <td><EditingLink className={styles.openLink} href={tourHref(tour.id)} aria-label={`Ouvrir ${tour.reference}`}>Ouvrir ↗</EditingLink></td>
          </tr>)}</tbody>
        </table>
        <div className={styles.footer}><span role='status'>{firstItem}–{firstItem + tours.length - 1} sur {totalItems} tournées</span>
          {totalPages > 1 && <nav className={styles.pagination} aria-label='Pagination des tournées du livreur'>
            <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}>Précédent</PaginationLink>
            <span>Page {page} sur {totalPages}</span>
            <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant</PaginationLink>
          </nav>}
        </div>
      </> : <div className={styles.empty}><h3>{query || plannedDate ? 'Aucune tournée trouvée' : 'Aucune tournée créée'}</h3><p>{query || plannedDate ? 'Ajustez la référence ou la date prévue.' : 'Les tournées de ce livreur apparaîtront ici.'}</p>{(query || plannedDate) && <EditingLink href={href({ page: 1, plannedDate: '', query: '' })}>Voir toutes les tournées</EditingLink>}</div>}
    </section>
  );
};

export default DelivererTourList;
