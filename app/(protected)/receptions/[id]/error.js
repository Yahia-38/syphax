'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { validateReceptionHistoryHref } from '../../../../lib/receptions.js';
import styles from '../receptions.module.css';

const ReceptionDetailError = ({ retry }) => {
  const parameters = useSearchParams();
  return (
    <main className={`${styles.page} ${styles.workspace}`}>
      <Link className={styles.openLink} href={validateReceptionHistoryHref(parameters.get('retour'))}>← Retour à l’historique</Link>
      <div className={styles.error} role='alert'>
        <h1>Chargement impossible</h1>
        <p>La fiche réception est momentanément indisponible.</p>
        <button onClick={() => retry()} type='button'>Réessayer la lecture</button>
      </div>
    </main>
  );
};

export default ReceptionDetailError;
