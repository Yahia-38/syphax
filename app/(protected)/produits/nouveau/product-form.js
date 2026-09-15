'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { EditingButtons, useInlineSave } from '../../components/editable-card.js';
import { EditingLink, useEditingSession } from '../../components/editing-session.js';
import ProductIcon from '../[id]/product-icon.js';
import ProductFields, { PRODUCT_INPUT_CLASS } from '../product-fields.js';
import { createProduct } from './actions.js';
import styles from './product-form.module.css';

const EMPTY_VALUES = { code: '', designation: '', baseUnit: '', label: '', quantity: '', withPackaging: false };
const INITIAL_STATE = { errors: {}, message: null, revision: 0, values: EMPTY_VALUES };
const pluralUnit = (baseUnits, code) => {
  const label = baseUnits.find((unit) => unit.code === code)?.label;
  return label ? `${label.toLocaleLowerCase('fr')}s` : 'unités de base';
};
const conversionText = (baseUnits, values) => values.baseUnit
  ? `1 ${values.label.trim() || 'conditionnement'} = ${values.quantity || '…'} ${pluralUnit(baseUnits, values.baseUnit)}`
  : 'Choisissez une unité de base pour préciser la conversion.';

const CreationForm = ({ baseUnits, onCreated, returnHref }) => {
  const [values, setValues] = useState({ ...EMPTY_VALUES });
  const valuesRef = useRef(values);
  const [clearedPackagingRevision, setClearedPackagingRevision] = useState(-1);
  const activeRef = useRef({ dirty: false, pending: false, discard: () => {} });
  const session = useEditingSession();
  const register = session.register;
  const onPending = useCallback((isPending) => {
    activeRef.current.pending = isPending;
  }, []);
  const onSuccess = useCallback((message, result) => onCreated(result.product), [onCreated]);
  const { state, pending, formRef, save } = useInlineSave({
    action: createProduct, initialState: INITIAL_STATE, onSuccess, onPending,
    failureMessage: 'La création a échoué. Vos saisies sont conservées ; vous pouvez réessayer.',
  });
  const isPending = pending;
  const errors = { ...state.errors };
  if (!values.withPackaging || clearedPackagingRevision === state.revision) {
    delete errors.label;
    delete errors.quantity;
  }
  const fieldErrors = Object.entries(errors).filter(([name]) => name !== 'form');
  useLayoutEffect(() => register(activeRef.current), [register]);
  const change = (name, value) => {
    const next = { ...valuesRef.current, [name]: value };
    valuesRef.current = next;
    activeRef.current.dirty = Object.entries(next).some(([key, entry]) => entry !== EMPTY_VALUES[key]);
    setValues(next);
  };
  const togglePackaging = (enabled) => {
    const next = { ...valuesRef.current, withPackaging: enabled, ...(!enabled ? { label: '', quantity: '' } : {}) };
    valuesRef.current = next;
    activeRef.current.dirty = Object.entries(next).some(([key, entry]) => entry !== EMPTY_VALUES[key]);
    setValues(next);
    if (!enabled) setClearedPackagingRevision(state.revision);
    if (enabled) requestAnimationFrame(() => formRef.current?.querySelector('[name="label"]')?.focus());
  };
  const cancel = () => session.request(() => session.router.push(returnHref));

  return (
    <div className={styles.grid}>
      <form aria-busy={isPending} className={styles.form} noValidate ref={formRef} onSubmit={(event) => {
        event.preventDefault();
        // Capture before the shared save lifecycle disables any controls.
        save(new FormData(event.currentTarget));
      }}>
        {errors.form && <p className={styles.alert} role='alert' tabIndex={-1}>{errors.form} Vos saisies sont conservées.</p>}
        {fieldErrors.length > 1 && (
          <div className={styles.alert} role='alert' tabIndex={-1}>
            <p>Vérifiez les champs suivants :</p>
            {fieldErrors.map(([name, message]) => <button key={name} onClick={() => formRef.current?.querySelector(`[name="${name}"]`)?.focus()} type='button'>{message}</button>)}
          </div>
        )}
        <fieldset className={styles.controls} disabled={isPending}>
          <section className={styles.card} aria-labelledby='identification-title'>
            <header className={styles.cardHeader}>
              <ProductIcon name='identification' />
              <div><h2 id='identification-title'>Identification du produit</h2><p>Trois informations pour reconnaître et compter le produit.</p></div>
            </header>
            <div className={`${styles.cardBody} space-y-5`}>
              <ProductFields baseUnits={baseUnits} creation onChange={change} state={{ ...state, errors, values }} />
            </div>
          </section>
          <section className={styles.optional}>
            <div className={styles.optionalHeader}>
              <ProductIcon name='box' />
              <label htmlFor='withPackaging'><input aria-controls='pack-fields' aria-expanded={values.withPackaging} checked={values.withPackaging} id='withPackaging' onChange={(event) => togglePackaging(event.target.checked)} type='checkbox' />Ajouter un conditionnement</label>
              <span>Facultatif</span>
            </div>
            <p className={styles.optionalDescription}>Pack, carton… D’autres conditionnements peuvent être ajoutés depuis la fiche, selon vos droits.</p>
            <input name='withPackaging' type='hidden' value={String(values.withPackaging)} />
            {values.withPackaging && (
              <div className={styles.packFields} id='pack-fields'>
                <div className={styles.packGrid}>
                  {['label', 'quantity'].map((name) => (
                    <div key={name}>
                      <label className='block text-sm font-medium text-slate-700' htmlFor={`packaging-${name}`}>
                        {name === 'label' ? 'Libellé du conditionnement' : `Quantité en ${pluralUnit(baseUnits, values.baseUnit)}`} <span className={styles.required}>(obligatoire)</span>
                      </label>
                      <input aria-describedby={`${name === 'quantity' ? 'quantity-help ' : ''}${errors[name] ? `packaging-${name}-error` : ''}`.trim() || undefined}
                        aria-invalid={Boolean(errors[name])} autoComplete='off' className={PRODUCT_INPUT_CLASS}
                        id={`packaging-${name}`} inputMode={name === 'quantity' ? 'numeric' : undefined}
                        max={name === 'quantity' ? 1000000 : undefined} maxLength={name === 'label' ? 100 : undefined}
                        min={name === 'quantity' ? 2 : undefined} name={name} onChange={(event) => change(name, event.target.value)}
                        placeholder={name === 'label' ? 'Ex. Pack de 6' : 'Ex. 6'} required step={name === 'quantity' ? 1 : undefined}
                        type={name === 'quantity' ? 'number' : 'text'} value={values[name]} />
                      {name === 'quantity' && <p className='mt-2 text-xs text-slate-500' id='quantity-help'>Un entier entre 2 et 1 000 000.</p>}
                      {errors[name] && <p className='mt-2 text-sm text-red-700' id={`packaging-${name}-error`}>{errors[name]}</p>}
                    </div>
                  ))}
                </div>
                <p className={styles.conversion}>{conversionText(baseUnits, values)}</p>
              </div>
            )}
          </section>
        </fieldset>
        <EditingButtons note='Les trois champs d’identification sont obligatoires.' onCancel={cancel} pending={isPending} pendingLabel='Création…' submitLabel='Créer le produit' />
      </form>
      <aside className={styles.previewColumn} aria-label='Aperçu du produit saisi'>
        <div className={styles.previewCaption}><span>APERÇU DU PRODUIT</span><span>Brouillon</span></div>
        <section className={styles.preview}>
          <ProductIcon className={styles.previewIcon} name='box' />
          <h2 className={!values.designation.trim() ? styles.placeholder : ''}>{values.designation.trim() || 'Désignation du produit'}</h2>
          <div className={styles.previewMeta}><code className={!values.code.trim() ? styles.placeholder : ''}>{values.code.trim().toLocaleUpperCase('fr') || 'Code à renseigner'}</code><span>{baseUnits.find((unit) => unit.code === values.baseUnit)?.label || 'Unité à choisir'}</span></div>
          <dl className={styles.previewDetails}><div><dt>Prix de vente</dt><dd>À renseigner ensuite</dd></div><div><dt>Stock initial</dt><dd>Aucun stock ajouté</dd></div></dl>
          {values.withPackaging && <p className={styles.conversion}>{conversionText(baseUnits, values)}</p>}
        </section>
        <div className={styles.nextSteps}>
          <h3>Après la création</h3>
          <p>Selon vos droits, la fiche permet de renseigner le prix de vente et d’ajouter d’autres conditionnements. Une réception permet ensuite d’alimenter le stock.</p>
          <small>Cet aperçu n’est pas enregistré.</small>
        </div>
      </aside>
    </div>
  );
};

