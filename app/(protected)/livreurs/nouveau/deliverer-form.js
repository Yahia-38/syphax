'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useInlineSave } from '../../components/editable-card.js';
import { EditingLink, useEditingSession } from '../../components/editing-session.js';
import DelivererIcon from '../deliverer-icon.js';
import { createDeliverer } from './actions.js';
import styles from './deliverer-form.module.css';

const EMPTY_VALUES = { code: '', name: '', phone: '' };
const INITIAL_STATE = { errors: {}, message: null, revision: 0, values: EMPTY_VALUES };
const FIELDS = [
  { name: 'code', label: 'Code', placeholder: 'Ex. LIV-018', autoComplete: 'off', help: 'Identifiant unique, enregistré en majuscules. Sans espace intérieur · 50 caractères maximum.' },
  { name: 'name', label: 'Nom du livreur', placeholder: 'Ex. Amine Benali', autoComplete: 'name', help: 'Le nom affiché sur sa fiche et ses tournées · 150 caractères maximum.' },
  { name: 'phone', label: 'Téléphone', placeholder: 'Ex. 0550 00 00 00', autoComplete: 'tel', help: 'Vous pourrez le compléter plus tard · 30 caractères maximum.' },
];

const DelivererPreview = ({ values, saved = false }) => {
  const name = values.name.trim();
  const code = values.code.trim().toLocaleUpperCase('fr');
  const initials = name.split(/\s+/u).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]).join('').toLocaleUpperCase('fr') || '—';
  return (
    <aside className={styles.side} aria-label={saved ? 'Fiche créée' : 'Aperçu du livreur saisi'}>
      <section className={styles.card}>
        <div className={styles.preview}>
          <p className={styles.eyebrow}>{saved ? 'Fiche créée' : 'Aperçu de la fiche'}</p>
          <div className={styles.person}>
            <span className={styles.initials} aria-hidden='true'>{initials}</span>
            <div><h3>{name || 'Nom du livreur'}</h3><code>{code || 'Code à renseigner'}</code></div>
          </div>
          <dl className={styles.details}>
            <div><dt>Téléphone</dt><dd>{values.phone.trim() || 'Non renseigné'}</dd></div>
            <div><dt>{saved ? 'Statut' : 'Statut à la création'}</dt><dd><span className={styles.active}>Actif</span></dd></div>
          </dl>
        </div>
        <p className={styles.previewFooter}>{saved ? 'La fiche est enregistrée.' : 'Aperçu uniquement · Rien n’est encore enregistré.'}</p>
      </section>
      <p className={styles.notice}>Cette fiche représente un livreur dans votre activité. Elle ne crée pas de compte de connexion.</p>
      <div className={styles.nextSteps}><h3>Et ensuite ?</h3><p>Retrouvez ses informations et ses opérations dans sa fiche, selon vos autorisations.</p><p>La création de cette fiche n’ouvre aucune tournée.</p></div>
    </aside>
  );
};

