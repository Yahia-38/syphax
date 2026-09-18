'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { EditingSessionProvider, useEditingSession } from '../../components/editing-session.js';
import { readTab } from '../../../../lib/tab-navigation.js';
import { buildTourTabHref, TOUR_TABS } from '../../../../lib/tour-detail-navigation.js';
import Tabs from '../../components/tabs.js';
import styles from './tour-detail.module.css';

const TourNavigation = ({ tourId, returnHref, defaultTab, header, operations, products, history, financial, shortcuts, priority }) => {
  const query = useSearchParams();
  const [initialTab] = useState(defaultTab);
  const tab = readTab(query, TOUR_TABS, initialTab);
  const session = useEditingSession();
  const destinationRef = useRef(null);
  useEffect(() => {
    const destination = destinationRef.current;
    if (!destination) return;
    destinationRef.current = null;
    if (destination.tab === tab && destination.tourId === tourId) destination.focus();
  }, [tab, tourId]);
  const href = (nextTab) => buildTourTabHref({ tourId, returnHref, tab: nextTab });
  const go = ({ target, tab: nextTab, edit = false }) => {
    const existing = document.getElementById(target);
    if (tab === nextTab && (!edit || existing?.querySelector('form'))) {
      existing?.scrollIntoView({ block: 'start', behavior: 'instant' });
      if (edit) (existing?.querySelector('[data-autofocus]') ?? existing?.querySelector('input:not([type="hidden"]), textarea, select'))?.focus();
      else if (existing) { existing.tabIndex = -1; existing.focus({ preventScroll: true }); }
      return;
    }
    session.request(() => {
      const focusTarget = () => {
        const card = document.getElementById(target);
        if (!card) return false;
        card.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        const action = card.querySelector('button');
        if (edit) action?.click(); else { card.tabIndex = -1; card.focus({ preventScroll: true }); }
        return true;
      };
      if (tab === nextTab) { focusTarget(); return; }
      destinationRef.current = { tab: nextTab, tourId, focus: focusTarget };
      session.router.push(href(nextTab), { scroll: false });
    });
  };
  return (
    <main className={styles.page}>
      <div className={styles.hero}>{header}{priority && <button className={styles.primary} onClick={() => go({ ...priority, edit: true })} type='button'>{priority.label}</button>}</div>
      <Tabs activeTab={tab} buildHref={href} label='Vues de la tournée' tabs={TOUR_TABS} />
      {tab === 'operations' && <>
        <nav className={styles.shortcuts} aria-label='Accès aux opérations'>
          {shortcuts.map((shortcut, index) => {
            const complete = ['Confirmé', 'Enregistré', 'Déclarés', 'Soldée'].includes(shortcut.state);
            return <button key={shortcut.target} data-complete={complete} onClick={() => go(shortcut)} type='button'><span className={styles.shortcutMarker} aria-hidden='true'>{complete ? '✓' : index + 1}</span><span><strong>{shortcut.label}</strong><small>{shortcut.state}</small></span></button>;
          })}
        </nav>
        <div className={styles.layout}><div className={styles.operations}>{operations}</div>{financial}</div>
      </>}
      {tab === 'produits' && <div className={styles.operations}>{products}</div>}
      {tab === 'historique' && history}
    </main>
  );
};

const TourDetail = (props) => <EditingSessionProvider protectNavigation operation><TourNavigation {...props} /></EditingSessionProvider>;
export default TourDetail;
