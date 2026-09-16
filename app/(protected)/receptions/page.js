import { randomUUID } from 'node:crypto';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import { BASE_UNITS, listProducts } from '../../../lib/products.js';
import { listReceptions } from '../../../lib/reception-records.js';
import {
  formatReceptionDateInput,
  getMissingReceptionFormPermissions,
} from '../../../lib/receptions.js';
import { requireSession } from '../../../lib/sessions.js';
import { listSuppliers } from '../../../lib/suppliers.js';
import ReceptionWorkspace from './reception-workspace.js';
import SupplierWorkspace from './supplier-workspace.js';
import styles from './receptions.module.css';

export const metadata = {
  title: 'Réceptions | Syphax',
};

const readTab = (value) => {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === 'fournisseurs' ? 'fournisseurs' : 'receptions';
};

const ReceptionsPage = async ({ searchParams }) => {
  const session = await requireSession();
  const [query, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadReceptions = permissions.includes('receptions.read');
  const canReadSuppliers = permissions.includes('suppliers.read');
  const canCreateReception = getMissingReceptionFormPermissions(
    permissions,
  ).length === 0;

  if (!canReadReceptions && !canReadSuppliers) {
    throw new PermissionDeniedError('receptions.read');
  }

  const requestedTab = readTab(query?.onglet);
  const activeTab = requestedTab === 'fournisseurs' && canReadSuppliers
    ? 'fournisseurs'
    : canReadReceptions
      ? 'receptions'
      : 'fournisseurs';
  let suppliers = [];
  let products = [];
  let receptions = [];

  let historyError = null;
  let supplierError = null;
  let catalogError = null;
  const readSafely = async (read, onError) => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof PermissionDeniedError) throw error;
      console.error('Lecture de l’espace réceptions indisponible :', error);
      onError();
      return [];
    }
  };

  if (activeTab === 'fournisseurs') {
    suppliers = await readSafely(() => listSuppliers(), () => {
      supplierError = 'La liste des fournisseurs est momentanément indisponible.';
    });
  } else {
    [receptions, suppliers, products] = await Promise.all([
      readSafely(() => listReceptions({ userId: session.userId }), () => {
        historyError = 'L’historique est momentanément indisponible. Vos critères sont conservés.';
      }),
      canCreateReception ? readSafely(() => listSuppliers(), () => {
        catalogError = 'La lecture des fournisseurs est momentanément indisponible.';
      }) : [],
      canCreateReception ? readSafely(() => listProducts({ includePackagings: true }), () => {
        catalogError = 'La lecture du catalogue est momentanément indisponible.';
      }) : [],
    ]);
    suppliers = suppliers.filter(({ active }) => active);
  }

  return (
    <main className={styles.page}>
      {activeTab === 'fournisseurs' ? (
        <SupplierWorkspace
          canReadReceptions={canReadReceptions}
          canReadSuppliers={canReadSuppliers}
          readError={supplierError}
          canCreateSupplier={permissions.includes('suppliers.create')}
          canDeleteSupplier={permissions.includes('suppliers.delete')}
          canUpdateSupplier={permissions.includes('suppliers.update')}
          suppliers={suppliers}
        />
      ) : (
        <ReceptionWorkspace
          canReadReceptions={canReadReceptions}
          canReadSuppliers={canReadSuppliers}
          historyError={historyError}
          catalogError={catalogError}
          baseUnits={BASE_UNITS}
          canCreateReception={canCreateReception}
          initialDate={formatReceptionDateInput(new Date())}
          initialSubmissionKey={randomUUID()}
          products={products}
          receptions={receptions}
          suppliers={suppliers}
        />
      )}
    </main>
  );
};

export default ReceptionsPage;
