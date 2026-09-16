import { randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import {
  CASH_PAYMENT_FORM_PERMISSIONS,
  CASH_READ_PERMISSION,
  getTourPaymentPreview,
} from '../../../../lib/cash-payments.js';
import {
  TOUR_CANCEL_PERMISSION,
  getTourCancellationPreview,
} from '../../../../lib/tour-cancellations.js';
import { listProducts } from '../../../../lib/products.js';
import { requirePermission } from '../../../../lib/sessions.js';
import {
  TOUR_CLOSE_PERMISSIONS,
  getTourClosurePreview,
} from '../../../../lib/tour-closures.js';
import {
  TOUR_COUNTING_CONFIRM_PERMISSIONS,
  TOUR_COUNTING_PERMISSIONS,
  getTourCountingSheet,
} from '../../../../lib/tour-countings.js';
import {
  TOUR_EXPENSE_FORM_PERMISSIONS,
  TOUR_EXPENSE_PREVIEW_PERMISSIONS,
  getTourExpensePreview,
} from '../../../../lib/tour-expenses.js';
import { getTourLoadingPreview } from '../../../../lib/tour-loadings.js';
import {
  TOUR_STATUS_CANCELLED,
  TOUR_STATUS_CLOSED,
  TOUR_STATUS_COUNTED,
  TOUR_STATUS_LOADED,
  TOUR_STATUS_PREPARATION,
  formatTourCreatedAt,
  formatTourDate,
  formatTourStatus,
  getTourById,
  validateTourReturnHref,
} from '../../../../lib/tours.js';
import TourDetail from './tour-detail.js';
import TourOperationCard from './tour-operation-card.js';
import { EditingLink } from '../../components/editing-session.js';
import { readTourView } from '../../../../lib/tour-detail-navigation.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import styles from './tour-detail.module.css';
import TourProductList from './tour-product-list.js';
import TourCountingSheet from './tour-counting-sheet.js';
import TourExpensePreview from './tour-expense-preview.js';
import TourPaymentPreview from './tour-payment-preview.js';

export const metadata = {
  title: 'Fiche de tournée | Syphax',
};

const TourPage = async ({ params, searchParams }) => {
  const session = await requirePermission('tours.read');
  const [{ id }, query = {}, permissions] = await Promise.all([
    params,
    searchParams,
    getUserPermissions(session.userId),
  ]);
  const canReadPricing = permissions.includes('pricing.read');
  const tour = await getTourById(id, {
    includePricing: canReadPricing,
    userId: session.userId,
  });

  if (!tour) {
    notFound();
  }

  const canReadDeliverer = permissions.includes('deliverers.read');
  const canAddTourProducts = [
    'tours.products.add',
    'products.read',
    'packaging.read',
  ].every((permission) => permissions.includes(permission));
  const canReleaseTourProducts = permissions.includes(
    'tours.products.release',
  );
  const canLoadTour = permissions.includes('tours.load') && canReadPricing;
  const canCancelTour = permissions.includes(TOUR_CANCEL_PERMISSION);
  const canPrepareCounting = TOUR_COUNTING_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const canConfirmCounting = TOUR_COUNTING_CONFIRM_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const canReadCash = permissions.includes(CASH_READ_PERMISSION);
  const canCreateCashPayment = CASH_PAYMENT_FORM_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const canCloseTour = TOUR_CLOSE_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const canReadTourExpenses = TOUR_EXPENSE_PREVIEW_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const canDeclareTourExpenses = TOUR_EXPENSE_FORM_PERMISSIONS.every(
    (permission) => permissions.includes(permission),
  );
  const products = canAddTourProducts && tour.status === TOUR_STATUS_PREPARATION
    ? await listProducts({ includePackagings: true, onlyUsable: true })
    : [];
  const loadingPreview = canLoadTour
    && tour.status === TOUR_STATUS_PREPARATION
    && tour.lines.length > 0
    ? await getTourLoadingPreview({ tourId: tour.id, userId: session.userId })
    : null;
  const cancellationPreview = canCancelTour
    && tour.status === TOUR_STATUS_PREPARATION
    ? await getTourCancellationPreview({
        tourId: tour.id,
        userId: session.userId,
      })
    : null;
  const countingSheet = canPrepareCounting
    && [TOUR_STATUS_LOADED, TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED]
      .includes(tour.status)
    ? await getTourCountingSheet({ tourId: tour.id, userId: session.userId })
    : null;
  const paymentPreview = canReadCash
    && [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status)
    ? await getTourPaymentPreview({ tourId: tour.id, userId: session.userId })
    : null;
  const expensePreview = canReadTourExpenses
    && [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status)
    ? await getTourExpensePreview({
        tourId: tour.id,
        userId: session.userId,
      })
    : null;
  const closurePreview = canCloseTour && tour.status === TOUR_STATUS_COUNTED
    ? await getTourClosurePreview({ tourId: tour.id, userId: session.userId })
    : null;
  const returnHref = validateTourReturnHref(query.retour, tour.delivererId);

  const counted = [TOUR_STATUS_COUNTED, TOUR_STATUS_CLOSED].includes(tour.status);
  const preparation = tour.status === TOUR_STATUS_PREPARATION;
  const cancelled = tour.status === TOUR_STATUS_CANCELLED;
  const financial = paymentPreview && !paymentPreview.errors?.form ? paymentPreview : null;
  const money = (value) => Number.isSafeInteger(value) && value >= 0 ? formatReceptionMoney(value) : 'Non calculable';
  const expenseState = financial?.expenseDeclarationStatus ?? expensePreview?.declarationStatus;
  const remaining = financial?.remainingDueInCentimes;
  const canPay = canCreateCashPayment && Number.isSafeInteger(remaining) && remaining > 0 && Boolean(financial?.cashRegister);
  const canDeclare = canDeclareTourExpenses && expensePreview && !expensePreview.errors?.form && !expensePreview.declaration && expensePreview.declarationStatus !== 'HISTORICAL_MISSING' && !cancelled;
  const canCount = countingSheet && !countingSheet.recorded && !countingSheet.errors?.form && tour.status === TOUR_STATUS_LOADED;
  const priority = canCount
    ? { target: 'comptage', view: 'operations', label: canConfirmCounting ? 'Saisir les retours' : 'Prévisualiser les retours' }
    : canDeclare ? { target: 'frais', view: 'operations', label: 'Déclarer les frais' }
    : canPay ? { target: 'versements', view: 'operations', label: 'Encaisser' } : null;
  const countingProps = { canConfirm: canConfirmCounting, initialConfirmationKey: randomUUID(), sheet: countingSheet ? { ...countingSheet, tourReference: tour.reference, deliverer: { code: tour.delivererCode, name: tour.delivererName } } : null, tourId: tour.id };
  const expenseProps = { canDeclareExpenses: canDeclareTourExpenses, initialConfirmationKey: randomUUID(), preview: expensePreview, tourId: tour.id };
  const paymentProps = { canCreatePayment: canCreateCashPayment, initialConfirmationKey: randomUUID(), preview: paymentPreview, tourId: tour.id };
  const trace = [
    ['Créée par', tour.createdBy ?? 'Compte indisponible'], ['Créée le', formatTourCreatedAt(tour.createdAt)],
    ...(!preparation && !cancelled ? [['Chargée par', tour.loadedBy ?? 'Compte indisponible'], ['Chargée le', formatTourCreatedAt(tour.loadedAt)]] : []),
    ...(counted ? [['Comptée par', tour.countedBy ?? 'Compte indisponible'], ['Comptée le', formatTourCreatedAt(tour.countedAt)]] : []),
    ...(expensePreview?.declaration ? [['Frais déclarés par', expensePreview.declaration.declaredBy ?? 'Compte indisponible'], ['Frais déclarés le', formatTourCreatedAt(expensePreview.declaration.declaredAt)]] : []),
    ...(tour.status === TOUR_STATUS_CLOSED ? [['Terminée par', tour.closedBy ?? 'Compte indisponible'], ['Terminée le', formatTourCreatedAt(tour.closedAt)]] : []),
    ...(cancelled ? [['Annulée par', tour.cancelledBy ?? 'Compte indisponible'], ['Annulée le', formatTourCreatedAt(tour.cancelledAt)], ['Motif d’annulation', tour.cancellationReason]] : []),
  ];

  return <TourDetail tourId={tour.id} returnHref={returnHref} defaultView={readTourView(query.vue, tour.status)} priority={priority}
    header={<header>
      {canReadDeliverer && <EditingLink className={styles.back} href={returnHref}>← Retour à la fiche livreur</EditingLink>}
      <p className={styles.eyebrow}>Fiche tournée</p>
      <h1>{tour.reference}</h1>
      <p className={styles.meta}><span className={styles.badge} data-status={tour.status}>{formatTourStatus(tour.status)}</span><span>{tour.delivererName} · {tour.delivererCode}</span><span>Prévue le {formatTourDate(tour.plannedDate)}</span></p>
    </header>}
    shortcuts={[
      { label: 'Chargement', state: cancelled ? 'Annulée' : preparation ? 'En préparation' : 'Confirmé', target: 'chargement', view: 'produits' },
      { label: 'Comptage', state: counted ? 'Enregistré' : tour.status === TOUR_STATUS_LOADED ? 'À saisir' : cancelled ? 'Non réalisé' : 'Après chargement', target: 'comptage', view: 'operations' },
      { label: 'Frais', state: expenseState === 'DECLARED' ? 'Déclarés' : expenseState === 'HISTORICAL_MISSING' ? 'Absence historique' : counted ? expenseState === 'MISSING' ? 'À déclarer' : 'Selon vos droits' : cancelled ? 'Non déclarés' : 'Après comptage', target: 'frais', view: 'operations' },
      { label: 'Versements', state: Number.isSafeInteger(remaining) ? remaining === 0 ? 'Soldée' : 'Reste à encaisser' : counted ? 'Selon vos droits' : 'Après comptage', target: 'versements', view: 'operations' },
    ]}
    financial={<aside className={styles.financial} aria-label='Situation financière de cette tournée'>
      <h2>Reste à payer</h2>
      <p className={styles.due}>{!counted ? 'Disponible après comptage' : !canReadCash ? 'Lecture de caisse requise' : money(remaining)}</p>
      {financial && <dl>{[
        ['Ventes brutes', money(financial.grossSalesInCentimes)],
        ['Frais déclarés', expenseState === 'DECLARED' ? money(financial.totalExpensesInCentimes) : expenseState === 'HISTORICAL_MISSING' ? 'Absence historique' : 'Non déclarés'],
        ['Net à remettre', money(financial.netDueInCentimes)], ['Total encaissé', money(financial.amountPaidInCentimes)],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      <p>Montants enregistrés de cette tournée uniquement. Le solde global du livreur et le tiroir-caisse sont distincts.</p>
    </aside>}
    operations={<>
      <TourOperationCard id='comptage' kind='counting' title='Comptage & retours'
        summary={counted ? 'Comptage définitif · lecture seule' : `${tour.lines.length} références · retours physiques en unités de base`}
        canEdit={Boolean(canCount)} editLabel={canConfirmCounting ? 'Saisir les retours' : 'Prévisualiser les retours'} operationProps={countingProps}>
        {countingSheet?.recorded ? <details className={styles.read}><summary>Ventes brutes : {money(countingSheet.totalDueInCentimes)} · Voir le comptage</summary><TourCountingSheet {...countingProps} embedded /></details>
          : <p className={styles.read}>{cancelled ? 'Tournée annulée · aucune saisie possible.' : preparation ? 'Confirmez le chargement pour saisir les retours.' : !canPrepareCounting ? 'La lecture du comptage nécessite les droits de préparation et de prix.' : countingSheet?.errors?.form ?? 'Saisissez chaque retour, y compris zéro. Le comptage enregistré sera définitif.'}</p>}
      </TourOperationCard>
      <TourOperationCard id='frais' kind='expenses' title='Frais de tournée' summary={cancelled ? 'Tournée annulée · lecture seule' : counted && !expenseState ? 'Lecture selon vos droits' : expenseState === 'DECLARED' ? 'Déclaration définitive · lecture seule' : expenseState === 'HISTORICAL_MISSING' ? 'Absence historique' : 'À déclarer · choix explicite avec ou sans frais'}
        canEdit={Boolean(canDeclare)} editLabel='Déclarer les frais' operationProps={expenseProps}>
        {expensePreview && (expensePreview.declaration || expensePreview.declarationStatus === 'HISTORICAL_MISSING' || expensePreview.errors?.form) ? <TourExpensePreview {...expenseProps} canDeclareExpenses={false} embedded /> : <p className={styles.read}>{!counted ? 'Disponible après comptage.' : canReadTourExpenses ? 'Non déclarés. Les encaissements restent possibles ; la déclaration est nécessaire pour clôturer.' : 'Les motifs détaillés nécessitent les droits de lecture des frais.'}</p>}
      </TourOperationCard>
      <TourOperationCard id='versements' kind='payment' title='Versements en espèces' summary={Number.isSafeInteger(remaining) && remaining === 0 ? 'Soldée · aucun reste à encaisser' : 'Enregistrer le montant réellement reçu'}
        canEdit={canPay} editLabel='Encaisser' operationProps={paymentProps}>
        {paymentPreview ? <TourPaymentPreview {...paymentProps} canCreatePayment={false} embedded /> : <p className={styles.read}>{!counted ? 'Disponible après comptage.' : 'La lecture des versements nécessite le droit de caisse.'}</p>}
      </TourOperationCard>
      <TourOperationCard id='cloture' kind='closing' title='Clôture opérationnelle' summary={tour.status === TOUR_STATUS_CLOSED ? 'Tournée terminée' : 'Comptage définitif et déclaration de frais requis'}
        canEdit={Boolean(closurePreview && !closurePreview.errors?.form && !closurePreview.errors?.expenses && closurePreview.digest)} editLabel='Terminer la tournée' operationProps={{ preview: closurePreview, tourId: tour.id }}>
        <p className={styles.read}>{tour.status === TOUR_STATUS_CLOSED ? 'Les versements restent possibles tant qu’un reste fiable est dû.' : cancelled ? 'Tournée annulée.' : !counted ? 'Le comptage doit être enregistré.' : expenseState === 'MISSING' ? 'Déclarez les frais, y compris explicitement « Aucun frais ».' : !canCloseTour ? 'Le droit de clôture est nécessaire.' : closurePreview?.errors?.form ?? 'La clôture est possible avec un reste à payer. Elle ne crée aucun encaissement.'}</p>
      </TourOperationCard>
    </>}
    products={<>
      <TourOperationCard id='chargement' kind='loading' title='Chargement' summary={cancelled ? 'Tournée annulée' : preparation ? 'Réservations · le stock physique reste disponible jusqu’au chargement' : 'Chargement confirmé · prix historiques figés'}
        canEdit={Boolean(loadingPreview)} editLabel='Vérifier le chargement' operationProps={{ preview: loadingPreview, tourId: tour.id }}>
        <p className={styles.read}>{preparation ? `${tour.lines.length} références réservées. Le chargement complet vérifie les quantités et les prix avant la sortie de stock.` : 'Les produits chargés ne sont plus modifiables. Leur valeur est distincte des ventes et du reste à payer.'}</p>
      </TourOperationCard>
      {canAddTourProducts && preparation && <TourOperationCard id='ajout-produit' kind='product' title='Réserver un produit' summary='Quantité directe ou conversion depuis un conditionnement'
        canEdit editLabel='Ajouter un produit' operationProps={{ existingProductIds: tour.lines.map((line) => line.productId), initialAdditionKey: randomUUID(), products, tourId: tour.id }} />}
      {tour.lines.length > 0 ? <TourProductList canReadPricing={canReadPricing} canRelease={canReleaseTourProducts && preparation} cancelled={cancelled} lines={tour.lines} loaded={!preparation && !cancelled} tourId={tour.id} tourReference={tour.reference} delivererName={tour.delivererName} />
        : <p className={styles.trace}>Aucun produit réservé dans cette tournée.</p>}
      {(cancellationPreview || cancelled) && <TourOperationCard id='annulation' kind='cancellation' title='Annulation de la tournée' summary={cancelled ? 'Tournée annulée · réservations libérées' : 'Libérer toutes les réservations avec un motif obligatoire'}
        canEdit={Boolean(cancellationPreview)} editLabel='Annuler la tournée' operationProps={{ preview: cancellationPreview, tourId: tour.id }} />}
    </>}
    history={<section className={styles.trace}><h2>Traçabilité</h2><dl>{trace.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Indisponible'}</dd></div>)}</dl></section>}
  />;
};

export default TourPage;
