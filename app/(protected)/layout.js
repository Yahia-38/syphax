import { getUserPermissions } from '../../lib/access.js';
import { requireSession } from '../../lib/sessions.js';
import Navbar from '../navbar.js';

const ProtectedLayout = async ({ children }) => {
  const session = await requireSession();
  const permissions = await getUserPermissions(session.userId);

  return (
    <div className='min-h-screen bg-slate-50'>
      <Navbar
        canReadProducts={permissions.includes('products.read')}
        username={session.username}
      />
      {children}
    </div>
  );
};

export default ProtectedLayout;
