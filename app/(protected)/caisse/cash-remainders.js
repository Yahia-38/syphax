'use client';

import { useId, useState } from 'react';
import { formatCashSignedAmount } from '../../../lib/cash-navigation.js';
import { EditingLink, useEditingSession } from '../components/editing-session.js';
import EditableCard from '../components/editable-card.js';
import CashTourPayment from './cash-tour-payment.js';
import DelivererCashAllocationPreview from './deliverer-cash-allocation-preview.js';
import { CashFilterForm, CashResetLink, CashPageLink } from './cash-workspace.js';
import { useCashNotice } from './cash-form-context.js';
import styles from './cash.module.css';

const Money = ({ value }) => formatCashSignedAmount(value);
const STATUS_LABELS = { CLOSED: 'Terminée', COUNTED: 'Comptée' };

const AllocationForm = ({ onCancel, onSuccess, ...props }) => {
  const [initialKey] = useState(props.confirmationKey);
  const showNotice = useCashNotice();
  return <DelivererCashAllocationPreview {...props} confirmationKey={initialKey} onClose={onCancel} onResolved={(result) => {
    showNotice(`${result.message} Référence : ${result.paymentReference}.`);
    onSuccess(result.message);
  }} />;
};

const TourFinancials = ({ tour }) => <>
  <dl className={styles.tourAmounts}>
    {[
      ['Ventes brutes', tour.grossSalesInCentimes],
      ['Frais', tour.expenseDeclarationStatus === 'DECLARED' ? tour.totalExpensesInCentimes : tour.expenseDeclarationStatus === 'HISTORICAL_MISSING' ? 'Absence historique' : 'Non déclarés'],
      ['Net à remettre', tour.netDueInCentimes],
      ['Encaissé', tour.amountPaidInCentimes],
      ['Reste', tour.remainingDueInCentimes],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'string' ? value : <Money value={value} />}</dd></div>)}
  </dl>
  {tour.expenseDeclarationStatus === 'MISSING' && <p className={styles.expenseNote}>Frais non déclarés : encaisser réduit le maximum de frais encore déclarable.</p>}
</>;

