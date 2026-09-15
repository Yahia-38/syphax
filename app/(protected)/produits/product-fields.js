import styles from './product-fields.module.css';

export const PRODUCT_INPUT_CLASS = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 aria-invalid:border-red-500 aria-invalid:focus:border-red-600 aria-invalid:focus:ring-red-100';

const ProductFields = ({ baseUnits, state, onChange, creation = false }) => {
  const fieldProps = (name) => ({
    defaultValue: onChange ? undefined : state.values[name],
    value: onChange ? state.values[name] : undefined,
    onChange: onChange ? (event) => onChange(name, event.target.value) : undefined,
    'aria-invalid': Boolean(state.errors[name]),
  });
  const unitDescription = state.errors.baseUnit ? 'base-unit-help base-unit-error' : 'base-unit-help';
  return (
    <>
      {['designation', 'code'].map((name) => {
        const isCode = name === 'code';
        return (
          <div key={name}>
            <label className='block text-sm font-medium text-slate-700' htmlFor={name}>
              {isCode ? 'Code produit' : 'Désignation'}{creation && <span className={styles.required}> (obligatoire)</span>}
            </label>
            <input {...fieldProps(name)}
              aria-describedby={`${name}-help${state.errors[name] ? ` ${name}-error` : ''}`}
              autoComplete='off' autoCapitalize={isCode ? 'characters' : undefined}
              spellCheck={isCode ? false : undefined}
              className={`${PRODUCT_INPUT_CLASS} ${isCode && creation ? styles.code : ''}`}
              onBlur={isCode && creation && onChange ? (event) => onChange(name, event.target.value.trim().toLocaleUpperCase('fr')) : undefined}
              id={name} maxLength={isCode ? 50 : 150} name={name}
              placeholder={isCode ? 'Ex. CITRON-100' : 'Ex. Boisson citron 1 L'} required />
            <p className='mt-2 text-sm text-slate-500' id={`${name}-help`}>
              {isCode ? 'Un code unique, en majuscules et sans espace intérieur.' : creation ? 'Le nom qui permettra de reconnaître le produit. 150 caractères maximum.' : '150 caractères maximum.'}
            </p>
            {state.errors[name] && <p className='mt-2 text-sm text-red-700' id={`${name}-error`}>{state.errors[name]}</p>}
          </div>
        );
      })}
      <div>
        {creation ? (
          <fieldset aria-describedby={unitDescription} aria-invalid={Boolean(state.errors.baseUnit)} className={styles.unitFieldset} tabIndex={-1}>
            <legend className='text-sm font-medium text-slate-700'>Unité de base<span className={styles.required}> (obligatoire)</span></legend>
            <div className={styles.units}>
              {baseUnits.map((unit) => (
                <label className={styles.unit} key={unit.code}>
                  <input aria-describedby={unitDescription}
                    checked={state.values.baseUnit === unit.code} id={`baseUnit-${unit.code}`}
                    name='baseUnit' onChange={() => onChange('baseUnit', unit.code)} required type='radio' value={unit.code} />
                  <span>{unit.label}</span>
                  <small>{state.values.baseUnit === unit.code ? 'Sélectionnée' : 'Choisir'}</small>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <>
            <label className='block text-sm font-medium text-slate-700' htmlFor='baseUnit'>Unité de base</label>
            <select {...fieldProps('baseUnit')} aria-describedby={unitDescription} className={PRODUCT_INPUT_CLASS} id='baseUnit' name='baseUnit' required>
              <option disabled value=''>Sélectionnez une unité</option>
              {baseUnits.map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}
            </select>
          </>
        )}
        <p className='mt-2 text-sm leading-6 text-slate-500' id='base-unit-help'>
          L’unité qui sert à compter le stock : une bouteille, même si vous l’achetez en pack.
        </p>
        {state.errors.baseUnit && <p className='mt-2 text-sm text-red-700' id='base-unit-error'>{state.errors.baseUnit}</p>}
      </div>
    </>
  );
};

export default ProductFields;
