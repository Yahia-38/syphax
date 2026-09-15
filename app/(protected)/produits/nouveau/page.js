import { BASE_UNITS } from '../../../../lib/products.js';
import { getUserPermissions } from '../../../../lib/access.js';
import { requirePermission } from '../../../../lib/sessions.js';
import { EditingSessionProvider } from '../../components/editing-session.js';
import ProductForm from './product-form.js';
import styles from './product-form.module.css';

export const metadata = {
  title: 'Nouveau produit | Syphax',
};

const NewProductPage = async () => {
  const session = await requirePermission('products.create');
  const permissions = await getUserPermissions(session.userId);

  return (
    <main className={styles.page}>
      <EditingSessionProvider creation>
        <ProductForm baseUnits={BASE_UNITS} canReadProducts={permissions.includes('products.read')} />
      </EditingSessionProvider>
    </main>
  );
};

export default NewProductPage;
