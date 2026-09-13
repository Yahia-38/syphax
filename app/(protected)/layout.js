import { requireSession } from '../../lib/sessions.js';
import Navbar from '../navbar.js';

const ProtectedLayout = async ({ children }) => {
  const { username } = await requireSession();

  return (
    <div className='min-h-screen bg-slate-50'>
      <Navbar username={username} />
      {children}
    </div>
  );
};

export default ProtectedLayout;
