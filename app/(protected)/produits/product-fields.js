const ProductFields = ({ baseUnits, state }) => {
  return (
    <>
      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='code'
        >
          Code
        </label>
        <input
          aria-describedby={
            state.errors.code ? 'code-help code-error' : 'code-help'
          }
          aria-invalid={Boolean(state.errors.code)}
          autoComplete='off'
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.code}
          id='code'
          maxLength={50}
          name='code'
          placeholder='Ex. PROD-001'
          required
        />
        <p className='mt-2 text-sm text-slate-500' id='code-help'>
          Le code sera enregistré en majuscules, sans espace intérieur.
        </p>
        {state.errors.code && (
          <p className='mt-2 text-sm text-red-700' id='code-error'>
            {state.errors.code}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='designation'
        >
          Désignation
        </label>
        <input
          aria-describedby={
            state.errors.designation
              ? 'designation-help designation-error'
              : 'designation-help'
          }
          aria-invalid={Boolean(state.errors.designation)}
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.designation}
          id='designation'
          maxLength={150}
          name='designation'
          placeholder='Ex. Huile végétale 1 L'
          required
        />
        <p className='mt-2 text-sm text-slate-500' id='designation-help'>
          150 caractères maximum.
        </p>
        {state.errors.designation && (
          <p className='mt-2 text-sm text-red-700' id='designation-error'>
            {state.errors.designation}
          </p>
        )}
      </div>

      <div>
        <label
          className='block text-sm font-medium text-slate-700'
          htmlFor='baseUnit'
        >
          Unité de base
        </label>
        <select
          aria-describedby={
            state.errors.baseUnit
              ? 'base-unit-help base-unit-error'
              : 'base-unit-help'
          }
          aria-invalid={Boolean(state.errors.baseUnit)}
          className='mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100'
          defaultValue={state.values.baseUnit}
          id='baseUnit'
          name='baseUnit'
          required
        >
          <option disabled value=''>
            Sélectionnez une unité
          </option>
          {baseUnits.map((unit) => (
            <option key={unit.code} value={unit.code}>
              {unit.label}
            </option>
          ))}
        </select>
        <p
          className='mt-2 text-sm leading-6 text-slate-500'
          id='base-unit-help'
        >
          Unité utilisée pour compter le stock, par exemple une bouteille, même
          si elle est livrée en pack.
        </p>
        {state.errors.baseUnit && (
          <p className='mt-2 text-sm text-red-700' id='base-unit-error'>
            {state.errors.baseUnit}
          </p>
        )}
      </div>
    </>
  );
};

export default ProductFields;
