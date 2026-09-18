import { BASE_UNITS } from '../../../../lib/products.js';
import { validateProductListHref } from '../../../../lib/product-list-navigation.js';
import { getUserPermissions } from '../../../../lib/access.js';
import { requirePermission } from '../../../../lib/sessions.js';
import { EditingSessionProvider } from '../../components/editing-session.js';
import ProductForm from './product-form.js';
import styles from './product-form.module.css';

export const metadata = {
  title: 'Nouveau produit | Syphax',
};

const NewProductPage = async ({ searchParams }) => {
  const session = await requirePermission('products.create');
  const [query = {}, permissions] = await Promise.all([
    searchParams,
    getUserPermissions(session.userId),
  ]);

  return (
    <main className={styles.page}>
      <EditingSessionProvider creation>
        <ProductForm baseUnits={BASE_UNITS} canReadProducts={permissions.includes('products.read')} listHref={validateProductListHref(query.retour)} />
      </EditingSessionProvider>
    </main>
  );
};

export default NewProductPage;
