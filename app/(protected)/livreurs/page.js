import Link from 'next/link';

import { PermissionDeniedError, getUserPermissions } from '../../../lib/access.js';
import {
  listDeliverers,
  DELIVERERS_PER_PAGE,
  readDelivererListState,
  buildDelivererListHref,
} from '../../../lib/deliverers.js';
import { requirePermission } from '../../../lib/sessions.js';
import DelivererList from './deliverer-list.js';
import styles from './deliverer-list.module.css';

export const metadata = {
  title: 'Livreurs | Syphax',
};

const DeliverersPage = async ({ searchParams }) => {
  const session = await requirePermission('deliverers.read');
  const [resolvedSearchParams, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const listState = readDelivererListState(resolvedSearchParams);
  let result;
  try {
    result = await listDeliverers({ ...listState, userId: session.userId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) throw error;
    console.error('Impossible de charger la liste des livreurs.', error);
    result = { ...listState, pageSize: DELIVERERS_PER_PAGE, readError: true };
  }
  const canCreateDeliverer = permissions.includes('deliverers.create');

  return (
    <div className={styles.surface}>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Distribution</p>
            <h1>
              Livreurs
            </h1>
            <p className={styles.subtitle}>
              Retrouvez un livreur, ses coordonnées et ses tournées.
            </p>
          </div>

          {canCreateDeliverer && (
            <Link
              className={styles.createAction}
              href={`/livreurs/nouveau?${new URLSearchParams({ retour: buildDelivererListHref(result) })}`}
            >
              <span aria-hidden='true'>＋</span>Nouveau livreur
            </Link>
          )}
        </header>

        <DelivererList
          {...result}
          canCreateDeliverer={canCreateDeliverer}
          canReadTours={permissions.includes('tours.read')}
          canUpdateDeliverer={permissions.includes('deliverers.update')}
        />
      </main>
    </div>
  );
};

export default DeliverersPage;