const DelivererTours = ({ remainder, cashRegister, canCreatePayment, canReadTours, onEditingChange, activeTour }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const session = useEditingSession();
  const listId = useId();
  const filtered = remainder.tours.filter((tour) => tour.reference.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')));
  const totalPages = Math.max(1, Math.ceil(filtered.length / 5));
  const activePage = Math.min(page, totalPages);
  const visibleTours = filtered.slice((activePage - 1) * 5, activePage * 5);
  if (activeTour && !visibleTours.some((tour) => tour.id === activeTour.id)) visibleTours.push(remainder.tours.find((tour) => tour.id === activeTour.id) ?? { ...activeTour, remainingDueInCentimes: null });
  const change = (callback) => session.request(callback);
  return <div className={styles.tours}>
    <div className={styles.detailHeader}><button className={styles.detailsToggle} type='button' aria-expanded={open || Boolean(activeTour)} aria-controls={listId} onClick={() => {
      if (open || activeTour) change(() => setOpen(false)); else setOpen(true);
    }}>{open || activeTour ? 'Masquer les tournées' : 'Voir les tournées'}</button>
      {remainder.tours.some((tour) => tour.expenseDeclarationStatus === 'MISSING') && <span>Frais à déclarer sur certaines tournées</span>}
    </div>
    {(open || activeTour) && <div id={listId}>
      <div className={styles.tourSearch} role='search'>
        <label htmlFor={`${listId}-search`}>Référence de tournée</label>
        <input id={`${listId}-search`} type='search' placeholder='Rechercher une tournée' value={query} onChange={(event) => {
          const value = event.target.value;
          change(() => { setQuery(value); setPage(1); });
        }} />
      </div>
      {visibleTours.map((tour) => <EditableCard id={`cash-tour-${tour.id}`} key={tour.id} title={canReadTours ? <EditingLink href={`/tournees/${tour.id}`}>{tour.reference}</EditingLink> : tour.reference}
        description={STATUS_LABELS[tour.status] ?? tour.status} className={styles.tourCard} editLabel='Encaisser cette tournée' editingLabel='Encaissement ciblé'
        headerContent={<span className={`${styles.badge} ${tour.expenseDeclarationStatus === 'DECLARED' ? '' : styles.amberBadge}`}>{tour.expenseDeclarationStatus === 'DECLARED' ? 'Frais déclarés' : tour.expenseDeclarationStatus === 'HISTORICAL_MISSING' ? 'Absence historique de frais' : 'Frais non déclarés'}</span>}
        canEdit={canCreatePayment}
        editDisabled={!cashRegister || !Number.isSafeInteger(tour.remainingDueInCentimes) || tour.remainingDueInCentimes <= 0}
        onEditingChange={(editing) => onEditingChange(editing, tour)}
        formComponent={CashTourPayment} formProps={{ cashRegister, deliverer: remainder.deliverer, tour, confirmationKey: crypto.randomUUID() }}>
        <TourFinancials tour={tour} />
      </EditableCard>)}
      {!visibleTours.length && <p className={styles.empty}>Aucune tournée pour cette référence.</p>}
      <nav className={styles.pagination} aria-label={`Pagination des tournées de ${remainder.deliverer.code}`}>
        <button type='button' disabled={activePage === 1} onClick={() => change(() => setPage(activePage - 1))}>Précédent</button>
        <p>Page {activePage} sur {totalPages}</p>
        <button type='button' disabled={activePage === totalPages} onClick={() => change(() => setPage(activePage + 1))}>Suivant</button>
      </nav>
    </div>}
  </div>;
};

const CashRemainders = ({ anomalies, anomalyCount, canCreatePayment, canReadDeliverers, canReadTours, cashRegister, cashRegisterError, initialConfirmationKey, journalState, page, query, remainders, totalItems, totalPages, totalRemainingDueInCentimes }) => {
  const [active, setActive] = useState(null);
  const visibleRemainders = [...remainders];
  if (active && !visibleRemainders.some((item) => item.deliverer.id === active.remainder.deliverer.id)) visibleRemainders.push({ ...active.remainder, tours: [], remainingDueInCentimes: null });
  return <section className={styles.remainders} aria-labelledby='cash-remainders-title'>
    <div className={styles.sectionHeading}>
      <div><h2 id='cash-remainders-title'>À encaisser</h2><p>Restes actuels des tournées comptées et terminées · après frais déclarés</p></div>
      <span className={styles.sectionMeta}>Indépendant des dates du journal</span>
    </div>
    <CashFilterForm view='restes' className={styles.remainderFilters} role='search'>
      <input type='hidden' name='vue' value='restes' />
      {[['q', journalState.query], ['livreur', journalState.delivererId], ['du', journalState.dateFrom], ['au', journalState.dateTo], ['page', journalState.page]].filter(([, value]) => value).map(([name, value]) => <input key={name} type='hidden' name={name} value={value} />)}
      <div><label htmlFor='cash-remainder-search'>Rechercher un livreur</label><input id='cash-remainder-search' name='resteRecherche' type='search' defaultValue={query} maxLength={100} placeholder='Code ou nom du livreur' /></div>
      <button type='submit'>Rechercher</button>
      {query && <CashResetLink view='restes' />}
    </CashFilterForm>
    <div className={styles.remainderTotal}>
      <div><p className={styles.eyebrow}>{anomalyCount ? 'Total partiel' : 'Total à encaisser'} · résultats de cette recherche</p><strong><Money value={totalRemainingDueInCentimes} /></strong><p>Ce total couvre toutes les pages de résultats, hors tournées incohérentes. Ces restes ne sont pas de l’argent déjà en caisse.</p></div>
      <span className={`${styles.badge} ${styles.amberBadge}`}>{totalItems} livreur{totalItems > 1 ? 's' : ''}</span>
    </div>
    {anomalyCount > 0 && <aside className={styles.warning} aria-label='Anomalies des restes'>
      <strong>{anomalyCount} anomalie{anomalyCount > 1 ? 's' : ''} · tournées exclues du total</strong>
      {anomalies.map((anomaly) => <p key={anomaly.code}>{anomaly.label} : {anomaly.tourReferences.join(', ')}</p>)}
    </aside>}
    {cashRegisterError && <p className={styles.error} role='alert'>{cashRegisterError}{canCreatePayment ? ' Encaissement indisponible.' : ''}</p>}
    <div className={styles.delivererCards}>
      {visibleRemainders.map((remainder) => {
        const blocking = remainder.blockingAnomalies ?? [];
        const partial = blocking.some((anomaly) => anomaly.code !== 'MISSING_COUNTING_DATE');
        const editingChange = (editing, tour = null) => setActive(editing ? { remainder, tour } : null);
        return <EditableCard id={`cash-deliverer-${remainder.deliverer.id}`} key={remainder.deliverer.id} className={styles.delivererCard}
          title={canReadDeliverers ? <EditingLink href={`/livreurs/${remainder.deliverer.id}`}>{remainder.deliverer.name || 'Nom non renseigné'}</EditingLink> : remainder.deliverer.name || 'Nom non renseigné'}
          description={`${remainder.deliverer.code} · ${remainder.tourCount} tournée${remainder.tourCount > 1 ? 's' : ''} concernée${remainder.tourCount > 1 ? 's' : ''}`}
          titleIcon={<span className={styles.avatar} aria-hidden='true'>{(remainder.deliverer.name || remainder.deliverer.code).split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('fr')}</span>}
          headerAside={<div className={styles.delivererDue}><span>{partial ? 'Reste connu · partiel' : 'Reste à payer'}</span><strong><Money value={remainder.remainingDueInCentimes} /></strong></div>}
          editLabel='Encaisser le livreur' editingLabel='Encaissement en cours' trackDraft keepReadContent
          canEdit={canCreatePayment}
          editDisabled={!cashRegister || Boolean(blocking.length) || !Number.isSafeInteger(remainder.remainingDueInCentimes) || remainder.remainingDueInCentimes <= 0}
          onEditingChange={(editing) => editingChange(editing)}
          formComponent={AllocationForm} formProps={{ cashRegister, remainder, confirmationKey: initialConfirmationKey }}>
          {blocking.length > 0 && <aside className={styles.warning}><strong>Encaissement du livreur indisponible : répartition globale impossible.</strong>{blocking.map((anomaly) => <p key={`${anomaly.code}-${anomaly.tourReference}`}>{anomaly.label} : {anomaly.tourReference}</p>)}</aside>}
          <DelivererTours remainder={remainder} cashRegister={cashRegister} canCreatePayment={canCreatePayment} canReadTours={canReadTours}
            onEditingChange={editingChange} activeTour={active?.remainder.deliverer.id === remainder.deliverer.id ? active.tour : null} />
        </EditableCard>;
      })}
    </div>
    {!remainders.length && !active && <div className={styles.empty}><h3>{query ? 'Aucun livreur pour cette recherche' : anomalyCount ? 'Des restes restent à vérifier' : 'Tous les restes calculables sont soldés'}</h3><p>{query ? 'Modifiez la recherche de livreur.' : anomalyCount ? 'Les anomalies ne permettent pas de conclure que tous les livreurs sont soldés.' : 'Aucune tournée comptée ou terminée ne présente de reste positif calculable.'}</p></div>}
    <nav className={styles.pagination} aria-label='Pagination des restes à encaisser'>
      {page === 1 ? <span aria-disabled='true'>Précédent</span> : <CashPageLink view='restes' page={page - 1}>Précédent</CashPageLink>}
      <p>{totalItems} résultat{totalItems > 1 ? 's' : ''} · page {page} / {totalPages}</p>
      {page === totalPages ? <span aria-disabled='true'>Suivant</span> : <CashPageLink view='restes' page={page + 1}>Suivant</CashPageLink>}
    </nav>
  </section>;
};

export default CashRemainders;
