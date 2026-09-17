import { requirePermission } from '../../../lib/sessions.js';

export const metadata = {
  title: 'Rentabilité | Syphax',
};

const ProfitabilityPage = async () => {
  await requirePermission('profitability.read');

  return (
    <main className='mx-auto max-w-7xl px-6 py-16 sm:py-24'>
      <h1 className='text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl'>
        Rentabilité
      </h1>
    </main>
  );
};

export default ProfitabilityPage;