const CreationForm = ({ returnHref, onCreated, focusOnMount }) => {
  const [values, setValues] = useState({ ...EMPTY_VALUES });
  const activeRef = useRef({ dirty: false, pending: false, discard: () => {} });
  const session = useEditingSession();
  const register = session.register;
  const onPending = useCallback((pending) => { activeRef.current.pending = pending; }, []);
  const onSuccess = useCallback((message, result) => {
    activeRef.current.dirty = false;
    onCreated(result.deliverer);
  }, [onCreated]);
  const { state, pending, formRef, save } = useInlineSave({
    action: createDeliverer, initialState: INITIAL_STATE, onSuccess, onPending,
    failureMessage: 'La création du livreur est momentanément indisponible.',
  });
  useLayoutEffect(() => {
    const active = activeRef.current;
    active.discard = () => {
      active.dirty = false;
      setValues({ ...EMPTY_VALUES });
    };
    return register(active);
  }, [register]);
  useEffect(() => {
    if (focusOnMount) formRef.current?.querySelector('[name="code"]')?.focus();
  }, [focusOnMount, formRef]);

  return (
    <div className={styles.grid}>
      <section className={`${styles.card} ${styles.creation}`} aria-labelledby='identification-title'>
        <header className={styles.cardHeader}><div><h2 id='identification-title'>Identification</h2><p>Les champs Code et Nom sont obligatoires.</p></div><span className={styles.badge}>Création</span></header>
        <form noValidate ref={formRef} aria-busy={pending} onSubmit={(event) => {
          event.preventDefault();
          // Capture every field before the save lifecycle disables the fieldset.
          save(new FormData(event.currentTarget));
        }}>
          <div className={styles.formBody}>
            {state.errors.form && <p className={styles.errorNotice} role='alert' tabIndex={-1}>{state.errors.form} Vos informations sont conservées.</p>}
            {FIELDS.some(({ name }) => state.errors[name]) && <p className='sr-only' role='alert'>Vérifiez les champs signalés dans le formulaire.</p>}
            <fieldset disabled={pending} className={styles.fields}>
              {FIELDS.map(({ name, label, placeholder, autoComplete, help }) => (
                <div className={styles.field} key={name}>
                  <label htmlFor={name}>{label}{name === 'phone' && <span>Facultatif</span>}</label>
                  <input id={name} name={name} value={values[name]} type={name === 'phone' ? 'tel' : 'text'}
                    autoComplete={autoComplete} spellCheck={name === 'code' ? false : undefined}
                    required={name !== 'phone'} placeholder={placeholder}
                    className={name === 'code' ? styles.codeInput : undefined}
                    aria-invalid={Boolean(state.errors[name])}
                    aria-describedby={`${name}-help${state.errors[name] ? ` ${name}-error` : ''}`}
                    onChange={(event) => {
                      const next = { ...values, [name]: event.target.value };
                      activeRef.current.dirty = Object.values(next).some((value) => value !== '');
                      setValues(next);
                    }} />
                  <p className={styles.help} id={`${name}-help`}>{help}</p>
                  {state.errors[name] && <p className={styles.fieldError} id={`${name}-error`}>{state.errors[name]}</p>}
                </div>
              ))}
            </fieldset>
          </div>
          <div className={styles.actions}>
            <small>{pending ? 'Enregistrement en cours…' : 'Le livreur sera créé actif.'}</small>
            <button disabled={pending} type='button' onClick={() => session.request(() => {
              if (returnHref) session.router.push(returnHref);
              else {
                // Remount only after an explicit discard, never after an error.
                onCreated(null);
              }
            })}>Annuler</button>
            <button className={styles.primary} disabled={pending} type='submit'>{pending ? 'Création…' : 'Créer le livreur'}</button>
          </div>
        </form>
      </section>
      <DelivererPreview values={values} />
    </div>
  );
};

const DelivererForm = ({ returnHref, canReadDeliverers }) => {
  const [created, setCreated] = useState(null);
  const [revision, setRevision] = useState(0);
  const successRef = useRef(null);
  const onCreated = useCallback((deliverer) => {
    setCreated(deliverer);
    if (!deliverer) setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (created) successRef.current?.focus();
  }, [created]);

  return (
    <>
      <nav className={styles.breadcrumb} aria-label='Fil d’Ariane'>
        {canReadDeliverers ? <EditingLink href={returnHref}>← Livreurs</EditingLink> : <span>Livreurs</span>}
        <span aria-hidden='true'>/</span><span aria-current='page'>Nouveau livreur</span>
      </nav>
      <header className={styles.hero}><span className={styles.heroIcon}><DelivererIcon name='add' /></span><div><h1>Nouveau livreur</h1><p>Ajoutez un livreur pour le retrouver dans votre activité.</p></div></header>
      {!created ? <CreationForm key={revision} focusOnMount={revision > 0} onCreated={onCreated} returnHref={returnHref} /> : (
        <div className={styles.grid}>
          <section className={`${styles.card} ${styles.saved}`} aria-label='Livreur créé' ref={successRef} tabIndex={-1}>
            <p className={styles.successNotice} role='status'>Le livreur a été créé avec succès.</p>
            <div className={styles.savedTitle}><span><DelivererIcon name='check' /></span><div><h2>{created.name}</h2><small>La fiche est enregistrée.</small></div></div>
            <dl className={`${styles.details} ${styles.savedDetails}`}>
              <div><dt>Code</dt><dd>{created.code}</dd></div>
              <div><dt>Téléphone</dt><dd>{created.phone || 'Non renseigné'}</dd></div>
              <div><dt>Statut</dt><dd><span className={styles.active}>{created.active ? 'Actif' : 'Désactivé'}</span></dd></div>
            </dl>
            <div className={styles.successActions}>
              {canReadDeliverers && <EditingLink className={styles.primary} href={`/livreurs/${created.id}?${new URLSearchParams({ retour: returnHref })}`}>Ouvrir la fiche →</EditingLink>}
              <button onClick={() => onCreated(null)} type='button'>Créer un autre livreur</button>
            </div>
            <p className={styles.help}>{canReadDeliverers ? 'Les informations restent modifiables depuis la fiche, selon vos autorisations.' : 'Votre profil permet de créer des livreurs, sans accès à leurs fiches.'}</p>
          </section>
          <DelivererPreview values={created} saved />
        </div>
      )}
    </>
  );
};

export default DelivererForm;
