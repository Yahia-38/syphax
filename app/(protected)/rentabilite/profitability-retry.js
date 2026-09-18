'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import styles from './profitability.module.css';

// Reads the same address again: the criteria are kept.
const ProfitabilityRetry = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button className={styles.primary} disabled={pending} onClick={() => startTransition(() => router.refresh())} type='button'>
      {pending ? 'Lecture en cours…' : 'Réessayer'}
    </button>
  );
};

export default ProfitabilityRetry;
