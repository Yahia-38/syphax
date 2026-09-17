import Link from 'next/link';

import { buildDelivererListHref } from '../../../lib/deliverers.js';
import { formatObjectiveMonth, formatObjectivePercentage, OBJECTIVE_ACHIEVEMENT_STATUSES } from '../../../lib/deliverer-objective-calculations.js';
import { formatReceptionMoney } from '../../../lib/receptions.js';
import DelivererDirectory from './deliverer-directory.js';
import DelivererIcon from './deliverer-icon.js';
import styles from './deliverer-list.module.css';

const PaginationLink = ({ children, disabled, href }) => disabled ? (
  <span aria-disabled='true' className={styles.disabled}>{children}</span>
) : <Link href={href}>{children}</Link>;

const DelivererList = ({
  deliverers = [], page, pageSize, query, status, totalItems, totalPages,
  readError = false, canCreateDeliverer, canReadTours, canUpdateDeliverer,
  canReadObjectives = false, month = '', achievementStatus = '',
}) => {
  const monthlyState = canReadObjectives ? { month, achievementStatus } : {};
  const href = (changes = {}) => buildDelivererListHref({ page, query, status, ...monthlyState, ...changes });
  const returnHref = href();
  const resetHref = href({ page: 1, query: '', status: 'active', achievementStatus: '' });
  const allHref = href({ page: 1, status: 'all' });
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + deliverers.length - 1;
  const detailHref = (id, section, editing = false) => {
    const parameters = new URLSearchParams({ retour: returnHref });
    if (section) parameters.set('section', section);
    if (editing) parameters.set('modifier', '1');
    if (canReadObjectives) {
      parameters.set('bilanMois', month);
      if (!section) parameters.set('section', 'objectifs');
    }
    return `/livreurs/${id}?${parameters.toString()}`;
  };

  return (
    <DelivererDirectory returnHref={returnHref} appliedQuery={query} announcement={readError ? 'Résultats indisponibles.' : `${totalItems} résultat${totalItems > 1 ? 's' : ''}.`}>
      <h2 className='sr-only' id='deliverer-list-title'>Répertoire des livreurs</h2>
      <div className={styles.toolbar}>
        <form action='/livreurs' className={`${styles.search} ${canReadObjectives ? styles.overviewSearch : ''}`} method='get' role='search' key={returnHref}>
          <input name='statut' type='hidden' value={status} />
          <div>
            <label htmlFor='deliverer-search'>Rechercher un livreur</label>
            <div className={styles.searchField}>
              <DelivererIcon name='search' />
              <input defaultValue={query} id='deliverer-search' maxLength={100} name='q' placeholder='Code ou nom du livreur' type='search' />
              <kbd aria-hidden='true'>/</kbd>
            </div>
          </div>
          {canReadObjectives && <>
            <div className={styles.monthField}><label htmlFor='deliverer-month'>Mois</label><input id='deliverer-month' name='mois' type='month' min='1000-01' max='9999-12' required defaultValue={month} /></div>
            <div className={styles.achievementField}><label htmlFor='deliverer-achievement'>Réalisation</label><select id='deliverer-achievement' name='realisation' defaultValue={achievementStatus}>
              <option value=''>Toutes les réalisations</option>
              {Object.entries(OBJECTIVE_ACHIEVEMENT_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
          </>}
          <button className={styles.primary} type='submit'>Rechercher</button>
        </form>
        {!canReadObjectives && <p className={styles.hint}>Répertoire de distribution<br />Coordonnées et accès aux fiches</p>}
      </div>
      <div className={styles.statusLine}>
        <nav className={styles.filters} aria-label='Filtrer les livreurs par statut'>
          {[['active', 'Actifs'], ['disabled', 'Désactivés'], ['all', 'Tous']].map(([value, label]) => (
            <Link aria-current={status === value ? 'true' : undefined} href={href({ page: 1, status: value })} key={value}>{label}</Link>
          ))}
        </nav>
        <div className={styles.selection}>
          <p className={styles.resultCount} id='deliverer-result-count' tabIndex={-1}>
            {readError ? 'Résultats indisponibles' : <><strong>{totalItems}</strong> résultat{totalItems > 1 ? 's' : ''}</>}
            {query && <> pour « {query} »</>}
          </p>
          {(query || status !== 'active' || achievementStatus) && <Link href={resetHref}>Réinitialiser</Link>}
        </div>
      </div>
      <div className={styles.results}>
        {readError ? (
          <div className={styles.errorArea}>
            <div className={styles.errorNotice} role='alert'><h3>Impossible de charger les livreurs</h3><p>Vos critères sont conservés. Réessayez pour afficher les résultats.</p></div>
            <a className={styles.button} href={returnHref} data-retry>Réessayer</a>
          </div>
        ) : deliverers.length > 0 ? (
          <>
            <table className={`${styles.table} ${canReadObjectives ? styles.overviewTable : ''}`}>
              <caption className='sr-only'>Livreurs correspondant aux filtres{canReadObjectives && ` · Objectifs et réalisations de ${formatObjectiveMonth(month)}`}</caption>
              <thead><tr><th scope='col'>Livreur</th><th scope='col'>Téléphone</th>
                {canReadObjectives ? <><th scope='col'>Objectif</th><th scope='col'>CA réalisé</th><th scope='col'>Réalisé (%)</th><th scope='col'>Réalisation</th></> : <th scope='col'>Statut</th>}
                <th scope='col'>Accès</th></tr></thead>
              <tbody>{deliverers.map((deliverer) => (
                <tr key={deliverer.id}>
                  <td>
                    <div className={styles.person}>
                      <span className={`${styles.avatar} ${!deliverer.active ? styles.inactiveAvatar : ''}`} aria-hidden='true'>{(deliverer.name || '').trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase('fr')}</span>
                      <div><Link className={styles.name} href={detailHref(deliverer.id)}>{deliverer.name || 'Nom non renseigné'}</Link><code>{deliverer.code || 'Code non renseigné'}</code>
                        {canReadObjectives && <span className={`${deliverer.active ? styles.active : styles.inactive} ${styles.personStatus}`}>{deliverer.active ? 'Actif' : 'Désactivé'}</span>}
                      </div>
                    </div>
                  </td>
                  <td data-label='Téléphone'><div>{deliverer.phone ? <span className={styles.phone}>{deliverer.phone}</span> : <><span className={styles.missing}>Non renseigné</span>{canUpdateDeliverer && <Link className={styles.editPhone} aria-label={`Renseigner le téléphone de ${deliverer.name}`} href={detailHref(deliverer.id, 'identification', true)}>Renseigner</Link>}</>}</div></td>
                  {canReadObjectives ? <>
                    <td data-label='Objectif' className={styles.amount}>{deliverer.achievement.targetInCentimes === null ? <span className={styles.missing}>Non défini</span> : formatReceptionMoney(deliverer.achievement.targetInCentimes)}</td>
                    <td data-label='CA réalisé' className={styles.amount}>{deliverer.achievement.complete ? formatReceptionMoney(deliverer.achievement.salesInCentimes) : <span className={styles.unreliable}>Calcul incomplet</span>}</td>
                    <td data-label='Réalisé (%)' className={styles.amount}>{formatObjectivePercentage(deliverer.achievement.achievementPercentage)}</td>
                    <td data-label='Réalisation'><span className={`${styles.achievementBadge} ${deliverer.achievement.status === 'reached' ? styles.achieved
                      : ['missed', 'incomplete'].includes(deliverer.achievement.status) ? styles.unachieved
                        : deliverer.achievement.status === 'ongoing' ? styles.ongoing : styles.inactive}`}>
                      {OBJECTIVE_ACHIEVEMENT_STATUSES[deliverer.achievement.status]}
                    </span></td>
                  </> : <td><span className={deliverer.active ? styles.active : styles.inactive}>{deliverer.active ? 'Actif' : 'Désactivé'}</span></td>}
                  <td data-label='Accès'><div className={styles.actions}>
                    {canReadTours && <Link aria-label={`Voir les tournées de ${deliverer.name}`} href={detailHref(deliverer.id, 'tournees')}>Tournées</Link>}
                    <Link className={styles.button} aria-label={`Ouvrir la fiche de ${deliverer.name}`} href={detailHref(deliverer.id)}>Ouvrir <DelivererIcon name='arrow' /></Link>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
            <div className={styles.footer}>
              <p>{firstItem}–{lastItem} sur {totalItems} livreurs</p>
              <nav className={styles.pagination} aria-label='Pagination des livreurs'>
                <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
                <p>Page {page} / {totalPages}</p>
                <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
              </nav>
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden='true'><DelivererIcon name='people' /></span>
            <h3>{achievementStatus ? 'Aucun livreur pour cette réalisation' : query ? 'Aucun résultat pour cette recherche' : status === 'active' ? 'Aucun livreur actif' : status === 'disabled' ? 'Aucun livreur désactivé' : 'Aucun livreur à afficher'}</h3>
            <p>{achievementStatus ? `Aucun livreur ne correspond à ces critères pour ${formatObjectiveMonth(month)}. Ajustez la recherche ou la réalisation.` : query ? `Aucun code ou nom ne correspond à « ${query} » avec ce statut.` : status === 'active' ? 'Les livreurs actifs apparaîtront ici. Vous pouvez consulter tous les statuts.' : status === 'disabled' ? 'Aucun livreur ne correspond au statut Désactivé.' : 'Le répertoire ne contient aucun livreur.'}</p>
            <div className={styles.emptyActions}>
              {(query || achievementStatus) ? <Link className={styles.button} href={resetHref}>Réinitialiser les filtres</Link> : status !== 'all' && <Link className={styles.button} href={allHref}>Voir tous les livreurs</Link>}
              {canCreateDeliverer && <Link className={`${styles.button} ${styles.primary}`} href={`/livreurs/nouveau?${new URLSearchParams({ retour: returnHref })}`}>Nouveau livreur</Link>}
            </div>
          </div>
        )}
      </div>
      <p className={styles.caption}>{canReadObjectives ? `${formatObjectiveMonth(month)} · Ventes après retours aux prix historiques du chargement. « Non atteint » s’applique après la fin du mois. Les fiches s’ouvrent sur le mois sélectionné.` : status === 'disabled' ? 'Un livreur désactivé reste consultable avec son historique. Il ne peut plus recevoir de nouvelle tournée.' : status === 'all' ? 'Actif ou désactivé décrit le statut du livreur. Les tournées et les informations détaillées se consultent dans sa fiche.' : 'Les livreurs actifs sont affichés par défaut. Les coordonnées se modifient dans la fiche du livreur.'}</p>
    </DelivererDirectory>
  );
};

export default DelivererList;
