'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { buildReceptionHistoryHref, formatReceptionDate, getReceptionTabs, readReceptionHistoryState } from '../../../lib/receptions.js';
import { withTab } from '../../../lib/tab-navigation.js';
import Tabs from '../components/tabs.js';
import styles from './receptions.module.css';

export const formatReceptionShortDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? formatReceptionDate(value) : new Intl.DateTimeFormat('fr', { dateStyle: 'short', timeZone: 'UTC' }).format(date);
};

export const WorkspaceHeader = ({ activeTab, canReadReceptions, canReadSuppliers, children }) => {
  const parameters = useSearchParams();
  // Both tabs share the history filters; réceptions is the default, so it
  // stays out of the address.
  const historyHref = buildReceptionHistoryHref(readReceptionHistoryState(Object.fromEntries(parameters)));
  const buildHref = (tab) => tab === 'receptions'
    ? historyHref
    : `/receptions?${withTab(historyHref.split('?')[1] ?? '', tab)}`;
  return (
    <>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>Approvisionnement</p><h1>Réceptions</h1><p>Enregistrez les marchandises reçues et retrouvez vos documents fournisseurs.</p></div>
        {children}
      </header>
      <Tabs activeTab={activeTab} buildHref={buildHref} label='Sections des réceptions'
        tabs={getReceptionTabs({ canReadReceptions, canReadSuppliers })} />
    </>
  );
};

export const Pagination = ({ page, totalPages, onChange, label, disabled = false, totalResults }) => (
  <nav aria-label={label} className={styles.pagination}>
    <button disabled={disabled || page === 1} onClick={() => onChange(page - 1)} type='button'>Précédent</button>
    <span aria-live='polite'>{totalResults !== undefined ? `${totalResults} résultat${totalResults > 1 ? 's' : ''} · page ${page} / ${totalPages}` : `Page ${page} sur ${totalPages}`}</span>
    <button disabled={disabled || page === totalPages} onClick={() => onChange(page + 1)} type='button'>Suivant</button>
  </nav>
);

export const ReadError = ({ children }) => {
  const router = useRouter();
  return <div className={styles.error} role='alert'><p>{children}</p><button onClick={() => router.refresh()} type='button'>Réessayer la lecture</button></div>;
};
