'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';

import { formatProfitabilityExactAmount } from '../../../lib/profitability-format.js';
import { Amount } from './profitability-amounts.js';
import styles from './profitability.module.css';

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

const AMOUNTS = [
  { field: 'salesInCentimes', label: 'Ventes' },
  { field: 'costOfGoodsSoldInCentimes', label: 'Coût des ventes' },
  { field: 'marginInCentimes', label: 'Marge brute' },
  { field: 'expensesInCentimes', label: 'Frais déclarés' },
  { field: 'resultInCentimes', label: 'Résultat après frais', result: true },
];

const declared = (tour) => tour.expenseDeclarationStatus === 'DECLARED';

const expenseState = (tour) => EXPENSE_STATES[tour.expenseDeclarationStatus] ?? 'Inconnus';

const AmountCell = ({ field, label, result, tour }) => (
  <td className={`${styles.numeric} ${result ? styles.result : ''}`} data-label={label}>
    {field === 'expensesInCentimes' && !declared(tour)
      ? <span className={styles.unknown}>{expenseState(tour)}</span>
      : <Amount value={tour[field]} />}
  </td>
);

const ExactAmount = ({ field, tour }) => {
  if (field === 'expensesInCentimes' && !declared(tour)) return <span className={styles.unknown}>{expenseState(tour)}</span>;

  const exact = formatProfitabilityExactAmount(tour[field]);

  return exact
    ? <span className={tour[field] < 0 ? styles.negative : undefined}>{exact}</span>
    : <span className={styles.unknown}>Inconnu</span>;
};

const DetailNote = ({ tour }) => {
  if (tour.issues.length > 0) {
    return <ul className={styles.issues}>{tour.issues.map((issue) => <li key={issue.code}>{issue.label}</li>)}</ul>;
  }

  return (
    <p className={styles.detailNote}>
      {tour.profitabilityStatus === 'PENDING_EXPENSES'
        ? 'Les frais de cette tournée restent à déclarer : son résultat après frais n’est pas encore connu.'
        : 'Résultat après frais = marge brute − frais déclarés.'}
    </p>
  );
};

// Details only show what the row already holds, in exact dinars: opening one
// reads nothing more and changes nothing.
const ProfitabilityTours = ({ caption, tours }) => {
  const [opened, setOpened] = useState(() => new Set());
  const toggle = (id) => setOpened((current) => {
    const next = new Set(current);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    return next;
  });

  return (
    <table className={styles.table}>
      <caption className='sr-only'>{caption}</caption>
      <thead>
        <tr>
          <th scope='col'>Tournée / comptage</th>
          {AMOUNTS.map(({ field, label }) => <th className={styles.numeric} key={field} scope='col'>{label}</th>)}
          <th scope='col'>État de rentabilité</th>
        </tr>
      </thead>
      <tbody>
        {tours.map((tour) => {
          const state = PROFITABILITY_STATES[tour.profitabilityStatus] ?? PROFITABILITY_STATES.INCOMPLETE;
          const expanded = opened.has(tour.id);
          const detailId = `profitability-detail-${tour.id}`;
          const [firstIssue, ...otherIssues] = tour.issues;

          return (
            <Fragment key={tour.id}>
              <tr className={styles.tourRow}>
                <th className={styles.tour} scope='row'>
                  <Link href={tour.countingHref}>{tour.reference}</Link>
                  <span>{tour.delivererName}</span>
                  <small>{[tour.delivererCode, tour.statusLabel].filter(Boolean).join(' · ')}</small>
                  <small className={tour.countedAtLabel ? undefined : styles.unknown}>{tour.countedAtLabel ?? 'Date de comptage inconnue'}</small>
                </th>
                {AMOUNTS.map((amount) => <AmountCell key={amount.field} tour={tour} {...amount} />)}
                <td className={styles.state}>
                  <span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span>
                  {firstIssue && (
                    <p className={styles.issueShort}>
                      {firstIssue.label}
                      {otherIssues.length > 0 && ` · +${otherIssues.length}`}
                    </p>
                  )}
                  <button
                    aria-controls={detailId}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Masquer les détails' : 'Afficher les détails'} de la tournée ${tour.reference}`}
                    className={styles.detailsButton}
                    onClick={() => toggle(tour.id)}
                    type='button'
                  >
                    {expanded ? 'Masquer' : 'Détails'} <span aria-hidden='true'>{expanded ? '−' : '+'}</span>
                  </button>
                </td>
              </tr>
              <tr className={styles.detailRow} hidden={!expanded} id={detailId}>
                <td colSpan={AMOUNTS.length + 2}>
                  <div className={styles.detailInner}>
                    <div>
                      <h3>{tour.reference} · Montants exacts en DA</h3>
                      <dl className={styles.exactGrid}>
                        {AMOUNTS.map(({ field, label }) => (
                          <div key={field}>
                            <dt>{label}</dt>
                            <dd><ExactAmount field={field} tour={tour} /></dd>
                          </div>
                        ))}
                      </dl>
                      <DetailNote tour={tour} />
                    </div>
                    <Link className={styles.buttonLink} href={tour.countingHref}>
                      Voir le comptage <span aria-hidden='true'>→</span>
                    </Link>
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
};

export default ProfitabilityTours;
