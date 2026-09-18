'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import styles from './day-recap.module.css';

// Reads the same address again: the day and the criteria are kept.
const DayRecapRetry = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button className={styles.retry} disabled={pending} onClick={() => startTransition(() => router.refresh())} type='button'>
      {pending ? 'Lecture en cours…' : 'Réessayer'}
    </button>
  );
};

export default DayRecapRetry;
