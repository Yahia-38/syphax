'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { PROFITABILITY_STATUS_FILTERS } from '../../../lib/profitability-navigation.js';
import styles from './profitability.module.css';

const readForm = (form) => {
  const data = new FormData(form);
  const read = (name) => String(data.get(name) ?? '').trim();

  return {
    dateFrom: read('du'),
    dateTo: read('au'),
    delivererId: read('livreur'),
    query: read('q'),
    status: read('statut'),
  };
};

const differsFrom = (draft, state) => Object.keys(draft).some((key) => draft[key] !== state[key]);

// Typed criteria only change the figures once applied: until then the page
// says so. A shortcut starts from the applied selection, never from the draft.
const ProfitabilityFilters = ({ delivererOptions, filtered, resetHref, shortcuts, state }) => {
  const form = useRef(null);
  const [draft, setDraft] = useState(false);
  const selectedDeliverer = delivererOptions.some(({ id }) => id === state.delivererId);
  const discardDraft = () => {
    form.current?.reset();
    setDraft(false);
  };
  const updateDraft = () => {
    if (form.current) setDraft(differsFrom(readForm(form.current), state));
  };

  return (
    <section aria-labelledby='profitability-filters-title' className={`${styles.card} ${styles.filtersCard}`}>
      <div className={styles.filterTop}>
        <h2 id='profitability-filters-title'>Période de comptage</h2>
        <nav aria-label='Périodes rapides' className={styles.quick}>
          {shortcuts.map(({ active, href, label }) => (
            <Link aria-current={active ? 'true' : undefined} href={href} key={label} onClick={discardDraft}>{label}</Link>
          ))}
        </nav>
      </div>
      <form
        action='/rentabilite'
        aria-label='Filtrer la rentabilité'
        className={styles.filters}
        method='get'
        onChange={updateDraft}
        onInput={updateDraft}
        onReset={() => setDraft(false)}
        ref={form}
        role='search'
      >
        <div className={styles.period}>
          <div>
            <label htmlFor='profitability-from'>Comptées du</label>
            <input defaultValue={state.dateFrom} id='profitability-from' max='9999-12-31' min='1000-01-01' name='du' type='date' />
          </div>
          <div>
            <label htmlFor='profitability-to'>Au</label>
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
          <label htmlFor='profitability-status'>Statut de tournée</label>
          <select defaultValue={state.status} id='profitability-status' name='statut'>
            <option value=''>Comptées et terminées</option>
            {Object.entries(PROFITABILITY_STATUS_FILTERS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className={styles.searchField}>
          <label htmlFor='profitability-search'>Rechercher</label>
          <input defaultValue={state.query} id='profitability-search' maxLength={100} name='q' placeholder='Référence, nom ou code livreur' type='search' />
        </div>
        <div className={styles.filterActions}>
          <button className={styles.primary} type='submit'>Appliquer</button>
          {(filtered || draft) && <Link href={resetHref} onClick={discardDraft}>Réinitialiser</Link>}
        </div>
      </form>
      <p aria-live='polite' className={styles.draftNote}>
        {draft && 'Critères modifiés · Appliquez-les pour actualiser les résultats.'}
      </p>
    </section>
  );
};

export default ProfitabilityFilters;
