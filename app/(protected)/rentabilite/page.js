import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { todayInAlgiers } from '../../../lib/day-recap.js';
import { PERMISSIONS } from '../../../lib/permissions.js';
import {
  PROFITABILITY_READ_PERMISSION,
  PROFITABILITY_READ_PERMISSIONS,
  getProfitabilityReport,
} from '../../../lib/profitability.js';
import {
  buildProfitabilityHref,
  getProfitabilityMonth,
  readProfitabilityState,
  toProfitabilityReportFilters,
} from '../../../lib/profitability-navigation.js';
import { requirePermission } from '../../../lib/sessions.js';
import ProfitabilityReport from './profitability-report.js';
import ProfitabilityRetry from './profitability-retry.js';
import styles from './profitability.module.css';

export const metadata = {
  title: 'Rentabilité | Syphax',
};

const describePermission = (key) => {
  const permission = PERMISSIONS.find((candidate) => candidate.key === key);

  return permission ? `${permission.domain} · ${permission.label}` : key;
};

// Without the page's own permission, nothing is read: the page says so.
const readSession = async () => {
  try {
    return await requirePermission(PROFITABILITY_READ_PERMISSION);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return null;
    throw error;
  }
};

const readReport = async (filters) => {
  try {
    return { report: await getProfitabilityReport(filters) };
  } catch (error) {
    if (error instanceof PermissionDeniedError) throw error;
    console.error('Impossible de charger la rentabilité.', error);

    return { readError: true };
  }
};

const Access = ({ children, title }) => (
  <section className={`${styles.card} ${styles.access}`} role='alert'>
    <h2>{title}</h2>
    {children}
  </section>
);

const ProfitabilityPage = async ({ searchParams }) => {
  const session = await readSession();
  const [query = {}, permissions] = await Promise.all([
    searchParams,
    session ? getUserPermissions(session.userId) : [],
  ]);
  // Costs and expenses keep their own permissions: without them the page
  // names what is missing instead of showing partial figures.
  const missingPermissions = PROFITABILITY_READ_PERMISSIONS.filter(
    (permission) => !permissions.includes(permission),
  );
  const today = todayInAlgiers();
  const state = readProfitabilityState(query, { today });
  const { readError, report } = session && missingPermissions.length === 0
    ? await readReport({ ...toProfitabilityReportFilters(state), userId: session.userId })
    : {};

  const content = (() => {
    if (!session) {
      return (
        <Access title='Accès non autorisé'>
          <p>Votre profil ne permet pas de consulter la rentabilité.</p>
        </Access>
      );
    }

    if (missingPermissions.length > 0) {
      return (
        <Access title='Des droits de lecture sont nécessaires'>
          <p>La rentabilité réunit des données protégées par d’autres droits : aucun chiffre n’est affiché sans l’ensemble de ces autorisations. Il vous manque :</p>
          <ul>{missingPermissions.map((permission) => <li key={permission}>{describePermission(permission)}</li>)}</ul>
        </Access>
      );
    }

    if (readError) {
      return (
        <Access title='La rentabilité n’a pas pu être chargée'>
          <p>Vos critères sont conservés. Réessayez dans un instant.</p>
          <ProfitabilityRetry />
        </Access>
      );
    }

    return (
      <ProfitabilityReport
        currentHref={buildProfitabilityHref({ ...state, page: report.page })}
        currentMonth={getProfitabilityMonth(today)}
        report={report}
        state={state}
        today={today}
      />
    );
  })();

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Pilotage</p>
          <h1>Rentabilité</h1>
          <p>Comprendre ce que rapportent vos tournées, après le coût des ventes et les frais déclarés.</p>
        </div>
        <span className={styles.readOnly}>Consultation</span>
      </header>
      {content}
    </main>
  );
};

export default ProfitabilityPage;
