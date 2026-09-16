'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { EditingSessionProvider } from '../components/editing-session.js';
import ReceptionForm from './reception-form.js';
import ReceptionList from './reception-list.js';
import { WorkspaceHeader } from './reception-ui.js';
import styles from './receptions.module.css';

const ReceptionWorkspace = ({
  baseUnits, canCreateReception, canReadReceptions, canReadSuppliers,
  catalogError, historyError, initialDate, initialSubmissionKey,
  products, receptions, suppliers,
}) => {
  const [formVisible, setFormVisible] = useState(false);
  const [notice, setNotice] = useState(null);
  const [submissionKey, setSubmissionKey] = useState(initialSubmissionKey);
  const triggerRef = useRef(null);

  const closeForm = useCallback(() => {
    setFormVisible(false);
    setSubmissionKey(globalThis.crypto.randomUUID());
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const handleReceptionCreated = useCallback((message, result) => {
    closeForm();
    setNotice({ message, receptionId: result.receptionId, retour: `${window.location.pathname}${window.location.search}` });
  }, [closeForm]);

  return (
    <EditingSessionProvider protectNavigation operation discardDescription='Votre préparation sera fermée. Si une tentative d’enregistrement est restée sans résultat confirmé, vérifiez l’historique avant de préparer une nouvelle réception.'>
      <div className={styles.workspace}>
        <WorkspaceHeader activeTab='receptions' canReadReceptions={canReadReceptions} canReadSuppliers={canReadSuppliers}>
          {canCreateReception && !formVisible && <button className={styles.primary} ref={triggerRef} onClick={() => {
            setNotice(null);
            setFormVisible(true);
          }} type='button'><span aria-hidden='true'>+</span> Nouvelle réception</button>}
        </WorkspaceHeader>
        {notice && <p className={styles.notice} role='status'>{notice.message}<Link href={`/receptions/${notice.receptionId}?${new URLSearchParams({ retour: notice.retour })}`}>Ouvrir la fiche</Link></p>}
        {canCreateReception && formVisible && <ReceptionForm
          baseUnits={baseUnits} initialDate={initialDate} onCancel={closeForm}
          onSuccess={handleReceptionCreated} products={products}
          submissionKey={submissionKey} suppliers={suppliers} catalogError={catalogError}
          canReadSuppliers={canReadSuppliers}
        />}
        <div hidden={formVisible}>
          <ReceptionList receptions={receptions} readError={historyError} />
        </div>
      </div>
    </EditingSessionProvider>
  );
};

export default ReceptionWorkspace;
