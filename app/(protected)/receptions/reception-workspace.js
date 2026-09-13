'use client';

import { useCallback, useState } from 'react';

import ReceptionForm from './reception-form.js';
import ReceptionList from './reception-list.js';

const ReceptionWorkspace = ({
  baseUnits,
  canCreateReception,
  initialDate,
  initialHistoryPage,
  initialHistoryQuery,
  initialHistorySupplierId,
  products,
  receptions,
  suppliers,
}) => {
  const [formVisible, setFormVisible] = useState(false);
  const [notice, setNotice] = useState(null);

  const handleReceptionCreated = useCallback((message) => {
    setFormVisible(false);
    setNotice(message);
  }, []);

  const toggleForm = () => {
    setNotice(null);
    setFormVisible((visible) => !visible);
  };

  return (
    <div role='tabpanel'>
      <div className='mt-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h2 className='text-xl font-semibold text-slate-900'>
            Réceptions de marchandises
          </h2>
          <p className='mt-1 text-sm leading-6 text-slate-600'>
            Consultez les réceptions enregistrées et leurs quantités.
          </p>
        </div>
        {canCreateReception && (
          <button
            aria-controls='new-reception-form'
            aria-expanded={formVisible}
            className='inline-flex w-fit items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            onClick={toggleForm}
            type='button'
          >
            {formVisible ? 'Fermer le formulaire' : 'Nouvelle réception'}
          </button>
        )}
      </div>

      {canCreateReception && formVisible && (
        <ReceptionForm
          baseUnits={baseUnits}
          initialDate={initialDate}
          onSuccess={handleReceptionCreated}
          products={products}
          suppliers={suppliers}
        />
      )}

      {notice && (
        <p
          className='mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          {notice}
        </p>
      )}

      <ReceptionList
        initialPage={initialHistoryPage}
        initialQuery={initialHistoryQuery}
        initialSupplierId={initialHistorySupplierId}
        receptions={receptions}
      />
    </div>
  );
};

export default ReceptionWorkspace;