const ProductForm = ({ baseUnits, canReadProducts }) => {
  const [created, setCreated] = useState(null);
  const [formRevision, setFormRevision] = useState(0);
  const successRef = useRef(null);
  const returnHref = canReadProducts ? '/produits' : '/';
  useEffect(() => {
    if (created) successRef.current?.focus();
    else if (formRevision) document.getElementById('designation')?.focus();
  }, [created, formRevision]);
  return (
    <>
      <nav aria-label='Fil d’Ariane' className={styles.breadcrumb}>
        <EditingLink href={returnHref}>{canReadProducts ? 'Produits' : 'Tableau de bord'}</EditingLink><span aria-hidden='true'>/</span><span aria-current='page'>Nouveau produit</span>
      </nav>
      {!created ? (
        <>
          <header className={styles.hero}><span className={styles.heroIcon}><ProductIcon name='box' /></span><div><p className={styles.eyebrow}>CATALOGUE & STOCK</p><h1>Nouveau produit</h1><p>Identifiez le produit et choisissez son unité de base. Le prix et le stock seront renseignés ensuite.</p></div></header>
          <CreationForm baseUnits={baseUnits} key={formRevision} onCreated={setCreated} returnHref={returnHref} />
        </>
      ) : (
        <section className={`${styles.card} ${styles.success}`}>
          <header className={styles.successHeader}><span><ProductIcon name='check' /></span><h1 ref={successRef} tabIndex={-1}>Produit créé</h1><p>{created.designation}</p></header>
          <div className={styles.cardBody}>
            <dl className={styles.recap}><div><dt>Code produit</dt><dd><code>{created.code}</code></dd></div><div><dt>Unité de base</dt><dd>{baseUnits.find((unit) => unit.code === created.baseUnit)?.label}</dd></div><div><dt>Conditionnement</dt><dd>{created.packaging ? conversionText(baseUnits, { ...created, ...created.packaging }) : 'Aucun pour le moment'}</dd></div></dl>
            <p className={styles.successNote}>Le produit a été ajouté au catalogue. Aucun stock ni prix n’a été ajouté.</p>
            {!canReadProducts && <p className={styles.successNote}>La consultation de la fiche nécessite un droit de lecture.</p>}
            <div className={styles.successActions}>
              {canReadProducts && <EditingLink className={styles.primaryLink} href={`/produits/${created.id}`}>Ouvrir la fiche produit <ProductIcon name='arrow' /></EditingLink>}
              <button onClick={() => { setCreated(null); setFormRevision((revision) => revision + 1); }} type='button'>Créer un autre produit</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
};

export default ProductForm;
