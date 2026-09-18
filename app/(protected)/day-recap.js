import Link from 'next/link';

import {
  DAY_RECAP_FILTERS,
  DAY_RECAP_FINANCIAL_FILTERS,
  DAY_RECAP_STAGES,
  buildDayRecapHref,
  formatDayRecapDate,
  formatDayRecapTime,
  formatDayTourReference,
  shiftDayRecapDate,
} from '../../lib/day-recap.js';
import { formatReceptionMoney } from '../../lib/receptions.js';
import DayAlerts from './day-alerts.js';
import styles from './day-recap.module.css';

const money = (amountInCentimes) => Number.isSafeInteger(amountInCentimes)
  ? formatReceptionMoney(amountInCentimes)
  : 'Non calculable';

const shareFormat = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 });

const share = (value) => `${shareFormat.format(value)} %`;

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count > 1 ? plural : singular}`;

const formatNumericDate = (value) => value.split('-').reverse().join('/');

const STAGE_STATES = Object.freeze({
  done: { mark: '✓', text: 'fait' },
  pending: { mark: '·', text: 'en attente' },
  unavailable: { mark: '—', text: 'indisponible' },
});

const readStageState = (value) => {
  if (value === null) return 'unavailable';

  return value ? 'done' : 'pending';
};

// Four independent markers, not a progression: a closed tour can still owe.
const StageList = ({ stages }) => (
  <ul aria-label='Indicateurs de suivi' className={styles.stageList}>
    {DAY_RECAP_STAGES.map((stage, index) => {
      const state = readStageState(stages[index]);

      return (
        <li className={`${styles.stage} ${styles[state]}`} key={stage.key}>
          <span aria-hidden='true' className={styles.stageDot}>{STAGE_STATES[state].mark}</span>
          <span>{stage.label}<span className='sr-only'> : {STAGE_STATES[state].text}</span></span>
        </li>
      );
    })}
  </ul>
);

const TourLine = ({ tour }) => {
  const { amountInCentimes, label, suffix, tone } = tour.headline;
  const detail = amountInCentimes !== null
    ? suffix
    : tour.loadedAt && `Chargé à ${formatDayRecapTime(tour.loadedAt)}`;

  return (
    <li className={styles.tourLine}>
      <div className={styles.person}>
        <Link href={tour.href}>{tour.deliverer.name}</Link>
        <code>
          <span aria-hidden='true'>{formatDayTourReference(tour.reference)}</span>
          <span className='sr-only'>Tournée {tour.reference}</span>
        </code>
        {tour.deliverer.code && <small>{tour.deliverer.code}</small>}
      </div>
      <StageList stages={tour.stages} />
      <div className={styles.tourState}>
        <span className={`${styles.badge} ${styles[tone]}`}>{label}</span>
        <strong>{amountInCentimes === null ? '—' : money(amountInCentimes)}</strong>
        {detail && <small>{detail}</small>}
      </div>
      <Link aria-label={`Ouvrir la tournée ${tour.reference} de ${tour.deliverer.name}`} className={styles.openTour} href={tour.href}>
        <span aria-hidden='true'>→</span>
      </Link>
    </li>
  );
};

const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true' className={styles.disabled}>{children}</span>
  : <Link href={href}>{children}</Link>;

const FlowEmpty = ({ sortieInCentimes, totalTourCount }) => {
  if (totalTourCount === 0) {
    return 'Aucune tournée n’est prévue à cette date.';
  }

  if (sortieInCentimes === 0) {
    return 'Aucune marchandise valorisée n’est sortie pour ces tournées.';
  }

  return 'La valeur sortie n’est pas calculable : un total dépasse la capacité de calcul.';
};

const Flow = ({ financialsVisible, totalTourCount, totals }) => {
  const barLabel = totals.segments
    .map((segment) => `${segment.label} ${money(segment.amountInCentimes)} (${share(segment.share)})`)
    .join(', ');

  return (
    <section aria-labelledby='day-flow-title' className={`${styles.card} ${styles.dayFlow}`}>
      <div className={styles.flowTop}>
        <div>
          <h2 id='day-flow-title'>Marchandise sortie</h2>
          <p>Valeur de vente figée au chargement · Toute la journée</p>
        </div>
        <strong className={styles.flowValue}>{money(totals.sortieInCentimes)}</strong>
      </div>
      {totals.segments.length > 0 ? (
        <>
          <div aria-label={`Répartition de la valeur de vente sortie : ${barLabel}.`} className={styles.flowBar} role='img'>
            {totals.segments.map((segment) => (
              <span className={styles[segment.key]} key={segment.key} style={{ flexBasis: 0, flexGrow: segment.amountInCentimes }} />
            ))}
          </div>
          <ul className={styles.flowLegend}>
            {totals.segments.map((segment) => (
              <li key={segment.key}>
                <i aria-hidden='true' className={`${styles.swatch} ${styles[segment.key]}`} />
                <span className={styles.legendLabel}>{segment.label}</span>
                <strong>{money(segment.amountInCentimes)}<small>{share(segment.share)}</small></strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.flowEmpty}>
          <FlowEmpty sortieInCentimes={totals.sortieInCentimes} totalTourCount={totalTourCount} />
        </p>
      )}
      <p className={styles.flowNote}>
        {financialsVisible
          ? 'Toute la journée, indépendamment des filtres de la liste. Les versements sont rattachés à leurs tournées, même s’ils ont été enregistrés un autre jour. Les frais retenus ici ne valent pas confirmation que toutes les déclarations sont faites.'
          : 'Toute la journée, indépendamment des filtres de la liste. Le détail des encaissements, restes dus et frais demande les droits Caisse et Frais de tournée.'}
      </p>
    </section>
  );
};

const Cash = ({ cash, date }) => (
  <section aria-labelledby='day-cash-title' className={styles.card}>
    <div className={styles.cashHead}>
      <h2 id='day-cash-title'>Caisse de la journée</h2>
      <p>Mouvements enregistrés le {formatNumericDate(date)}</p>
    </div>
    <dl className={styles.cashFigures}>
      <div>
        <dt>Encaissé ce jour-là</dt>
        <dd>{money(cash.receivedInCentimes)}</dd>
      </div>
      <div>
        <dt>Retraits enregistrés</dt>
        <dd>{money(cash.withdrawnInCentimes)}</dd>
      </div>
    </dl>
    <div className={styles.cashNote}>
      <p>{countLabel(cash.paymentCount, 'versement')} · {countLabel(cash.withdrawalCount, 'retrait')}</p>
      {cash.receivedForOtherToursInCentimes > 0 && (
        <p>Dont {money(cash.receivedForOtherToursInCentimes)} rattachés à des tournées d’autres journées.</p>
      )}
      {!cash.complete && (
        <p className={styles.cashPartial}>Des mouvements incohérents sont exclus : les montants sont partiels.</p>
      )}
      <p>Ces mouvements sont datés de ce jour. Ils peuvent régler des tournées prévues à d’autres dates.</p>
    </div>
    <Link className={styles.cashLink} href='/caisse'>Ouvrir la caisse <span aria-hidden='true'>→</span></Link>
  </section>
);

const DayRecap = ({ alerts, canReadCash, canReadDeliverers, recap }) => {
  const { cash, date, filter, financialsVisible, isToday, page, pageSize, query, tours, totalItems, totalPages, totalTourCount, totals } = recap;
  const { counts } = totals;
  const href = (changes = {}) => buildDayRecapHref({ date, filter, page, query, ...changes });
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + tours.length - 1;
  const filters = Object.entries(DAY_RECAP_FILTERS).filter(
    ([value]) => financialsVisible || !DAY_RECAP_FINANCIAL_FILTERS.includes(value),
  );
  const tourCaption = [
    `${countLabel(counts.deliverers, 'livreur distinct', 'livreurs distincts')} avec une sortie comptabilisée`,
    countLabel(counts.cancelled, 'tournée annulée', 'tournées annulées'),
  ].join(' · ');

  return (
    <>
      <section aria-labelledby='day-recap-title' className={`${styles.card} ${styles.datebar}`}>
        <div>
          <h2 id='day-recap-title'>{isToday && 'Aujourd’hui · '}{formatDayRecapDate(date)}</h2>
          <p>Tournées rattachées à leur date prévue · Heure d’Algérie</p>
        </div>
        <nav aria-label='Changer de journée' className={styles.dayNav}>
          <Link aria-label='Journée précédente' href={href({ date: shiftDayRecapDate(date, -1), page: 1 })}>← Veille</Link>
          <Link aria-label='Journée suivante' href={href({ date: shiftDayRecapDate(date, 1), page: 1 })}>Lendemain →</Link>
          {!isToday && <Link className={styles.today} href={href({ date: '', page: 1 })}>Aujourd’hui</Link>}
          <form action='/' className={styles.dayForm} key={date} method='get'>
            <div>
              <label htmlFor='day-recap-date'>Journée à consulter</label>
              <input defaultValue={date} id='day-recap-date' max='9999-12-31' min='1000-01-01' name='jour' required type='date' />
            </div>
            {filter && <input name='jourEtat' type='hidden' value={filter} />}
            {query && <input name='jourRecherche' type='hidden' value={query} />}
            <button className={styles.primary} type='submit'>Voir</button>
          </form>
        </nav>
      </section>

      <dl className={styles.kpis}>
        <div className={`${styles.card} ${styles.kpi}`}>
          <dt>Tournées prévues</dt>
          <dd>{totalTourCount}</dd>
          <p>Tous les états, y compris annulées</p>
        </div>
        <div className={`${styles.card} ${styles.kpi} ${styles.kpiBlue}`}>
          <dt>En tournée</dt>
          <dd>{counts.onTour}</dd>
          <p>Chargées, pas encore comptées</p>
        </div>
        <div className={`${styles.card} ${styles.kpi} ${styles.kpiGreen}`}>
          <dt>Rentrées</dt>
          <dd>{counts.returned}</dd>
          <p>Comptées ou terminées</p>
        </div>
        <div className={`${styles.card} ${styles.kpi} ${styles.kpiAmber}`}>
          <dt>En préparation</dt>
          <dd>{counts.preparation}</dd>
          <p>Chargement à valider</p>
        </div>
      </dl>

      {!totals.complete && (
        <div className={styles.notice} role='status'>
          <span aria-hidden='true' className={styles.noticeIcon}>!</span>
          <div>
            <strong>Récapitulatif partiel</strong>
            <p>Les tournées avec des données incohérentes sont exclues des totaux de valeur et de certains compteurs. Consultez « À traiter » pour les retrouver.</p>
          </div>
        </div>
      )}

      <Flow financialsVisible={financialsVisible} totalTourCount={totalTourCount} totals={totals} />

      <div className={styles.dashboardGrid}>
        <section aria-labelledby='day-tours-title' className={`${styles.card} ${styles.tourCard}`}>
          <div className={styles.tourHead}>
            <div>
              <h2 id='day-tours-title'>Tournées du jour</h2>
              <p>{tourCaption}</p>
            </div>
            <span className={styles.badge}>{countLabel(counts.closed, 'terminée')}</span>
          </div>
          <nav aria-label='Filtrer les tournées de la journée' className={styles.tourFilters}>
            {filters.map(([value, label]) => (
              <Link aria-current={filter === value ? 'true' : undefined} href={href({ filter: value, page: 1 })} key={value || 'toutes'}>{label}</Link>
            ))}
          </nav>
          <form action='/' className={styles.tourSearch} key={`${date}-${filter}-${query}`} method='get' role='search'>
            <input name='jour' type='hidden' value={date} />
            {filter && <input name='jourEtat' type='hidden' value={filter} />}
            <div>
              <label htmlFor='day-recap-search'>Rechercher une tournée</label>
              <input defaultValue={query} id='day-recap-search' maxLength={100} name='jourRecherche' placeholder='Livreur, code ou référence' type='search' />
            </div>
            <button type='submit'>Rechercher</button>
            {(query || filter) && <Link className={styles.clearLink} href={href({ filter: '', page: 1, query: '' })}>Effacer</Link>}
          </form>

          {tours.length > 0 ? (
            <>
              <div aria-hidden='true' className={styles.tourColumns}>
                <span>Livreur / tournée</span>
                <span>Suivi</span>
                <span>État actuel</span>
                <span />
              </div>
              <ul className={styles.tourLines}>
                {tours.map((tour) => <TourLine key={tour.id} tour={tour} />)}
              </ul>
            </>
          ) : (
            <div className={styles.empty}>
              <h3>{totalTourCount === 0 ? 'Aucune tournée ce jour-là' : 'Aucune tournée pour ces critères'}</h3>
              <p>
                {totalTourCount === 0
                  ? 'Les tournées apparaissent ici à leur date prévue.'
                  : `${countLabel(totalTourCount, 'tournée')} ${totalTourCount > 1 ? 'sont prévues' : 'est prévue'} ce jour. Retirez un filtre ou modifiez la recherche.`}
              </p>
              {totalTourCount > 0 && <Link className={styles.plainButton} href={href({ filter: '', page: 1, query: '' })}>Réinitialiser les filtres</Link>}
              {totalTourCount === 0 && canReadDeliverers && <Link className={styles.buttonLink} href='/livreurs'>Voir les livreurs <span aria-hidden='true'>→</span></Link>}
            </div>
          )}

          <p className={styles.tableHelp}>Chargé · Rentré · Réglé · Terminée : ces indicateurs sont indépendants. « — » signifie indisponible, pas impayé.</p>
          <footer className={styles.footer}>
            <p role='status'>{totalItems > 0 ? `${firstItem}–${lastItem} sur ${countLabel(totalItems, 'tournée')}` : '0 tournée'}</p>
            <nav aria-label='Pagination des tournées de la journée' className={styles.pagination}>
              <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
              <span>Page {page} sur {totalPages}</span>
              <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
            </nav>
          </footer>
        </section>

        <aside aria-label='Suivi de la journée' className={styles.sideStack}>
          <DayAlerts alerts={alerts} key={date} />
          {canReadCash && cash && <Cash cash={cash} date={date} />}
        </aside>
      </div>

      <details className={`${styles.card} ${styles.method}`}>
        <summary>Comprendre le récapitulatif</summary>
        <div className={styles.methodGrid}>
          <div>
            <h3>Quelle journée ?</h3>
            <p>Les tournées sont regroupées par date prévue, à l’heure d’Algérie. Une même journée peut compter plusieurs tournées par livreur. Les états affichés sont les états actuels connus, même en consultant une date passée.</p>
          </div>
          <div>
            <h3>Quelle valeur ?</h3>
            <p>La valeur de vente des marchandises est figée au chargement. Elle se répartit entre marchandise en tournée, retours, sommes encaissées, reste dû et frais pris en compte, selon vos droits. Ce n’est pas un calcul de marge.</p>
          </div>
          <div>
            <h3>Quels filtres ?</h3>
            <p>La recherche et les filtres de tournées concernent uniquement la liste. Les compteurs, la répartition, les points à traiter et la caisse gardent leur périmètre de journée entière.</p>
          </div>
          <div>
            <h3>Quels encaissements ?</h3>
            <p>La répartition suit les versements rattachés aux tournées prévues ce jour-là, quelle que soit leur date d’encaissement. La carte Caisse suit les mouvements enregistrés à la date sélectionnée. Elle ne représente pas le solde actuel de la caisse.</p>
          </div>
        </div>
      </details>
      <p className={styles.bottomNote}>Montants en DA. Ouvrez une tournée pour consulter son comptage et les opérations autorisées.</p>
    </>
  );
};

export default DayRecap;
