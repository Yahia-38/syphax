import { getUserPermissions } from '../../lib/access.js';
import { requireSession } from '../../lib/sessions.js';
import Navbar from '../navbar.js';

const ProtectedLayout = async ({ children }) => {
  const session = await requireSession();
  const permissions = await getUserPermissions(session.userId);

  return (
    <div className='min-h-screen bg-slate-50'>
      <Navbar
        canReadCash={permissions.includes('cash.read')}
        canReadDeliverers={permissions.includes('deliverers.read')}
        canReadProducts={permissions.includes('products.read')}
        canReadProfitability={permissions.includes('profitability.read')}
        canReadReceptions={
          permissions.includes('receptions.read')
          || permissions.includes('suppliers.read')
        }
        username={session.username}
      />
      {children}
    </div>
  );
};

export default ProtectedLayout;
