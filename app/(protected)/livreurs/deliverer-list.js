import Link from 'next/link';

import { buildDelivererListHref } from '../../../lib/deliverers.js';
import DelivererDirectory from './deliverer-directory.js';
import DelivererIcon from './deliverer-icon.js';
import styles from './deliverer-list.module.css';

const PaginationLink = ({ children, disabled, href }) => disabled ? (
  <span aria-disabled='true' className={styles.disabled}>{children}</span>
) : <Link href={href}>{children}</Link>;

const DelivererList = ({
  deliverers = [], page, pageSize, query, status, totalItems, totalPages,
  readError = false, canCreateDeliverer, canReadTours, canUpdateDeliverer,
}) => {
  const returnHref = buildDelivererListHref({ page, query, status });
  const allHref = buildDelivererListHref({ query, status: 'all' });
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + deliverers.length - 1;
  const detailHref = (id, section, editing = false) => {
    const parameters = new URLSearchParams({ retour: returnHref });
    if (section) parameters.set('section', section);
    if (editing) parameters.set('modifier', '1');
    return `/livreurs/${id}?${parameters.toString()}`;
  };

  return (
    <DelivererDirectory returnHref={returnHref} appliedQuery={query} announcement={readError ? 'Résultats indisponibles.' : `${totalItems} résultat${totalItems > 1 ? 's' : ''}.`}>
      <h2 className='sr-only' id='deliverer-list-title'>Répertoire des livreurs</h2>
      <div className={styles.toolbar}>
        <form action='/livreurs' className={styles.search} method='get' role='search' key={returnHref}>
          <input name='statut' type='hidden' value={status} />
          <div>
            <label htmlFor='deliverer-search'>Rechercher un livreur</label>
            <div className={styles.searchField}>
              <DelivererIcon name='search' />
              <input defaultValue={query} id='deliverer-search' maxLength={100} name='q' placeholder='Code ou nom du livreur' type='search' />
              <kbd aria-hidden='true'>/</kbd>
            </div>
          </div>
          <button className={styles.primary} type='submit'>Rechercher</button>
        </form>
        <p className={styles.hint}>Répertoire de distribution<br />Coordonnées et accès aux fiches</p>
      </div>
      <div className={styles.statusLine}>
        <nav className={styles.filters} aria-label='Filtrer les livreurs par statut'>
          {[['active', 'Actifs'], ['disabled', 'Désactivés'], ['all', 'Tous']].map(([value, label]) => (
            <Link aria-current={status === value ? 'true' : undefined} href={buildDelivererListHref({ query, status: value })} key={value}>{label}</Link>
          ))}
        </nav>
        <div className={styles.selection}>
          <p className={styles.resultCount} id='deliverer-result-count' tabIndex={-1}>
            {readError ? 'Résultats indisponibles' : <><strong>{totalItems}</strong> résultat{totalItems > 1 ? 's' : ''}</>}
            {query && <> pour « {query} »</>}
          </p>
          {(query || status !== 'active') && <Link href='/livreurs'>Réinitialiser</Link>}
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
            <table className={styles.table}>
              <caption className='sr-only'>Livreurs correspondant à la recherche et au statut sélectionnés</caption>
              <thead><tr><th scope='col'>Livreur</th><th scope='col'>Téléphone</th><th scope='col'>Statut</th><th scope='col'>Accès</th></tr></thead>
              <tbody>{deliverers.map((deliverer) => (
                <tr key={deliverer.id}>
                  <td>
                    <div className={styles.person}>
                      <span className={`${styles.avatar} ${!deliverer.active ? styles.inactiveAvatar : ''}`} aria-hidden='true'>{(deliverer.name || '').trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase('fr')}</span>
                      <div><Link className={styles.name} href={detailHref(deliverer.id)}>{deliverer.name || 'Nom non renseigné'}</Link><code>{deliverer.code || 'Code non renseigné'}</code></div>
                    </div>
                  </td>
                  <td>{deliverer.phone ? <span className={styles.phone}>{deliverer.phone}</span> : <><span className={styles.missing}>Non renseigné</span>{canUpdateDeliverer && <Link className={styles.editPhone} aria-label={`Renseigner le téléphone de ${deliverer.name}`} href={detailHref(deliverer.id, 'identification', true)}>Renseigner</Link>}</>}</td>
                  <td><span className={deliverer.active ? styles.active : styles.inactive}>{deliverer.active ? 'Actif' : 'Désactivé'}</span></td>
                  <td><div className={styles.actions}>
                    {canReadTours && <Link aria-label={`Voir les tournées de ${deliverer.name}`} href={detailHref(deliverer.id, 'tournees')}>Tournées</Link>}
                    <Link className={styles.button} aria-label={`Ouvrir la fiche de ${deliverer.name}`} href={detailHref(deliverer.id)}>Ouvrir <DelivererIcon name='arrow' /></Link>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
            <div className={styles.footer}>
              <p>{firstItem}–{lastItem} sur {totalItems} livreurs</p>
              <nav className={styles.pagination} aria-label='Pagination des livreurs'>
                <PaginationLink disabled={page === 1} href={buildDelivererListHref({ page: page - 1, query, status })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
                <p>Page {page} / {totalPages}</p>
                <PaginationLink disabled={page === totalPages} href={buildDelivererListHref({ page: page + 1, query, status })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
              </nav>
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden='true'><DelivererIcon name='people' /></span>
            <h3>{query ? 'Aucun résultat pour cette recherche' : status === 'active' ? 'Aucun livreur actif' : status === 'disabled' ? 'Aucun livreur désactivé' : 'Aucun livreur à afficher'}</h3>
            <p>{query ? `Aucun code ou nom ne correspond à « ${query} » avec ce statut.` : status === 'active' ? 'Les livreurs actifs apparaîtront ici. Vous pouvez consulter tous les statuts.' : status === 'disabled' ? 'Aucun livreur ne correspond au statut Désactivé.' : 'Le répertoire ne contient aucun livreur.'}</p>
            <div className={styles.emptyActions}>
              {query ? <Link className={styles.button} href='/livreurs'>Réinitialiser la recherche</Link> : status !== 'all' && <Link className={styles.button} href={allHref}>Voir tous les livreurs</Link>}
              {canCreateDeliverer && <Link className={`${styles.button} ${styles.primary}`} href={`/livreurs/nouveau?${new URLSearchParams({ retour: returnHref })}`}>Nouveau livreur</Link>}
            </div>
          </div>
        )}
      </div>
      <p className={styles.caption}>{status === 'disabled' ? 'Un livreur désactivé reste consultable avec son historique. Il ne peut plus recevoir de nouvelle tournée.' : status === 'all' ? 'Actif ou désactivé décrit le statut du livreur. Les tournées et les informations détaillées se consultent dans sa fiche.' : 'Les livreurs actifs sont affichés par défaut. Les coordonnées se modifient dans la fiche du livreur.'}</p>
    </DelivererDirectory>
  );
};

export default DelivererList;
