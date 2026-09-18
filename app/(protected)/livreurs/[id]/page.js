import { randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import { CASH_READ_PERMISSION, getDelivererCashSummary } from '../../../../lib/cash-payments.js';
import {
  DELIVERER_CREDIT_LIMIT_READ_PERMISSION,
  DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION,
  getDelivererCreditExposure,
  getDelivererCreditLimit,
} from '../../../../lib/deliverer-credit-limits.js';
import { getDelivererTabs, readDelivererTab } from '../../../../lib/deliverer-detail-navigation.js';
import { getDelivererObjectiveDashboard } from '../../../../lib/deliverer-monthly-achievement.js';
import { readObjectiveAchievementState, readObjectiveHistoryState } from '../../../../lib/deliverer-objective-calculations.js';
import { DELIVERER_OBJECTIVE_READ_PERMISSION, DELIVERER_OBJECTIVE_UPDATE_PERMISSION, getDelivererObjectives } from '../../../../lib/deliverer-objectives.js';
import { formatDelivererCreatedAt, getDelivererById, requireDelivererEditPermission, validateDelivererListHref } from '../../../../lib/deliverers.js';
import { requirePermission } from '../../../../lib/sessions.js';
import { buildDelivererToursHref, formatTourDateInput, listToursByDeliverer, readDelivererTourListState } from '../../../../lib/tours.js';
import { EditingLink, EditingSessionProvider } from '../../components/editing-session.js';
import Tabs from '../../components/tabs.js';
import DelivererEditForm from './deliverer-edit-form.js';
import DelivererCreditLimitForm from './deliverer-credit-limit-form.js';
import DelivererObjectiveForm from './deliverer-objective-form.js';
import DelivererObjectiveHistory from './deliverer-objective-history.js';
import DelivererMonthlyAchievement from './deliverer-monthly-achievement.js';
import DelivererMonthlyHistory from './deliverer-monthly-history.js';
import { DelivererCashSummary, DelivererExposure } from './deliverer-overview.js';
import DelivererStatusButton from './deliverer-status-button.js';
import DelivererTourList from './deliverer-tour-list.js';
import TourCreateButton from './tour-create-button.js';
import styles from './deliverer-detail.module.css';

export const metadata = { title: 'Fiche livreur | Syphax' };

const DelivererPage = async ({ params, searchParams }) => {
  const session = await requirePermission('deliverers.read');
  const [{ id }, query = {}, permissions] = await Promise.all([params, searchParams, getUserPermissions(session.userId)]);
  const canUpdateDeliverer = permissions.includes('deliverers.update');
  const canUpdateDelivererStatus = permissions.includes('deliverers.status.update');
  const canReadCreditLimit = permissions.includes(DELIVERER_CREDIT_LIMIT_READ_PERMISSION);
  const canUpdateCreditLimit = permissions.includes(DELIVERER_CREDIT_LIMIT_UPDATE_PERMISSION);
  const canCreateTour = permissions.includes('tours.create');
  const canReadCash = permissions.includes(CASH_READ_PERMISSION);
  const canReadCompleteCreditExposure = canReadCreditLimit && canReadCash && permissions.includes('pricing.read');
  const canReadTours = permissions.includes('tours.read');
  const canReadObjectives = permissions.includes(DELIVERER_OBJECTIVE_READ_PERMISSION);
  const canUpdateObjectives = permissions.includes(DELIVERER_OBJECTIVE_UPDATE_PERMISSION);
  const editing = (Array.isArray(query.modifier) ? query.modifier[0] : query.modifier) === '1';
  await requireDelivererEditPermission({ editing, userId: session.userId });
  const deliverer = await getDelivererById(id, { userId: session.userId });
  if (!deliverer) notFound();

  const tabs = getDelivererTabs({ canReadCash, canReadCreditLimit, canReadObjectives, canReadTours });
  const activeTab = readDelivererTab(query, tabs);
  const returnHref = validateDelivererListHref(query.retour);
  const tourListState = readDelivererTourListState(query);
  const objectiveHistoryState = readObjectiveHistoryState(query);
  const achievementState = readObjectiveAchievementState(query);
  const [standaloneCashSummary, creditLimitResult, tourList, objectives, dashboard] = await Promise.all([
    activeTab === 'ensemble' && canReadCash && !canReadCompleteCreditExposure
      ? getDelivererCashSummary({ delivererId: deliverer.id, userId: session.userId }) : null,
    activeTab === 'ensemble' && canReadCompleteCreditExposure
      ? getDelivererCreditExposure({ delivererId: deliverer.id, userId: session.userId })
      : activeTab === 'ensemble' && canReadCreditLimit
        ? getDelivererCreditLimit({ delivererId: deliverer.id, userId: session.userId }) : null,
    activeTab === 'tournees' && canReadTours
      ? listToursByDeliverer({ delivererId: deliverer.id, ...tourListState, userId: session.userId }) : null,
    activeTab === 'objectifs' && canReadObjectives
      ? getDelivererObjectives({ delivererId: deliverer.id, ...objectiveHistoryState, userId: session.userId }) : null,
    activeTab === 'objectifs' && canReadObjectives
      ? getDelivererObjectiveDashboard({ delivererId: deliverer.id, userId: session.userId, searchParams: query }) : null,
  ]);
  const cashSummary = creditLimitResult?.cashSummary ?? standaloneCashSummary;
  const objectiveNavigationState = { ...objectiveHistoryState, ...(dashboard?.monthlyHistory ?? achievementState) };
  const hrefForTab = (nextTab) => buildDelivererToursHref({ delivererId: deliverer.id, ...(tourList ?? tourListState), ...objectiveNavigationState, returnHref, tab: nextTab });
  const currentHref = hrefForTab(activeTab);
  const latestStatusChange = deliverer.statusHistory.at(-1);
  const trace = [
    ['Création du livreur', deliverer.createdAt, deliverer.createdBy],
    ...(deliverer.updatedAt ? [['Dernière modification', deliverer.updatedAt, deliverer.updatedBy]] : []),
    ...(latestStatusChange ? [[`Dernier changement de statut · ${latestStatusChange.active ? 'Actif' : 'Désactivé'}`, latestStatusChange.changedAt, latestStatusChange.changedBy]] : []),
  ].reverse();

  return (
    <EditingSessionProvider protectNavigation>
      <main className={`${styles.page} mx-auto w-full max-w-7xl px-4 sm:px-6`}>
        <nav className={styles.breadcrumb} aria-label='Fil d’Ariane'><EditingLink href={returnHref}>← Retour aux livreurs</EditingLink><span aria-hidden='true'>/</span><span>Fiche livreur</span></nav>
        <header className={styles.hero}>
          <div className={styles.heroMain}>
            <div className={styles.avatar} aria-hidden='true'>{deliverer.name.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0]).join('').toLocaleUpperCase('fr')}</div>
            <div className={styles.heroText}><p className={styles.eyebrow}>Fiche livreur</p><h1>{deliverer.name}</h1>
              <div className={styles.meta}><code>{deliverer.code}</code><span className={deliverer.active ? styles.active : styles.inactive}>{deliverer.active ? 'Actif' : 'Désactivé'}</span>{deliverer.phone && <span>{deliverer.phone}</span>}</div>
            </div>
          </div>
          {deliverer.active && canCreateTour && <TourCreateButton key={currentHref} creationKey={randomUUID()} deliverer={{ code: deliverer.code, id: deliverer.id, name: deliverer.name }} initialPlannedDate={formatTourDateInput(new Date())} returnHref={currentHref} />}
        </header>
        {!deliverer.active && <div className={styles.inactiveBanner}><div><strong>Livreur désactivé</strong><p>La création de nouvelles tournées est indisponible. La fiche, les tournées et les montants dus sont conservés.</p></div>{canUpdateDelivererStatus && <DelivererStatusButton key={currentHref} deliverer={deliverer} returnHref={currentHref} />}</div>}
        <Tabs activeTab={activeTab} buildHref={hrefForTab} label='Sections de la fiche livreur' tabs={tabs} />
        {activeTab === 'ensemble' && <div className={styles.overview}>
          {cashSummary && <DelivererCashSummary summary={cashSummary} />}
          {creditLimitResult && <div className={styles.creditGrid}>
            <DelivererCreditLimitForm canUpdate={canUpdateCreditLimit} creditLimit={creditLimitResult.creditLimit} delivererId={deliverer.id} />
            {creditLimitResult.exposure && <DelivererExposure exposure={creditLimitResult.exposure} creditLimit={creditLimitResult.creditLimit} />}
          </div>}
          {canReadTours && <EditingLink className={styles.overviewLink} href={hrefForTab('tournees')}>Consulter les tournées ↗</EditingLink>}
        </div>}
        {activeTab === 'tournees' && tourList && <><DelivererTourList delivererId={deliverer.id} delivererName={deliverer.name} returnHref={returnHref} {...tourList} /><p className={styles.scope}>Le statut décrit l’avancement de la tournée. Il ne représente pas son état de paiement.</p></>}
        {activeTab === 'objectifs' && objectives && <div className={styles.overview}>
          {dashboard?.achievement && <DelivererMonthlyAchievement achievement={dashboard.achievement} delivererId={deliverer.id} returnHref={returnHref} navigationState={objectiveNavigationState} />}
          <DelivererObjectiveForm canUpdate={canUpdateObjectives} objectives={objectives} delivererId={deliverer.id} />
          {dashboard?.monthlyHistory && <DelivererMonthlyHistory history={dashboard.monthlyHistory} delivererId={deliverer.id} returnHref={returnHref} navigationState={objectiveNavigationState} />}
          <DelivererObjectiveHistory objectives={objectives} delivererId={deliverer.id} returnHref={returnHref} navigationState={objectiveNavigationState} />
        </div>}
        {activeTab === 'identification' && <>
          <div className={styles.identityGrid}>
            <DelivererEditForm deliverer={deliverer} canUpdate={canUpdateDeliverer} initiallyOpen={editing} returnHref={currentHref} />
            <aside className={styles.card} aria-labelledby='deliverer-trace-title'><div className={styles.cardHead}><h2 id='deliverer-trace-title'>Traçabilité</h2><p>Les derniers événements disponibles.</p></div>
              <dl className={styles.timeline}>{trace.map(([label, date, author]) => <div key={label}><dt>{label}</dt><dd>{formatDelivererCreatedAt(date)}<small>Par {author ?? 'Compte indisponible'}</small></dd></div>)}</dl>
            </aside>
          </div>
          {canUpdateDelivererStatus && <section className={`${styles.card} ${styles.statusCard}`} aria-labelledby='deliverer-status-title'><div><h2 id='deliverer-status-title'>Statut du livreur</h2><p>La désactivation empêche la création de nouvelles tournées. Elle conserve les historiques et les montants dus, sans annuler les tournées.</p></div><DelivererStatusButton key={currentHref} deliverer={deliverer} returnHref={currentHref} /></section>}
        </>}
      </main>
    </EditingSessionProvider>
  );
};

export default DelivererPage;
