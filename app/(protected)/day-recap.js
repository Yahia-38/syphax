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
import styles from './day-recap.module.css';

const money = (amountInCentimes) => Number.isSafeInteger(amountInCentimes)
  ? formatReceptionMoney(amountInCentimes)
  : 'Non calculable';

const share = (value) => `${value < 1 ? value.toFixed(1) : Math.round(value)} %`;

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count > 1 ? plural : singular}`;

const buildSummarySentence = ({ counts, isToday }) => {
  const parts = [];

  if (counts.shipped > 0) {
    parts.push(`${countLabel(counts.deliverers, 'livreur')} ${counts.deliverers > 1 ? 'sortis' : 'sorti'}`);
  }

  if (counts.returned > 0) {
    parts.push(`${counts.returned} ${counts.returned > 1 ? 'rentrés' : 'rentré'}`);
  }

  if (counts.onTour > 0) {
    parts.push(`${counts.onTour} ${isToday ? 'encore ' : ''}en tournée`);
  }

  if (counts.preparation > 0) {
    parts.push(`${counts.preparation} en préparation`);
  }

  if (counts.cancelled > 0) {
    parts.push(`${countLabel(counts.cancelled, 'annulée')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Aucune tournée sur cette journée.';
};

const StageTrack = ({ stages }) => (
  <div>
    <div className={styles.track} aria-hidden='true'>
      {DAY_RECAP_STAGES.map((stage, index) => (
        <span
          className={`${styles.step} ${stages[index] ? styles.done : ''} ${stages[index] === null ? styles.pendingStep : ''}`}
          key={stage.key}
        >
          <span className={styles.dot} />
          {index < DAY_RECAP_STAGES.length - 1 && <span className={styles.link} />}
        </span>
      ))}
    </div>
    <p className={styles.trackLabels} aria-hidden='true'>
      {DAY_RECAP_STAGES.map((stage) => <span key={stage.key}>{stage.label}</span>)}
    </p>
    <p className='sr-only'>
      {DAY_RECAP_STAGES.map((stage, index) => `${stage.label} : ${stages[index] === null ? 'indisponible' : stages[index] ? 'fait' : 'en attente'}`).join('. ')}.
    </p>
  </div>
);

const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true' className={styles.disabled}>{children}</span>
  : <Link href={href}>{children}</Link>;

