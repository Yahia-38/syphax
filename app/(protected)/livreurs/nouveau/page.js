import { getUserPermissions } from '../../../../lib/access.js';
import { validateDelivererListHref } from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';
import { EditingSessionProvider } from '../../components/editing-session.js';
import DelivererForm from './deliverer-form.js';
import styles from './deliverer-form.module.css';

export const metadata = {
  title: 'Nouveau livreur | Syphax',
};

const NewDelivererPage = async ({ searchParams }) => {
  const session = await requirePermission('deliverers.create');
  const [parameters, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadDeliverers = permissions.includes('deliverers.read');
  const returnHref = canReadDeliverers
    ? validateDelivererListHref(parameters?.retour)
    : null;

  return (
    <div className={styles.surface}>
      <main className={styles.page}>
        <EditingSessionProvider creation protectUnload confirmationAppearance='compact'
          discardTitle='Quitter la création ?' discardLabel='Abandonner'
          discardDescription='Les informations saisies ne seront pas enregistrées.'>
          <DelivererForm returnHref={returnHref} canReadDeliverers={canReadDeliverers} />
        </EditingSessionProvider>
      </main>
    </div>
  );
};

export default NewDelivererPage;
