import { formatObjectiveMonth, formatObjectivePercentage, OBJECTIVE_ACHIEVEMENT_STATUSES } from '../../../../lib/deliverer-objective-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { buildDelivererToursHref } from '../../../../lib/tours.js';
import { EditingLink } from '../../components/editing-session.js';
import ObjectiveAchievementStatus from './objective-achievement-status.js';
import ObjectiveNavigationFields from './objective-navigation-fields.js';
import ObjectiveNavigationForm from './objective-navigation-form.js';
import styles from './deliverer-detail.module.css';

const money = (value) => value === null ? '—' : formatReceptionMoney(value);

const DelivererMonthlyHistory = ({ history, delivererId, returnHref, navigationState }) => {
  const { rows, years, historyYear, historyStatus, historyQuery, historyPage, totalItems, totalPages } = history;
  const href = (changes = {}) => buildDelivererToursHref({ delivererId, returnHref, section: 'objectifs', ...navigationState, ...changes });
  return (
    <section className={styles.card} aria-labelledby='monthly-history-title'>
      <div className={styles.cardHead}><h2 id='monthly-history-title'>Historique mensuel</h2><p>Objectifs et ventes de chaque mois, y compris les mois sans ventes.</p></div>
      <ObjectiveNavigationForm key={href()} className={styles.filters} action={`/livreurs/${delivererId}`} role='search'>
        <ObjectiveNavigationFields href={href()} omit={['bilanRecherche', 'bilanAnnee', 'bilanStatut', 'bilanPage']} />
        <div><label htmlFor='monthly-history-search'>Mois</label><input id='monthly-history-search' name='bilanRecherche' type='search' maxLength={100} defaultValue={historyQuery} placeholder='Rechercher un mois' /></div>
        <div><label htmlFor='monthly-history-year'>Année</label><select id='monthly-history-year' name='bilanAnnee' defaultValue={historyYear}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></div>
        <div><label htmlFor='monthly-history-status'>Statut</label><select id='monthly-history-status' name='bilanStatut' defaultValue={historyStatus}>
          <option value=''>Tous les statuts</option>{Object.entries(OBJECTIVE_ACHIEVEMENT_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></div>
        <button type='submit'>Filtrer</button>
        {(historyQuery || historyStatus) && <EditingLink href={href({ historyQuery: '', historyStatus: '', historyPage: 1 })}>Réinitialiser</EditingLink>}
      </ObjectiveNavigationForm>
      {rows.length ? <>
        <table className={`${styles.table} ${styles.monthlyTable}`}>
          <caption className='sr-only'>Historique mensuel des objectifs et réalisations du livreur</caption>
          <thead><tr><th scope='col'>Mois</th><th scope='col'>Objectif</th><th scope='col'>CA réalisé</th><th scope='col'>Réalisé (%)</th><th scope='col'>Reste</th><th scope='col'>Excédent</th><th scope='col'>Statut</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.month}>
            <td><EditingLink className={styles.openLink} href={href({ achievementMonth: row.month })}>{formatObjectiveMonth(row.month)} ↗</EditingLink></td>
            <td data-label='Objectif'>{row.targetInCentimes === null ? 'Non défini' : money(row.targetInCentimes)}</td>
            <td data-label='CA réalisé'>{row.complete ? money(row.salesInCentimes) : 'Calcul incomplet'}</td>
            <td data-label='Réalisé (%)'>{formatObjectivePercentage(row.achievementPercentage)}</td>
            <td data-label='Reste'>{money(row.remainingInCentimes)}</td>
            <td data-label='Excédent'>{money(row.excessInCentimes)}</td>
            <td data-label='Statut'><ObjectiveAchievementStatus status={row.status} /></td>
          </tr>)}</tbody>
        </table>
        <div className={styles.footer}><span role='status'>{totalItems} mois</span>
          {totalPages > 1 && <nav className={styles.pagination} aria-label='Pagination de l’historique mensuel'>
            {historyPage > 1 ? <EditingLink href={href({ historyPage: historyPage - 1 })}>Précédent</EditingLink> : <span aria-disabled='true'>Précédent</span>}
            <span>Page {historyPage} sur {totalPages}</span>
            {historyPage < totalPages ? <EditingLink href={href({ historyPage: historyPage + 1 })}>Suivant</EditingLink> : <span aria-disabled='true'>Suivant</span>}
          </nav>}
        </div>
      </> : <div className={styles.empty}><h3>Aucun mois trouvé</h3><p>Ajustez l’année, le statut ou la recherche.</p></div>}
      <p className={styles.footnote}>Les mois sont affichés depuis la création du livreur ou sa première activité connue jusqu’au mois courant. Cliquez sur un mois pour consulter son détail.</p>
    </section>
  );
};

export default DelivererMonthlyHistory;
