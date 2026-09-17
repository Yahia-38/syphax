import { formatObjectiveMonth } from '../../../../lib/deliverer-objective-calculations.js';
import { formatDelivererCreatedAt } from '../../../../lib/deliverers.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { buildDelivererToursHref } from '../../../../lib/tours.js';
import { EditingLink } from '../../components/editing-session.js';
import styles from './deliverer-detail.module.css';

const DelivererObjectiveHistory = ({ objectives, delivererId, returnHref }) => {
  const { history, objectiveQuery, objectiveMonth, objectivePage, totalItems, totalPages } = objectives;
  const href = (changes = {}) => buildDelivererToursHref({
    delivererId, returnHref, section: 'objectifs', objectiveQuery, objectiveMonth, objectivePage, ...changes,
  });
  return (
    <section className={styles.card} aria-labelledby='objective-history-title'>
      <div className={styles.cardHead}><h2 id='objective-history-title'>Historique des objectifs</h2><p>Toutes les définitions et modifications, y compris les valeurs remplacées.</p></div>
      <form className={styles.filters} action={`/livreurs/${delivererId}`} method='get' role='search'>
        <input type='hidden' name='retour' value={returnHref} />
        <input type='hidden' name='section' value='objectifs' />
        <div><label htmlFor='objective-history-search'>Montant ou auteur</label><input id='objective-history-search' name='objectifRecherche' type='search' maxLength={100} defaultValue={objectiveQuery} placeholder='Rechercher un montant ou un auteur' /></div>
        <div><label htmlFor='objective-history-month'>Mois de prise d’effet</label><input id='objective-history-month' name='objectifMois' type='month' defaultValue={objectiveMonth} /></div>
        <button type='submit'>Rechercher</button>
        {(objectiveQuery || objectiveMonth) && <EditingLink href={href({ objectiveQuery: '', objectiveMonth: '', objectivePage: 1 })}>Réinitialiser</EditingLink>}
      </form>
      {history.length ? <>
        <table className={`${styles.table} ${styles.objectiveTable}`}>
          <caption className='sr-only'>Historique des définitions de l’objectif mensuel du livreur</caption>
          <thead><tr><th scope='col'>À partir de</th><th scope='col'>Objectif mensuel</th><th scope='col'>Enregistré le</th><th scope='col'>Par</th></tr></thead>
          <tbody>{history.map((entry) => <tr key={entry.version}>
            <td>{formatObjectiveMonth(entry.effectiveMonth)}</td>
            <td data-label='Objectif mensuel'>{formatReceptionMoney(entry.amountInCentimes)}</td>
            <td data-label='Enregistré le'>{formatDelivererCreatedAt(entry.changedAt)}</td>
            <td data-label='Par'>{entry.changedBy}</td>
          </tr>)}</tbody>
        </table>
        <div className={styles.footer}>
          <span role='status'>{totalItems} modification{totalItems > 1 ? 's' : ''}</span>
          {totalPages > 1 && <nav className={styles.pagination} aria-label='Pagination de l’historique des objectifs'>
            {objectivePage > 1 ? <EditingLink href={href({ objectivePage: objectivePage - 1 })}>Précédent</EditingLink> : <span aria-disabled='true'>Précédent</span>}
            <span>Page {objectivePage} sur {totalPages}</span>
            {objectivePage < totalPages ? <EditingLink href={href({ objectivePage: objectivePage + 1 })}>Suivant</EditingLink> : <span aria-disabled='true'>Suivant</span>}
          </nav>}
        </div>
      </> : <div className={styles.empty}><h3>{objectiveQuery || objectiveMonth ? 'Aucune modification trouvée' : 'Aucun objectif défini'}</h3><p>{objectiveQuery || objectiveMonth ? 'Ajustez la recherche ou le mois.' : 'Les définitions et modifications de l’objectif apparaîtront ici.'}</p></div>}
    </section>
  );
};

export default DelivererObjectiveHistory;
