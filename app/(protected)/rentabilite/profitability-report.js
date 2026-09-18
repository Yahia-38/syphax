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

const TOTAL_GAPS = {
  OVERFLOW: () => 'Capacité numérique dépassée',
  PARTIAL: ({ unknownCount }) => countLabel(unknownCount, 'montant inconnu', 'montants inconnus'),
  UNKNOWN: () => 'Aucun montant connu',
};

const RESULT_WARNINGS = {
  OVERFLOW: () => 'Le total dépasse la capacité numérique de calcul. Consultez les montants individuels.',
  PARTIAL: ({ unknownCount }) => `${countLabel(unknownCount, 'tournée')} sans résultat calculable. Ce montant couvre uniquement les autres tournées.`,
  UNKNOWN: () => 'Aucun résultat ne peut être calculé pour cette sélection.',
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
        {total.state === PROFITABILITY_TOTAL_STATES.UNKNOWN
          ? 'Les données nécessaires ne sont pas toutes disponibles.'
          : <ExactAmountLine fallback='Marge brute moins frais déclarés' value={total.amountInCentimes} />}
      </p>
      <p className={styles.coverage}>{formatProfitabilityCoverage(total)}</p>
      {RESULT_WARNINGS[total.state] && <p className={styles.resultWarning}>{RESULT_WARNINGS[total.state](total)}</p>}
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
            const gap = TOTAL_GAPS[total.state]?.(total);

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
            ? 'Résultat après frais = ventes − coût des ventes − frais déclarés.'
            : 'Les indicateurs partiels peuvent couvrir des tournées différentes : ne soustrayez pas leurs totaux entre eux.'}
        </p>
        <p className={styles.rate}>{rate === null ? 'Marge brute = ventes − coût des ventes' : `Marge brute : ${formatRate(rate)} % des ventes`}</p>
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
        {countLabel(counts.pendingExpenses, 'tournée')} {counts.pendingExpenses > 1 ? 'attendent' : 'attend'} une déclaration de frais ;
        {' '}{countLabel(counts.incomplete, 'tournée')} {counts.incomplete > 1 ? 'ont' : 'a'} des données manquantes ou incohérentes.
        {' '}Un montant inconnu n’est jamais assimilé à zéro.
      </p>
      {counts.incomplete > 0 && <p>Les tournées sans date de comptage fiable restent visibles et sont signalées dans leur ligne.</p>}
    </div>
  </div>
);

const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true' className={styles.disabled}>{children}</span>
  : <Link href={href}>{children}</Link>;

// The default selection says it has no counted tour yet; any other offers to
// go back to it.
const Empty = ({ allPeriodsHref, filtered }) => filtered ? (
  <div className={styles.empty}>
    <h3>Aucune tournée pour ces critères</h3>
    <p>Élargissez la période ou retirez un filtre.</p>
    <Link href={PROFITABILITY_PATHNAME}>Réinitialiser les filtres</Link>
  </div>
) : (
  <div className={styles.empty}>
    <h3>Aucune tournée comptée ce mois-ci</h3>
    <p>La rentabilité apparaît ici dès que le comptage est enregistré.</p>
    <Link href={allPeriodsHref}>Voir toutes les périodes</Link>
  </div>
);

const Method = () => (
  <>
    <details className={`${styles.card} ${styles.method}`}>
      <summary>Comprendre les chiffres et leur périmètre</summary>
      <div className={styles.methodGrid}>
        <div>
          <h3>Ventes et coût des ventes</h3>
          <p>Montants enregistrés au comptage, à partir des prix et coûts figés lors du chargement. Les coûts actuels du catalogue ne sont pas utilisés pour recalculer ces tournées.</p>
        </div>
        <div>
          <h3>Marge et résultat après frais</h3>
          <p>Marge brute = ventes − coût des ventes. Résultat après frais = marge brute − frais déclarés de la tournée. Les versements et retraits de caisse n’entrent pas dans ce calcul.</p>
        </div>
        <div>
          <h3>Lecture courante et dinars exacts</h3>
          <p>À partir de 10 000 DA, la lecture courante utilise les millions : 1 million = 10 000 DA. Le bouton « Dinars exacts » affiche les montants en DA. Les détails d’une ligne les présentent aussi en DA.</p>
        </div>
        <div>
          <h3>Date et qualité des données</h3>
          <p>La période porte sur la date de comptage, à l’heure d’Algérie. Une tournée sans date fiable reste visible. « Définitif » décrit le calcul de rentabilité ; « Terminée » décrit le statut de la tournée.</p>
        </div>
      </div>
    </details>
    <p className={styles.bottomNote}>Seules les tournées comptées ou terminées sont incluses. Les données inconnues sont signalées ; les déclarations de frais à zéro restent des montants connus.</p>
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
          <ul aria-label='États de rentabilité de la sélection' className={styles.counts}>
            <li className={`${styles.badge} ${styles.positive}`}>{countLabel(counts.final, 'définitive')}</li>
            <li className={`${styles.badge} ${styles.warning}`}>{counts.pendingExpenses} frais à déclarer</li>
            <li className={`${styles.badge} ${styles.danger}`}>{countLabel(counts.incomplete, 'incomplète')}</li>
          </ul>
        </div>

        {rows.length > 0
          ? <ProfitabilityTours caption='Ventes, coûts, marge, frais et résultat des tournées de la page' key={currentHref} tours={rows} />
          : <Empty allPeriodsHref={buildProfitabilityHref(allPeriods)} filtered={filtered} />}
        <div className={styles.footer}>
          <p>{totalItems > 0 ? `${firstItem}–${lastItem} sur ${countLabel(totalItems, 'tournée')}` : '0 tournée'}</p>
          <nav aria-label='Pagination de la rentabilité' className={styles.pagination}>
            <PaginationLink disabled={page <= 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
            <span>Page {page} sur {totalPages}</span>
            <PaginationLink disabled={page >= totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
          </nav>
        </div>
      </section>

      <Method />
    </AmountModeProvider>
  );
};

export default ProfitabilityReport;
