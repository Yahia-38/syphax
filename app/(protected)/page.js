import { getUserPermissions } from '../../lib/access.js';
import { CASH_READ_PERMISSION } from '../../lib/cash-payments.js';
import {
  DAY_RECAP_READ_PERMISSION,
  getDayRecap,
  readDayRecapState,
} from '../../lib/day-recap.js';
import { requireSession } from '../../lib/sessions.js';
import DayRecap from './day-recap.js';
import styles from './day-recap.module.css';

export const metadata = {
  title: 'Tableau de bord | Syphax',
};

const Home = async ({ searchParams }) => {
  const session = await requireSession();
  const resolvedSearchParams = await searchParams;
  const permissions = await getUserPermissions(session.userId);
  const canReadDayRecap = permissions.includes(DAY_RECAP_READ_PERMISSION);
  const recap = canReadDayRecap
    ? await getDayRecap({
        ...readDayRecapState(resolvedSearchParams),
        userId: session.userId,
      })
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Syphax</p>
          <h1>Tableau de bord</h1>
          <p>Gestion des achats, du stock et de la distribution</p>
        </div>
      </header>
      {recap
        ? <DayRecap canReadCash={permissions.includes(CASH_READ_PERMISSION)} recap={recap} />
        : <p className={styles.flowEmpty}>Le récapitulatif de la journée demande le droit de consulter les tournées.</p>}
    </main>
  );
};

export default Home;
