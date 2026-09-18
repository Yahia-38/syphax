import Link from 'next/link';

import {
  PROFITABILITY_PATHNAME,
  PROFITABILITY_STATUS_FILTERS,
  buildProfitabilityCountingHref,
  buildProfitabilityHref,
} from '../../../lib/profitability-navigation.js';
import {
  PROFITABILITY_TOTAL_STATES,
  areProfitabilityTotalsComplete,
  describeProfitabilityTotal,
  formatProfitabilityCoverage,
  getProfitabilityMarginRate,
  getProfitabilityResultTone,
} from '../../../lib/profitability-presentation.js';
import { formatTourStatus } from '../../../lib/tours.js';
import { Amount, AmountModeProvider, AmountModeToggle, ExactAmountLine } from './profitability-amounts.js';
import ProfitabilityFilters from './profitability-filters.js';
import ProfitabilityTours from './profitability-tours.js';
import styles from './profitability.module.css';

const METRICS = [
  { key: 'sales', label: 'Ventes' },
  { key: 'costOfGoodsSold', label: 'Coût des ventes' },
  { key: 'margin', label: 'Marge brute' },
  { key: 'expenses', label: 'Frais déclarés' },
];

const RESULT_BADGES = {
  COMPLETE: 'Complet',
  EMPTY: 'Aucune tournée',
  OVERFLOW: 'Non calculable',
  PARTIAL: 'Partiel',
  UNKNOWN: 'Aucun résultat connu',
};

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count > 1 ? plural : singular}`;

const formatCountedAt = (value) => value
  ? new Intl.DateTimeFormat('fr-DZ', {
      dateStyle: 'medium',
      hourCycle: 'h23',
      timeStyle: 'short',
      timeZone: 'Africa/Algiers',
    }).format(new Date(value))
  : null;

const formatPeriod = ({ dateFrom, dateTo }) => {
  const format = (value) => new Intl.DateTimeFormat('fr-DZ', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00.000Z`));

  if (dateFrom && dateTo) return dateFrom === dateTo ? `Le ${format(dateFrom)}` : `Du ${format(dateFrom)} au ${format(dateTo)}`;
  if (dateFrom) return `Depuis le ${format(dateFrom)}`;
  if (dateTo) return `Jusqu’au ${format(dateTo)}`;

  return 'Toutes les périodes';
};

const formatRate = (rate) => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 }).format(rate);

const TotalValue = ({ total }) => total.state === PROFITABILITY_TOTAL_STATES.UNKNOWN || total.state === PROFITABILITY_TOTAL_STATES.OVERFLOW
  ? 'Non calculable'
  : <Amount value={total.amountInCentimes} />;

const describeTotalGap = (total) => {
  if (total.state === PROFITABILITY_TOTAL_STATES.PARTIAL) {
    return countLabel(total.unknownCount, 'montant inconnu', 'montants inconnus');
  }

  return total.state === PROFITABILITY_TOTAL_STATES.OVERFLOW
    ? 'Capacité de calcul dépassée : consultez les montants par tournée'
    : null;
};

const ResultCard = ({ total }) => {
  const tone = getProfitabilityResultTone(total);

  return (
    <article className={`${styles.card} ${styles.resultCard} ${styles[`result-${tone}`]}`}>
      <div className={styles.resultTop}>
        <h3>Résultat après frais</h3>
        <span className={styles.badge}>{RESULT_BADGES[total.state]}</span>
      </div>
      <p className={styles.resultValue}><TotalValue total={total} /></p>
      <p className={styles.resultExact}>
        {total.state === PROFITABILITY_TOTAL_STATES.UNKNOWN && 'Aucune tournée de la sélection n’a encore de résultat connu.'}
        {total.state === PROFITABILITY_TOTAL_STATES.OVERFLOW && 'Le total dépasse la capacité de calcul : consultez les montants par tournée.'}
        {total.amountInCentimes !== null && <ExactAmountLine fallback='Marge brute moins frais déclarés' value={total.amountInCentimes} />}
      </p>
      <p className={styles.coverage}>{formatProfitabilityCoverage(total)}</p>
      {total.state === PROFITABILITY_TOTAL_STATES.PARTIAL && (
        <p className={styles.resultWarning}>
          {total.unknownCount > 1
            ? `${total.unknownCount} tournées n’ont pas de résultat connu : ce montant ne couvre que les autres.`
            : '1 tournée n’a pas de résultat connu : ce montant ne couvre que les autres.'}
          {' '}Aucun montant inconnu n’est estimé.
        </p>
      )}
    </article>
  );
};