const DayRecap = ({ recap, canReadCash }) => {
  const { alerts, cash, date, filter, financialsVisible, isToday, page, pageSize, query, tours, totalItems, totalPages, totalTourCount, totals } = recap;
  const href = (changes = {}) => buildDayRecapHref({ date, filter, page, query, ...changes });
  const previousDate = shiftDayRecapDate(date, -1);
  const nextDate = shiftDayRecapDate(date, 1);
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + tours.length - 1;
  const filters = Object.entries(DAY_RECAP_FILTERS).filter(
    ([value]) => financialsVisible || !DAY_RECAP_FINANCIAL_FILTERS.includes(value),
  );
  const barLabel = totals.segments
    .map((segment) => `${segment.label} ${money(segment.amountInCentimes)}`)
    .join(', ');

  return (
    <section className={styles.recap} aria-labelledby='day-recap-title'>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Récap de la journée</p>
          <h2 id='day-recap-title'>{formatDayRecapDate(date)}</h2>
          <p className={styles.headline}>
            <strong>{buildSummarySentence({ counts: totals.counts, isToday })}</strong>
          </p>
        </div>
        <nav className={styles.dayNav} aria-label='Changer de journée'>
          <Link aria-label='Journée précédente' href={href({ date: previousDate, page: 1 })}>← Veille</Link>
          <form action='/' className={styles.dayForm} key={date} method='get' role='search'>
            <label className='sr-only' htmlFor='day-recap-date'>Journée à consulter</label>
            <input defaultValue={date} id='day-recap-date' max='9999-12-31' min='1000-01-01' name='jour' required type='date' />
            {filter && <input name='jourEtat' type='hidden' value={filter} />}
            {query && <input name='jourRecherche' type='hidden' value={query} />}
            <button type='submit'>Voir</button>
          </form>
          <Link aria-label='Journée suivante' href={href({ date: nextDate, page: 1 })}>Lendemain →</Link>
          {!isToday && <Link className={styles.today} href={href({ date: '', page: 1 })}>Aujourd’hui</Link>}
        </nav>
      </header>

      {totalTourCount > 0 && <>
      <div className={styles.flow}>
        <div className={styles.flowHead}>
          <p>Marchandise sortie</p>
          <p className={styles.flowTotal}>{money(totals.sortieInCentimes)}</p>
        </div>
        {totals.segments.length > 0 ? (
          <>
            <div className={styles.bar} role='img' aria-label={`Répartition de la marchandise sortie : ${barLabel}.`}>
              {totals.segments.map((segment) => (
                <span className={styles[segment.key]} key={segment.key} style={{ flexBasis: 0, flexGrow: segment.amountInCentimes }} />
              ))}
            </div>
            <ul className={styles.legend}>
              {totals.segments.map((segment) => (
                <li key={segment.key}>
                  <i aria-hidden='true' className={styles[segment.key]} />
                  {segment.label} <strong>{money(segment.amountInCentimes)}</strong>
                  <small>{share(segment.share)}</small>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.flowEmpty}>
            {totalTourCount === 0
              ? 'Aucune tournée n’a été enregistrée sur cette journée.'
              : 'Aucune marchandise valorisée n’est sortie sur cette journée.'}
          </p>
        )}
        <p className={styles.flowNote}>
          {financialsVisible
            ? 'Valeur de vente figée au chargement. Les retours reviennent en stock ; le reste devient encaissé, dû ou déduit en frais. Les totaux couvrent toute la journée, sans tenir compte du filtre ci-dessous.'
            : 'Valeur de vente figée au chargement. Les montants encaissés et les frais demandent les droits Caisse et Frais de tournée.'}
        </p>
      </div>

      {!totals.complete && (
        <div className={styles.notice} role='alert'>
          <strong>Le récapitulatif de la journée est partiel.</strong>
          Certaines tournées portent des données incohérentes et sont exclues des totaux. Elles sont listées dans « À traiter ».
        </div>
      )}

      <div className={styles.toolbar}>
        <nav aria-label='Filtrer les tournées de la journée' className={styles.filters}>
          {filters.map(([value, label]) => (
            <Link aria-current={filter === value ? 'true' : undefined} href={href({ filter: value, page: 1 })} key={value || 'toutes'}>{label}</Link>
          ))}
        </nav>
        <form action='/' className={styles.search} key={`${date}-${filter}-${query}`} method='get' role='search'>
          <input name='jour' type='hidden' value={date} />
          {filter && <input name='jourEtat' type='hidden' value={filter} />}
          <div>
            <label htmlFor='day-recap-search'>Rechercher</label>
            <input defaultValue={query} id='day-recap-search' maxLength={100} name='jourRecherche' placeholder='Livreur ou référence' type='search' />
          </div>
          <button type='submit'>Rechercher</button>
        </form>
      </div>
      </>}

      {tours.length > 0 ? (
        <>
          <div aria-hidden='true' className={styles.columns}>
            <p>Livreur</p>
            <p className={styles.columnStages}>
              {DAY_RECAP_STAGES.map((stage) => <span key={stage.key}>{stage.label}</span>)}
            </p>
            <p>État</p>
            <p />
          </div>
          <ul className={styles.rows}>
            {tours.map((tour) => (
              <li className={styles.row} key={tour.id}>
                <div className={styles.person}>
                  <Link href={tour.href}>{tour.deliverer.name}</Link>
                  <code title={tour.reference}>{formatDayTourReference(tour.reference)}</code>
                </div>
                <StageTrack stages={tour.stages} />
                <div className={styles.state}>
                  <span className={`${styles.stateLabel} ${styles[tour.headline.tone]}`}>{tour.headline.label}</span>
                  <p className={styles.stateAmount}>
                    {tour.headline.amountInCentimes === null ? '—' : money(tour.headline.amountInCentimes)}
                    {tour.headline.suffix && tour.headline.amountInCentimes !== null && <small>{tour.headline.suffix}</small>}
                    {tour.headline.amountInCentimes === null && tour.loadedAt && <small>Chargé à {formatDayRecapTime(tour.loadedAt)}</small>}
                  </p>
                </div>
                <Link aria-label={`Ouvrir la tournée ${tour.reference} de ${tour.deliverer.name}`} className={styles.open} href={tour.href}>
                  Ouvrir <span aria-hidden='true'>→</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={styles.footer}>
            <p>{firstItem}–{lastItem} sur {countLabel(totalItems, 'tournée')}{query && <> pour « {query} »</>}</p>
            <nav aria-label='Pagination des tournées de la journée' className={styles.pagination}>
              <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
              <span>Page {page} / {totalPages}</span>
              <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
            </nav>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <h3>{totalTourCount === 0 ? 'Aucune tournée ce jour-là' : 'Aucune tournée pour ces critères'}</h3>
          <p>
            {totalTourCount === 0
              ? 'Aucune marchandise n’est sortie. Créez une tournée depuis la fiche d’un livreur pour la voir apparaître ici.'
              : `${countLabel(totalTourCount, 'tournée')} sur cette journée, mais aucune ne correspond à la recherche ou au filtre.`}
          </p>
          {totalTourCount > 0 && <Link href={href({ filter: '', page: 1, query: '' })}>Réinitialiser les filtres</Link>}
        </div>
      )}

      {alerts.length > 0 ? (
        <div className={styles.attention}>
          <div className={styles.attentionHead}>
            <h3>À traiter</h3>
            <p>{countLabel(alerts.length, 'point')} sur cette journée</p>
          </div>
          <ul className={styles.attentionList}>
            {alerts.map((alert) => (
              <li key={`${alert.code}-${alert.tourReference}`}>
                <span aria-hidden='true' className={styles.bullet}>•</span>
                <strong>{alert.deliverer}</strong> — {alert.label}
                <Link aria-label={`Ouvrir la tournée ${alert.tourReference} de ${alert.deliverer}`} href={alert.href} title={alert.tourReference}>
                  {formatDayTourReference(alert.tourReference)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : totalTourCount > 0 && (
        <p className={styles.clear}>Rien à traiter sur cette journée.</p>
      )}

      {canReadCash && cash && (
        <dl className={styles.cash}>
          <div>
            <dt>Encaissé en caisse</dt>
            <dd>{money(cash.receivedInCentimes)}</dd>
          </div>
          <div>
            <dt>Retraits</dt>
            <dd>{money(cash.withdrawnInCentimes)}</dd>
          </div>
          <Link href='/caisse'>Ouvrir la caisse →</Link>
          <p className={styles.cashNote}>
            {countLabel(cash.paymentCount, 'versement')} et {countLabel(cash.withdrawalCount, 'retrait')} enregistrés ce jour-là, à l’heure d’Algérie.
            {cash.receivedForOtherToursInCentimes > 0 && ` Dont ${money(cash.receivedForOtherToursInCentimes)} soldant des tournées d’autres journées.`}
            {!cash.complete && ' Des mouvements incohérents sont exclus de ces totaux.'}
          </p>
        </dl>
      )}

      <p className={styles.footnote}>
        Les tournées sont rattachées à leur date prévue, à l’heure d’Algérie. Une même journée peut compter plusieurs tournées par livreur.
      </p>
    </section>
  );
};

export default DayRecap;
