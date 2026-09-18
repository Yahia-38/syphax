import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../lib/access.js';
import { CASH_READ_PERMISSION } from '../../lib/cash-payments.js';
import {
  DAY_RECAP_READ_PERMISSION,
  getDayRecap,
  projectDayAlerts,
  readDayRecapState,
} from '../../lib/day-recap.js';
import { requireSession } from '../../lib/sessions.js';
import { TOUR_EXPENSE_READ_PERMISSION } from '../../lib/tour-expenses.js';
import DayRecap from './day-recap.js';
import DayRecapRetry from './day-recap-retry.js';
import styles from './day-recap.module.css';

export const metadata = {
  title: 'Tableau de bord | Syphax',
};

const readRecap = async (filters) => {
  try {
    return { recap: await getDayRecap(filters) };
  } catch (error) {
    if (error instanceof PermissionDeniedError) throw error;
    console.error('Impossible de charger le récapitulatif de la journée.', error);

    return { readError: true };
  }
};

const Access = ({ children, title }) => (
  <section className={`${styles.card} ${styles.access}`} role='status'>
    <h2>{title}</h2>
    {children}
  </section>
);

const Home = async ({ searchParams }) => {
  const session = await requireSession();
  const [resolvedSearchParams, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadCash = permissions.includes(CASH_READ_PERMISSION);
  const canReadDeliverers = permissions.includes('deliverers.read');
  const canReadExpenses = permissions.includes(TOUR_EXPENSE_READ_PERMISSION);
  // Without the tour permission nothing of the day is read, not even partly.
  const { readError, recap } = permissions.includes(DAY_RECAP_READ_PERMISSION)
    ? await readRecap({ ...readDayRecapState(resolvedSearchParams), userId: session.userId })
    : {};

  const content = (() => {
    if (readError) {
      return (
        <Access title='Le récapitulatif n’a pas pu être chargé'>
          <p>Votre journée et vos critères sont conservés.</p>
          <DayRecapRetry />
        </Access>
      );
    }

    if (!recap) {
      return (
        <Access title='Le suivi des tournées n’est pas accessible à votre profil'>
          <p>Le récapitulatif de la journée nécessite le droit de consulter les tournées.</p>
          {canReadCash && <Link className={styles.buttonLink} href='/caisse'>Ouvrir la caisse <span aria-hidden='true'>→</span></Link>}
        </Access>
      );
    }

    return (
      <DayRecap
        alerts={projectDayAlerts(recap.alerts, { canReadCash, canReadExpenses })}
        canReadCash={canReadCash}
        canReadDeliverers={canReadDeliverers}
        recap={recap}
      />
    );
  })();

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Vue quotidienne</p>
          <h1>Tableau de bord</h1>
          <p>Suivez les tournées de la journée et les points qui demandent votre attention.</p>
        </div>
        {canReadDeliverers && (
          <div className={styles.heroActions}>
            <Link className={styles.buttonLink} href='/livreurs'>Voir les livreurs <span aria-hidden='true'>→</span></Link>
          </div>
        )}
      </header>
      {content}
    </main>
  );
};

export default Home;
