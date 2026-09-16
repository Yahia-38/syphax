'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { EditingSessionProvider, EditingLink, useEditingSession } from '../../components/editing-session.js';
import { buildTourViewHref, readTourView } from '../../../../lib/tour-detail-navigation.js';
import styles from './tour-detail.module.css';

const TourNavigation = ({ tourId, returnHref, defaultView, header, operations, products, history, financial, shortcuts, priority }) => {
  const query = useSearchParams();
  const [initialView] = useState(defaultView);
  const view = query.has('vue') ? readTourView(query.get('vue'), defaultView === 'produits' ? 'PREPARATION' : undefined) : initialView;
  const session = useEditingSession();
  const destinationRef = useRef(null);
  useEffect(() => {
    const destination = destinationRef.current;
    if (!destination) return;
    destinationRef.current = null;
    if (destination.view === view && destination.tourId === tourId) destination.focus();
  }, [view, tourId]);
  const href = (nextView) => buildTourViewHref({ tourId, returnHref, view: nextView });
  const go = ({ target, view: nextView, edit = false }) => {
    const existing = document.getElementById(target);
    if (view === nextView && (!edit || existing?.querySelector('form'))) {
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
      if (view === nextView) { focusTarget(); return; }
      destinationRef.current = { view: nextView, tourId, focus: focusTarget };
      session.router.push(href(nextView), { scroll: false });
    });
  };
  return (
    <main className={styles.page}>
      <div className={styles.hero}>{header}{priority && <button className={styles.primary} onClick={() => go({ ...priority, edit: true })} type='button'>{priority.label}</button>}</div>
      <nav className={styles.tabs} aria-label='Vues de la tournée'>
        {[['operations', 'Opérations'], ['produits', 'Produits & chargement'], ['historique', 'Traçabilité']].map(([key, label]) => (
          <EditingLink key={key} href={href(key)} aria-current={view === key ? 'page' : undefined}>{label}</EditingLink>
        ))}
      </nav>
      {view === 'operations' && <>
        <nav className={styles.shortcuts} aria-label='Accès aux opérations'>
          {shortcuts.map((shortcut, index) => {
            const complete = ['Confirmé', 'Enregistré', 'Déclarés', 'Soldée'].includes(shortcut.state);
            return <button key={shortcut.target} data-complete={complete} onClick={() => go(shortcut)} type='button'><span className={styles.shortcutMarker} aria-hidden='true'>{complete ? '✓' : index + 1}</span><span><strong>{shortcut.label}</strong><small>{shortcut.state}</small></span></button>;
          })}
        </nav>
        <div className={styles.layout}><div className={styles.operations}>{operations}</div>{financial}</div>
      </>}
      {view === 'produits' && <div className={styles.operations}>{products}</div>}
      {view === 'historique' && history}
    </main>
  );
};

const TourDetail = (props) => <EditingSessionProvider protectNavigation operation><TourNavigation {...props} /></EditingSessionProvider>;
export default TourDetail;
