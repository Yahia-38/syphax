'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import styles from './day-recap.module.css';

const ALERTS_PER_PAGE = 4;

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count > 1 ? plural : singular}`;

// Every alert of the day is already here, reduced to what the reader may see:
// searching, filtering and paging stay local and never reach the address.
const DayAlerts = ({ alerts }) => {
  const id = useId();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const types = [...new Map(alerts.map((alert) => [alert.code, alert.type]))];
  const normalizedQuery = query.trim().toLocaleLowerCase('fr');
  const selected = alerts.filter((alert) =>
    (!type || alert.code === type)
    && (!normalizedQuery || [alert.deliverer, alert.reference, alert.label, alert.type]
      .join(' ')
      .toLocaleLowerCase('fr')
      .includes(normalizedQuery)));
  const totalPages = Math.max(1, Math.ceil(selected.length / ALERTS_PER_PAGE));
  const activePage = Math.min(page, totalPages);
  const start = (activePage - 1) * ALERTS_PER_PAGE;
  const visible = selected.slice(start, start + ALERTS_PER_PAGE);
  const narrowed = Boolean(normalizedQuery || type);
  const reset = () => {
    setQuery('');
    setType('');
    setPage(1);
  };

  return (
    <section aria-labelledby={`${id}-title`} className={`${styles.card} ${styles.attention}`}>
      <div className={styles.attentionHead}>
        <div className={styles.headingRow}>
          <h2 id={`${id}-title`}>À traiter</h2>
          <span className={`${styles.badge} ${styles.amber}`}>{countLabel(alerts.length, 'point')}</span>
        </div>
        <p>Toute la journée · Indépendant des filtres de tournées</p>
      </div>

      {alerts.length > 0 && (
        <div className={styles.alertFilters} role='search'>
          <div>
            <label htmlFor={`${id}-search`}>Rechercher un point</label>
            <input
              id={`${id}-search`}
              maxLength={100}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder='Livreur, référence ou motif'
              type='search'
              value={query}
            />
          </div>
          <div>
            <label htmlFor={`${id}-type`}>Type de point</label>
            <select
              id={`${id}-type`}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              value={type}
            >
              <option value=''>Tous les types</option>
              {types.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
        </div>
      )}

      {visible.length > 0 ? (
        <>
          <ul className={styles.alertList}>
            {visible.map((alert) => (
              <li key={alert.id}>
                <span className={`${styles.alertType} ${alert.code === 'ANOMALY' ? styles.alertDanger : ''}`}>{alert.type}</span>
                <strong>{alert.deliverer}</strong>
                <p>{alert.label}</p>
                <Link aria-label={`Ouvrir la tournée ${alert.reference} de ${alert.deliverer}`} href={alert.href}>
                  {alert.shortReference} <span aria-hidden='true'>→</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={styles.alertFooter}>
            <p role='status'>
              {start + 1}–{start + visible.length} sur {countLabel(selected.length, 'point')}
              {narrowed && ` · ${alerts.length} dans la journée`}
            </p>
            <nav aria-label='Pagination des points à traiter' className={styles.alertPager}>
              <button disabled={activePage === 1} onClick={() => setPage(activePage - 1)} type='button'>
                <span aria-hidden='true'>←</span> Préc.
              </button>
              <span>{activePage} / {totalPages}</span>
              <button disabled={activePage === totalPages} onClick={() => setPage(activePage + 1)} type='button'>
                Suiv. <span aria-hidden='true'>→</span>
              </button>
            </nav>
          </div>
        </>
      ) : (
        <div className={styles.alertEmpty} role='status'>
          {alerts.length > 0 ? (
            <>
              <p>Aucun point pour ces critères.</p>
              <button onClick={reset} type='button'>Réinitialiser</button>
            </>
          ) : (
            <p>Aucun point à traiter dans les informations accessibles.</p>
          )}
        </div>
      )}
    </section>
  );
};

export default DayAlerts;