const Summary = ({ totals }) => {
  const tourCount = totals.counts.tours;
  const rate = getProfitabilityMarginRate(totals);

  return (
    <>
      <section aria-label='Synthèse de toute la sélection' className={styles.summary}>
        <ResultCard total={describeProfitabilityTotal(totals.result, tourCount)} />
        <dl className={styles.metrics}>
          {METRICS.map(({ key, label }) => {
            const total = describeProfitabilityTotal(totals[key], tourCount);
            const partial = total.state !== PROFITABILITY_TOTAL_STATES.COMPLETE && total.state !== PROFITABILITY_TOTAL_STATES.EMPTY;
            const gap = describeTotalGap(total);

            return (
              <div className={`${styles.card} ${styles.metric} ${partial ? styles.partial : ''}`} key={key}>
                <dt>{label}</dt>
                <dd className={styles.metricValue}><TotalValue total={total} /></dd>
                <dd className={styles.coverage}>{formatProfitabilityCoverage(total)}</dd>
                {gap && <dd className={styles.metricNote}>{gap}</dd>}
              </div>
            );
          })}
        </dl>
      </section>
      <div className={styles.formulaStrip}>
        <p>
          {areProfitabilityTotalsComplete(totals)
            ? 'Marge brute = ventes − coût des ventes. Résultat après frais = marge brute − frais déclarés.'
            : 'Les indicateurs partiels peuvent couvrir des tournées différentes : ne soustrayez pas leurs totaux entre eux.'}
        </p>
        {rate !== null && <p className={styles.rate}>Marge brute : {formatRate(rate)} % des ventes</p>}
      </div>
    </>
  );
};

const Notice = ({ counts }) => (
  <div className={styles.notice} role='status'>
    <span aria-hidden='true' className={styles.noticeIcon}>!</span>
    <div>
      <strong>Une partie des données reste à compléter</strong>
      <p>
        {counts.pendingExpenses === 1 && '1 tournée attend sa déclaration de frais : son résultat n’est pas encore connu. '}
        {counts.pendingExpenses > 1 && `${counts.pendingExpenses} tournées attendent leur déclaration de frais : leur résultat n’est pas encore connu. `}
        {counts.incomplete === 1 && '1 tournée porte une donnée manquante ou incohérente, indiquée dans sa ligne. '}
        {counts.incomplete > 1 && `${counts.incomplete} tournées portent une donnée manquante ou incohérente, indiquée dans leur ligne. `}
        Les montants connus restent affichés ; un montant inconnu n’est jamais compté comme zéro.
      </p>
      {counts.incomplete > 0 && <p>Une tournée sans date de comptage fiable reste visible, en tête de liste, et son problème est signalé dans sa ligne.</p>}
    </div>
  </div>
);

const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true' className={styles.disabled}>{children}</span>
  : <Link href={href}>{children}</Link>;

