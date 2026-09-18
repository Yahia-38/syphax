import { getUserPermissions } from '../../../lib/access.js';
import { PERMISSIONS } from '../../../lib/permissions.js';
import {
  PROFITABILITY_READ_PERMISSION,
  PROFITABILITY_READ_PERMISSIONS,
  getProfitabilityReport,
} from '../../../lib/profitability.js';
import {
  buildProfitabilityHref,
  readProfitabilityState,
  toProfitabilityReportFilters,
} from '../../../lib/profitability-navigation.js';
import { requirePermission } from '../../../lib/sessions.js';
import ProfitabilityReport from './profitability-report.js';
import styles from './profitability.module.css';

export const metadata = {
  title: 'Rentabilité | Syphax',
};

const describePermission = (key) => {
  const permission = PERMISSIONS.find((candidate) => candidate.key === key);

  return permission ? `${permission.domain} · ${permission.label}` : key;
};

const ProfitabilityPage = async ({ searchParams }) => {
  const session = await requirePermission(PROFITABILITY_READ_PERMISSION);
  const [query = {}, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  // Costs and expenses keep their own permissions: without them the page
  // names what is missing instead of showing partial figures.
  const missingPermissions = PROFITABILITY_READ_PERMISSIONS.filter(
    (permission) => !permissions.includes(permission),
  );
  const state = readProfitabilityState(query);
  const report = missingPermissions.length === 0
    ? await getProfitabilityReport({
        ...toProfitabilityReportFilters(state),
        userId: session.userId,
      })
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Pilotage</p>
          <h1>Rentabilité</h1>
          <p>Ventes, coût des ventes, marge et frais de chaque tournée comptée, tels qu’ils ont été enregistrés.</p>
        </div>
      </header>
      {report
        ? <ProfitabilityReport currentHref={buildProfitabilityHref({ ...state, page: report.page })} report={report} state={state} />
        : (
          <div className={styles.denied} role='alert'>
            <strong>La rentabilité réunit des données protégées par d’autres droits.</strong>
            <p>Il vous manque :</p>
            <ul>{missingPermissions.map((permission) => <li key={permission}>{describePermission(permission)}</li>)}</ul>
          </div>
        )}
    </main>
  );
};

export default ProfitabilityPage;
