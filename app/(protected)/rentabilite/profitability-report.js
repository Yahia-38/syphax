import Link from 'next/link';

import {
  PROFITABILITY_PATHNAME,
  PROFITABILITY_STATUS_FILTERS,
  buildProfitabilityCountingHref,
  buildProfitabilityHref,
} from '../../../lib/profitability-navigation.js';
import { formatReceptionMoney } from '../../../lib/receptions.js';
import { formatTourStatus } from '../../../lib/tours.js';
import styles from './profitability.module.css';

const INDICATORS = [
  { key: 'sales', label: 'Ventes', hint: 'Prix de vente figés au chargement' },
  { key: 'costOfGoodsSold', label: 'Coût des ventes', hint: 'Coût d’achat des quantités vendues' },
  { key: 'margin', label: 'Marge brute', hint: 'Ventes moins coût des ventes' },
  { key: 'expenses', label: 'Frais déclarés', hint: 'Frais de tournée déclarés' },
  { key: 'result', label: 'Résultat après frais', hint: 'Marge brute moins frais', emphasis: true },
];

const PROFITABILITY_STATES = {
  FINAL: { label: 'Définitif', tone: 'positive' },
  PENDING_EXPENSES: { label: 'Frais à déclarer', tone: 'warning' },
  INCOMPLETE: { label: 'Incomplet', tone: 'danger' },
};

// Expenses that are not a known amount still say why.
const EXPENSE_STATES = {
  MISSING: 'À déclarer',
  HISTORICAL_MISSING: 'Jamais déclarés',
  INVALID: 'Incohérents',
};

// Margins and results can be negative: the sign is kept, never hidden.
const money = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) return null;

  return amountInCentimes < 0
    ? `−${formatReceptionMoney(-amountInCentimes)}`
    : formatReceptionMoney(amountInCentimes);
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

  return 'Toutes périodes';
};

const describeTotal = ({ amountInCentimes, complete, unknownCount }, hint) => {
  if (complete) return hint;
  if (amountInCentimes === null && unknownCount === 0) return 'Total trop élevé pour être calculé';

  return `Partiel · ${countLabel(unknownCount, 'tournée non calculable', 'tournées non calculables')}`;
};

const marginRate = ({ margin, sales }) => margin.complete && sales.complete && sales.amountInCentimes > 0
  ? `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 }).format((margin.amountInCentimes / sales.amountInCentimes) * 100)} % des ventes`
  : null;

const Amount = ({ value }) => {
  const formatted = money(value);

  return formatted
    ? <span className={value < 0 ? styles.negative : undefined}>{formatted}</span>
    : <span className={styles.unknown}>Inconnu</span>;
};

const Expenses = ({ tour }) => tour.expenseDeclarationStatus === 'DECLARED'
  ? <Amount value={tour.expensesInCentimes} />
  : <span className={styles.unknown}>{EXPENSE_STATES[tour.expenseDeclarationStatus] ?? 'Inconnus'}</span>;

const PaginationLink = ({ children, disabled, href }) => disabled
  ? <span aria-disabled='true' className={styles.disabled}>{children}</span>
  : <Link href={href}>{children}</Link>;