// The current month says it has no counted tour yet; a narrower selection
// offers to widen it.
const Empty = ({ allPeriodsHref, onCurrentMonth, state }) => {
  const narrowed = Boolean((!onCurrentMonth && (state.dateFrom || state.dateTo)) || state.delivererId || state.status || state.query);

  if (narrowed) {
    return (
      <div className={styles.empty}>
        <h3>Aucune tournée pour ces critères</h3>
        <p>Élargissez la période ou retirez un filtre.</p>
        <Link href={PROFITABILITY_PATHNAME}>Réinitialiser les filtres</Link>
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      <h3>{onCurrentMonth ? 'Aucune tournée comptée ce mois-ci' : 'Aucune tournée comptée'}</h3>
      <p>La rentabilité d’une tournée apparaît ici dès que son comptage est enregistré.</p>
      {onCurrentMonth && <Link href={allPeriodsHref}>Voir toutes les périodes</Link>}
    </div>
  );
};

const Method = () => (
  <>
    <details className={`${styles.card} ${styles.method}`}>
      <summary>Comprendre les chiffres et leur périmètre</summary>
      <div className={styles.methodGrid}>
        <div>
          <h3>Ventes et coût des ventes</h3>
          <p>Montants enregistrés au comptage, à partir des prix et des coûts figés au chargement. Les coûts actuels du catalogue ne servent pas à recalculer ces tournées.</p>
        </div>
        <div>
          <h3>Marge et résultat après frais</h3>
          <p>Marge brute = ventes − coût des ventes. Résultat après frais = marge brute − frais déclarés de la tournée. Les versements et les retraits de caisse n’entrent pas dans ce résultat.</p>
        </div>
        <div>
          <h3>Lecture courante et dinars exacts</h3>
          <p>À partir de 10 000 DA, la lecture courante compte en millions : 1 million = 10 000 DA. « Dinars exacts » écrit tous les montants en DA ; les détails d’une tournée les donnent toujours en DA.</p>
        </div>
        <div>
          <h3>Totaux, dates et qualité des données</h3>
          <p>Les totaux couvrent toute la sélection, toutes pages confondues, et n’additionnent que les montants connus. La période porte sur la date de comptage, à l’heure d’Algérie. « Définitif » décrit le calcul de rentabilité ; « Terminée » décrit le statut de la tournée.</p>
        </div>
      </div>
    </details>
    <p className={styles.bottomNote}>Seules les tournées comptées ou terminées sont incluses. Les données inconnues sont signalées ; des frais déclarés à zéro restent un montant connu.</p>
  </>
);

const ProfitabilityReport = ({ currentHref, currentMonth, report, state, today }) => {
  const { delivererOptions, page, pageSize, totalItems, totalPages, totals, tours } = report;
  const href = (changes = {}) => buildProfitabilityHref({ ...state, page, ...changes });
  // The current month is the default period, not a filter.
  const onCurrentMonth = state.dateFrom === currentMonth.dateFrom && state.dateTo === currentMonth.dateTo;
  const filtered = Boolean(!onCurrentMonth || state.delivererId || state.status || state.query);
  const allPeriods = { dateFrom: '', dateTo: '' };
  const shortcuts = [
    { label: 'Aujourd’hui', period: { dateFrom: today, dateTo: today } },
    { label: 'Ce mois', period: currentMonth },
    { label: 'Toutes les périodes', period: allPeriods },
  ].map(({ label, period }) => ({
    active: state.dateFrom === period.dateFrom && state.dateTo === period.dateTo,
    href: href({ ...period, page: 1 }),
    label,
  }));
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + tours.length - 1;
  const selectedDeliverer = delivererOptions.find(({ id }) => id === state.delivererId);
  const { counts } = totals;
  const selection = [
    selectedDeliverer?.name ?? (state.delivererId ? 'Livreur sans tournée comptée' : 'Tous les livreurs'),
    PROFITABILITY_STATUS_FILTERS[state.status]?.label ?? 'Comptées et terminées',
    state.query && `« ${state.query} »`,
  ].filter(Boolean).join(' · ');
  // Rows carry what they show, already written on the server.
  const rows = tours.map((tour) => ({
    costOfGoodsSoldInCentimes: tour.costOfGoodsSoldInCentimes,
    countedAtLabel: formatCountedAt(tour.countedAt),
    countingHref: buildProfitabilityCountingHref({ returnHref: currentHref, tourId: tour.id }),
    delivererCode: tour.deliverer.code,
    delivererName: tour.deliverer.name,
    expenseDeclarationStatus: tour.expenseDeclarationStatus,
    expensesInCentimes: tour.expensesInCentimes,
    id: tour.id,
    issues: tour.issues,
    marginInCentimes: tour.marginInCentimes,
    profitabilityStatus: tour.profitabilityStatus,
    reference: tour.reference,
    resultInCentimes: tour.resultInCentimes,
    salesInCentimes: tour.salesInCentimes,
    statusLabel: formatTourStatus(tour.status),
  }));

  return (
    <AmountModeProvider>
      <ProfitabilityFilters
        delivererOptions={delivererOptions}
        filtered={filtered}
        key={currentHref}
        resetHref={PROFITABILITY_PATHNAME}
        shortcuts={shortcuts}
        state={state}
      />

      <div className={styles.scope}>
        <div>
          <h2>{formatPeriod(state)}</h2>
          <p>{selection}</p>
        </div>
        <AmountModeToggle />
      </div>

      <Summary totals={totals} />

      {(counts.incomplete > 0 || counts.pendingExpenses > 0) && <Notice counts={counts} />}

      <section aria-labelledby='profitability-title' className={`${styles.card} ${styles.tableCard}`}>
        <div className={styles.tableHeading}>
          <div>
            <h2 id='profitability-title'>Détail par tournée</h2>
            <p>{countLabel(totalItems, 'tournée')} · Totaux sur toute la sélection, toutes pages confondues</p>
          </div>
          {counts.tours > 0 && (
            <ul aria-label='États de rentabilité de la sélection' className={styles.counts}>
              <li className={`${styles.badge} ${styles.positive}`}>{countLabel(counts.final, 'définitive')}</li>
              <li className={`${styles.badge} ${styles.warning}`}>{counts.pendingExpenses} frais à déclarer</li>
              <li className={`${styles.badge} ${styles.danger}`}>{countLabel(counts.incomplete, 'incomplète')}</li>
            </ul>
          )}
        </div>

        {rows.length > 0 ? (
          <>
            <ProfitabilityTours caption={`Rentabilité par tournée, page ${page} sur ${totalPages}`} key={currentHref} tours={rows} />
            <div className={styles.footer}>
              <p>{firstItem}–{lastItem} sur {countLabel(totalItems, 'tournée')}{state.query && <> pour « {state.query} »</>}</p>
              {totalPages > 1 && (
                <nav aria-label='Pagination de la rentabilité' className={styles.pagination}>
                  <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
                  <span>Page {page} sur {totalPages}</span>
                  <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
                </nav>
              )}
            </div>
          </>
        ) : (
          <Empty
            allPeriodsHref={buildProfitabilityHref(allPeriods)}
            onCurrentMonth={onCurrentMonth}
            state={state}
          />
        )}
      </section>

      <Method />
    </AmountModeProvider>
  );
};

export default ProfitabilityReport;
