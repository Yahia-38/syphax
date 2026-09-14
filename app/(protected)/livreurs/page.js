import Link from 'next/link';

import { getUserPermissions } from '../../../lib/access.js';
import {
  listDeliverers,
  readDelivererListState,
} from '../../../lib/deliverers.js';
import { requirePermission } from '../../../lib/sessions.js';
import DelivererList from './deliverer-list.js';

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
  const result = await listDeliverers({
    ...listState,
    userId: session.userId,
  });
  const canCreateDeliverer = permissions.includes('deliverers.create');

  return (
    <main className='mx-auto w-full max-w-7xl px-6 py-10 sm:py-14'>
      <div className='flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h1 className='text-3xl font-bold tracking-tight text-slate-900'>
            Livreurs
          </h1>
          <p className='mt-2 text-sm leading-6 text-slate-600'>
            Consultez les personnes suivies pour préparer la distribution.
          </p>
        </div>

        {canCreateDeliverer && (
          <Link
            className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            href='/livreurs/nouveau'
          >
            Nouveau livreur
          </Link>
        )}
      </div>

      <DelivererList {...result} />
    </main>
  );
};

export default DeliverersPage;
