'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildCashFilterHref, buildCashViewHref, readCashView } from '../../../lib/cash-navigation.js';
import { EditingLink, EditingSessionProvider, useEditingSession } from '../components/editing-session.js';
import EditableCard from '../components/editable-card.js';
import CashWithdrawalPreview from './cash-withdrawal-preview.js';
import styles from './cash.module.css';

import { CashNoticeContext } from './cash-form-context.js';

export const CashFilterForm = ({ children, view, ...props }) => {
  const session = useEditingSession();
  const parameters = useSearchParams();
  const criteriaKey = JSON.stringify((view === 'restes' ? ['resteRecherche'] : ['q', 'livreur', 'du', 'au']).map((key) => parameters.get(key)));
  return <form key={criteriaKey} {...props} action='/caisse' method='get' onSubmit={(event) => {
    event.preventDefault();
    const href = buildCashFilterHref(parameters.toString(), view, new FormData(event.currentTarget));
    session.request(() => session.router.push(href, { scroll: false }));
  }}>{children}</form>;
};

export const CashResetLink = ({ children = 'Réinitialiser', view, ...props }) => {
  const parameters = useSearchParams();
  return <EditingLink {...props} href={buildCashFilterHref(parameters.toString(), view)}>{children}</EditingLink>;
};

export const CashPageLink = ({ view, page, children, ...props }) => {
  const parameters = new URLSearchParams(useSearchParams().toString());
  parameters.set(view === 'restes' ? 'restePage' : 'page', String(page));
  return <EditingLink {...props} href={buildCashViewHref(parameters, view)}>{children}</EditingLink>;
};

const CashNavigation = ({ canCreatePayment, withdrawalEditing }) => {
  const parameters = useSearchParams();
  const view = readCashView(parameters.get('vue'));
  const session = useEditingSession();
  const [focusRequested, setFocusRequested] = useState(false);
  useEffect(() => {
    if (view !== 'restes' || !focusRequested) return;
    document.getElementById('cash-remainder-search')?.focus();
  }, [view, focusRequested]);
  return <>
    <div className={styles.choose} hidden={withdrawalEditing}>
      <div><p className={styles.eyebrow}>Situation actuelle des livreurs</p>
      <h2>Retrouver un reste à encaisser</h2>
      <p>Consultez les tournées comptées ou terminées, puis encaissez un livreur ou une tournée précise.</p></div>
      <button type='button' onClick={() => session.request(() => {
        setFocusRequested(true);
        session.router.push(buildCashViewHref(parameters.toString(), 'restes'), { scroll: false });
        if (view === 'restes') document.getElementById('cash-remainder-search')?.focus();
      })}>{canCreatePayment ? 'Choisir un livreur' : 'Consulter les restes'} <span aria-hidden='true'>→</span></button>
    </div>
    <nav className={styles.tabs} aria-label='Vues de la caisse'>
      {['journal', 'restes'].map((target) => <EditingLink key={target} href={buildCashViewHref(parameters.toString(), target)} aria-current={view === target ? 'page' : undefined}>{target === 'journal' ? 'Journal' : 'À encaisser'}</EditingLink>)}
    </nav>
  </>;
};

const CashContent = ({ children, balanceContent, balanceHeader, canCreatePayment, withdrawalPreview, initialWithdrawalKey }) => {
  const [notice, setNotice] = useState(null);
  const [withdrawalEditing, setWithdrawalEditing] = useState(false);
  return <CashNoticeContext.Provider value={setNotice}>
    <div className={`${styles.overview} ${withdrawalEditing ? styles.withdrawalEditing : ''}`}>
      <EditableCard title='Solde suivi' description='Caisse active · historique complet' className={styles.balance}
        headerContent={balanceHeader} onEditingChange={setWithdrawalEditing}
        canEdit={Boolean(withdrawalPreview)}
        editDisabled={!withdrawalPreview?.cashRegister || Boolean(withdrawalPreview?.error) || !Number.isSafeInteger(withdrawalPreview?.balanceInCentimes)}
        editLabel='Retirer des espèces' editingLabel='Retrait en cours' trackDraft
        formComponent={CashWithdrawalPreview} formProps={{ ...withdrawalPreview, initialConfirmationKey: initialWithdrawalKey }}>
        {balanceContent}
      </EditableCard>
      <CashNavigation canCreatePayment={canCreatePayment} withdrawalEditing={withdrawalEditing} />
    </div>
    {notice && <p className={styles.success} role='status'>{notice}</p>}
    {children}
  </CashNoticeContext.Provider>;
};

const CashWorkspace = (props) => <EditingSessionProvider operation protectNavigation><CashContent {...props} /></EditingSessionProvider>;
export default CashWorkspace;
