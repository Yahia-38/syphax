'use client';

import { useActionState, useEffect } from 'react';

export const EMPTY_SUPPLIER_VALUES = Object.freeze({
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
});

const SupplierFields = ({ autoFocusName, idPrefix, state }) => {
  const fieldId = (name) => `${idPrefix}-${name}`;
  const errorId = (name) => `${fieldId(name)}-error`;

  return (
    <div className='grid gap-5 sm:grid-cols-2'>
      <div className='sm:col-span-2'>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor={fieldId('name')}
        >
          Nom ou raison sociale
        </label>
        <input
          aria-describedby={state.errors.name ? errorId('name') : undefined}
          aria-invalid={Boolean(state.errors.name)}
          autoComplete='organization'
          autoFocus={autoFocusName}
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.name}
          id={fieldId('name')}
          maxLength={150}
          name='name'
          placeholder='Ex. Distribution Atlas'
          required
        />
        {state.errors.name && (
          <p className='mt-2 text-sm text-red-700' id={errorId('name')}>
            {state.errors.name}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor={fieldId('contact')}
        >
          Personne à contacter
        </label>
        <input
          aria-describedby={
            state.errors.contactName ? errorId('contact') : undefined
          }
          aria-invalid={Boolean(state.errors.contactName)}
          autoComplete='name'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500'
          defaultValue={state.values.contactName}
          id={fieldId('contact')}
          maxLength={150}
          name='contactName'
          placeholder='Nom du contact (facultatif)'
        />
        {state.errors.contactName && (
          <p className='mt-2 text-sm text-red-700' id={errorId('contact')}>
            {state.errors.contactName}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor={fieldId('phone')}
        >
          Téléphone
        </label>
        <input
          aria-describedby={state.errors.phone ? errorId('phone') : undefined}
          aria-invalid={Boolean(state.errors.phone)}
          autoComplete='tel'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500'
          defaultValue={state.values.phone}
          id={fieldId('phone')}
          maxLength={30}
          name='phone'
          placeholder='Ex. 0550 00 00 00'
          type='tel'
        />
        {state.errors.phone && (
          <p className='mt-2 text-sm text-red-700' id={errorId('phone')}>
            {state.errors.phone}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor={fieldId('email')}
        >
          Adresse e-mail
        </label>
        <input
          aria-describedby={state.errors.email ? errorId('email') : undefined}
          aria-invalid={Boolean(state.errors.email)}
          autoComplete='email'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500'
          defaultValue={state.values.email}
          id={fieldId('email')}
          maxLength={254}
          name='email'
          placeholder='contact@fournisseur.dz'
          type='email'
        />
        {state.errors.email && (
          <p className='mt-2 text-sm text-red-700' id={errorId('email')}>
            {state.errors.email}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor={fieldId('address')}
        >
          Adresse
        </label>
        <textarea
          aria-describedby={
            state.errors.address ? errorId('address') : undefined
          }
          aria-invalid={Boolean(state.errors.address)}
          autoComplete='street-address'
          className='mt-2 min-h-11 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500'
          defaultValue={state.values.address}
          id={fieldId('address')}
          maxLength={500}
          name='address'
          placeholder='Adresse postale (facultatif)'
          rows={1}
        />
        {state.errors.address && (
          <p className='mt-2 text-sm text-red-700' id={errorId('address')}>
            {state.errors.address}
          </p>
        )}
      </div>
    </div>
  );
};

const SupplierForm = ({
  action,
  autoFocusName = false,
  cancelLabel = null,
  idPrefix,
  initialValues = EMPTY_SUPPLIER_VALUES,
  onCancel,
  onSuccess,
  pendingLabel,
  submitLabel,
}) => {
  const [state, formAction, pending] = useActionState(action, {
    errors: {},
    message: null,
    revision: 0,
    values: {
      ...EMPTY_SUPPLIER_VALUES,
      ...initialValues,
    },
  });

  useEffect(() => {
    if (state.message && onSuccess) {
      onSuccess(state.message);
    }
  }, [onSuccess, state.message]);

  return (
    <form
      action={formAction}
      className='mt-5 space-y-5 border-t border-slate-200 pt-5'
      key={state.revision}
    >
      {state.message && !onSuccess && (
        <p
          className='rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800'
          role='status'
        >
          {state.message}
        </p>
      )}

      {state.errors.form && (
        <p
          className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'
          role='alert'
        >
          {state.errors.form}
        </p>
      )}

      <SupplierFields
        autoFocusName={autoFocusName}
        idPrefix={idPrefix}
        state={state}
      />

      <div className='flex justify-end gap-3 border-t border-slate-200 pt-5'>
        {cancelLabel && (
          <button
            className='rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
            disabled={pending}
            onClick={onCancel}
            type='button'
          >
            {cancelLabel}
          </button>
        )}
        <button
          className='rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60'
          disabled={pending}
          type='submit'
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
};

export default SupplierForm;