const ProfitabilityReport = ({ currentHref, currentMonth, report, state }) => {
  const { delivererOptions, page, pageSize, totalItems, totalPages, totals, tours } = report;
  const href = (changes = {}) => buildProfitabilityHref({ ...state, page, ...changes });
  // The current month is the default period, not a filter.
  const onCurrentMonth = state.dateFrom === currentMonth.dateFrom && state.dateTo === currentMonth.dateTo;
  const filtered = Boolean(!onCurrentMonth || state.delivererId || state.status || state.query);
  const resetHref = PROFITABILITY_PATHNAME;
  const firstItem = totalItems > 0 ? (page - 1) * pageSize + 1 : 0;
  const lastItem = firstItem + tours.length - 1;
  const selectedDeliverer = delivererOptions.find(({ id }) => id === state.delivererId);
  const rate = marginRate(totals);
  const { counts } = totals;

  return (
    <section className={styles.report} aria-labelledby='profitability-title'>
      <form action='/rentabilite' className={styles.filters} key={currentHref} method='get' role='search' aria-label='Filtrer les tournées'>
        <div className={styles.period}>
          <div>
            <label htmlFor='profitability-from'>Comptées du</label>
            <input defaultValue={state.dateFrom} id='profitability-from' max='9999-12-31' min='1000-01-01' name='du' type='date' />
          </div>
          <div>
            <label htmlFor='profitability-to'>au</label>
            <input defaultValue={state.dateTo} id='profitability-to' max='9999-12-31' min='1000-01-01' name='au' type='date' />
          </div>
        </div>
        <div>
          <label htmlFor='profitability-deliverer'>Livreur</label>
          <select defaultValue={state.delivererId} id='profitability-deliverer' name='livreur'>
            <option value=''>Tous les livreurs</option>
            {state.delivererId && !selectedDeliverer && <option value={state.delivererId}>Livreur sans tournée comptée</option>}
            {delivererOptions.map((deliverer) => (
              <option key={deliverer.id} value={deliverer.id}>{deliverer.name}{deliverer.code && ` · ${deliverer.code}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor='profitability-status'>Tournées</label>
          <select defaultValue={state.status} id='profitability-status' name='statut'>
            <option value=''>Comptées et terminées</option>
            {Object.entries(PROFITABILITY_STATUS_FILTERS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.search}>
          <label htmlFor='profitability-search'>Rechercher</label>
          <input defaultValue={state.query} id='profitability-search' maxLength={100} name='q' placeholder='Référence ou livreur' type='search' />
        </div>
        <div className={styles.actions}>
          <button type='submit'>Filtrer</button>
          {filtered && <Link href={resetHref}>Réinitialiser</Link>}
        </div>
      </form>

      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>{formatPeriod(state)}{selectedDeliverer && ` · ${selectedDeliverer.name}`}</p>
          <h2 id='profitability-title'>{countLabel(counts.tours, 'tournée comptée', 'tournées comptées')}</h2>
        </div>
        {counts.tours > 0 && (
          <ul className={styles.counts} aria-label='Répartition des tournées'>
            <li><i aria-hidden='true' className={styles.positive} />{countLabel(counts.final, 'définitive')}</li>
            <li><i aria-hidden='true' className={styles.warning} />{counts.pendingExpenses} frais à déclarer</li>
            <li><i aria-hidden='true' className={styles.danger} />{countLabel(counts.incomplete, 'incomplète')}</li>
          </ul>
        )}
      </header>

      <dl className={styles.indicators}>
        {INDICATORS.map(({ emphasis, hint, key, label }) => {
          const total = totals[key];
          const formatted = money(total.amountInCentimes);

          return (
            <div className={`${styles.indicator} ${emphasis ? styles.emphasis : ''} ${total.complete ? '' : styles.partial}`} key={key}>
              <dt>{label}</dt>
              <dd className={`${styles.indicatorValue} ${total.amountInCentimes < 0 ? styles.negative : ''}`}>
                {formatted ?? 'Non calculable'}
              </dd>
              <dd className={styles.indicatorHint}>
                {key === 'margin' && rate ? rate : describeTotal(total, hint)}
              </dd>
            </div>
          );
        })}
      </dl>

      {(counts.incomplete > 0 || counts.pendingExpenses > 0) && (
        <div className={styles.notice} role='status'>
          <strong>Les totaux ne couvrent que les montants connus.</strong>
          {counts.pendingExpenses === 1 && ' 1 tournée attend sa déclaration de frais : son résultat n’est pas encore connu.'}
          {counts.pendingExpenses > 1 && ` ${counts.pendingExpenses} tournées attendent leur déclaration de frais : leur résultat n’est pas encore connu.`}
          {counts.incomplete === 1 && ' 1 tournée porte une donnée manquante ou incohérente, indiquée dans sa ligne.'}
          {counts.incomplete > 1 && ` ${counts.incomplete} tournées portent une donnée manquante ou incohérente, indiquée dans leur ligne.`}
          {' '}Aucun montant inconnu n’est compté comme zéro.
        </div>
      )}

      {tours.length > 0 ? (
        <>
          <table className={styles.table}>
            <caption className='sr-only'>Rentabilité par tournée, page {page} sur {totalPages}</caption>
            <thead>
              <tr>
                <th scope='col'>Tournée</th>
                <th scope='col'>Comptée le</th>
                <th className={styles.numeric} scope='col'>Ventes</th>
                <th className={styles.numeric} scope='col'>Coût des ventes</th>
                <th className={styles.numeric} scope='col'>Marge</th>
                <th className={styles.numeric} scope='col'>Frais</th>
                <th className={styles.numeric} scope='col'>Résultat</th>
                <th scope='col'>État</th>
                <th scope='col'><span className='sr-only'>Comptage</span></th>
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => {
                const countingHref = buildProfitabilityCountingHref({ returnHref: currentHref, tourId: tour.id });
                const profitabilityState = PROFITABILITY_STATES[tour.profitabilityStatus] ?? PROFITABILITY_STATES.INCOMPLETE;

                return (
                  <tr key={tour.id}>
                    <th className={styles.tour} scope='row'>
                      <Link href={countingHref}>{tour.reference}</Link>
                      <span>{tour.deliverer.name}{tour.deliverer.code && ` · ${tour.deliverer.code}`}</span>
                      <small>{formatTourStatus(tour.status)}</small>
                    </th>
                    <td data-label='Comptée le'>{formatCountedAt(tour.countedAt) ?? <span className={styles.unknown}>Date inconnue</span>}</td>
                    <td className={styles.numeric} data-label='Ventes'><Amount value={tour.salesInCentimes} /></td>
                    <td className={styles.numeric} data-label='Coût des ventes'><Amount value={tour.costOfGoodsSoldInCentimes} /></td>
                    <td className={styles.numeric} data-label='Marge'><Amount value={tour.marginInCentimes} /></td>
                    <td className={styles.numeric} data-label='Frais'><Expenses tour={tour} /></td>
                    <td className={`${styles.numeric} ${styles.result}`} data-label='Résultat'><Amount value={tour.resultInCentimes} /></td>
                    <td className={styles.state} data-label='État'>
                      <span className={`${styles.badge} ${styles[profitabilityState.tone]}`}>{profitabilityState.label}</span>
                      {tour.issues.length > 0 && <ul>{tour.issues.map((issue) => <li key={issue.code}>{issue.label}</li>)}</ul>}
                    </td>
                    <td className={styles.open}>
                      <Link aria-label={`Voir le comptage de la tournée ${tour.reference}`} href={countingHref}>
                        Comptage <span aria-hidden='true'>→</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.footer}>
            <p>{firstItem}–{lastItem} sur {countLabel(totalItems, 'tournée')}{state.query && <> pour « {state.query} »</>}</p>
            {totalPages > 1 && (
              <nav aria-label='Pagination de la rentabilité' className={styles.pagination}>
                <PaginationLink disabled={page === 1} href={href({ page: page - 1 })}><span aria-hidden='true'>←</span> Précédent</PaginationLink>
                <span>Page {page} / {totalPages}</span>
                <PaginationLink disabled={page === totalPages} href={href({ page: page + 1 })}>Suivant <span aria-hidden='true'>→</span></PaginationLink>
              </nav>
            )}
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <h3>{filtered ? 'Aucune tournée pour ces critères' : 'Aucune tournée comptée ce mois-ci'}</h3>
          <p>
            {filtered
              ? 'Élargissez la période ou retirez un filtre.'
              : 'La rentabilité d’une tournée apparaît ici dès que son comptage est enregistré.'}
          </p>
          {filtered
            ? <Link href={resetHref}>Réinitialiser les filtres</Link>
            : <Link href={buildProfitabilityHref({ dateFrom: '', dateTo: '' })}>Voir toutes les périodes</Link>}
        </div>
      )}

      <p className={styles.footnote}>
        Montants enregistrés au comptage et à la déclaration de frais, sans recalcul depuis les coûts actuels. Les versements et les retraits de caisse n’y entrent pas.
        La période porte sur la date de comptage, à l’heure d’Algérie ; une tournée sans date de comptage fiable reste affichée. Les totaux couvrent toute la sélection, toutes pages confondues.
      </p>
    </section>
  );
};

export default ProfitabilityReport;
