import { notFound } from 'next/navigation';

import { BASE_UNITS } from '../../../../lib/products.js';
import { getReceptionById } from '../../../../lib/reception-records.js';
import { validateReceptionHistoryHref } from '../../../../lib/receptions.js';
import { requirePermission } from '../../../../lib/sessions.js';
import ReceptionDetailView from './reception-detail-view.js';

export const metadata = {
  title: 'Fiche de réception | Syphax',
};

const ReceptionPage = async ({ params, searchParams }) => {
  const session = await requirePermission('receptions.read');
  const [{ id }, query = {}] = await Promise.all([params, searchParams]);
  const reception = await getReceptionById(id, { userId: session.userId });

  if (!reception) {
    notFound();
  }

  return <ReceptionDetailView baseUnits={BASE_UNITS} reception={reception} returnHref={validateReceptionHistoryHref(query.retour)} />;
};

export default ReceptionPage;
