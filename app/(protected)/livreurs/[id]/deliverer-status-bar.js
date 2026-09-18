import { formatCashAmount } from '../../../../lib/cash-payments.js';
import { formatDayTourReference, todayInAlgiers } from '../../../../lib/day-recap.js';
import { formatObjectivePercentage } from '../../../../lib/deliverer-objective-calculations.js';
import { formatTourStatus } from '../../../../lib/tours.js';
import { EditingLink } from '../../components/editing-session.js';
import styles from './deliverer-detail.module.css';

const statusStyles = { PREPARATION: styles.statusPreparation, LOADED: styles.statusLoaded, COUNTED: styles.statusCounted };
// What the tour waits for, in the dashboard's words.
const nextSteps = { PREPARATION: 'Chargement à valider', LOADED: 'Retour à compter', COUNTED: 'Clôture à faire' };
const percentage = new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat('fr-DZ', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plannedLabel = (value) => value === todayInAlgiers() ? 'prévue aujourd’hui'
  : value ? `prévue le ${shortDate.format(new Date(`${value}T00:00:00.000Z`))}` : 'date non renseignée';

const Meter = ({ label, over = false, value, valueText }) => (
  <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.min(100, value)} aria-valuetext={valueText}
    className={`${styles.meter} ${over ? styles.over : ''}`} role='progressbar'>
    <span style={{ width: `${Math.min(100, value)}%` }} />
  </div>
);

// The link sits in the tile's corner so the figure stays the first thing read.
const Tile = ({ children, href, label, linkLabel, tone = '' }) => (
  <div className={`${styles.statusTile} ${tone}`}>
    <dt>{label}</dt>
    <dd>{children}{href && <EditingLink aria-label={`${linkLabel} · ${label}`} className={styles.statusLink} href={href}>{linkLabel} →</EditingLink>}</dd>
  </div>
);

const OpenTourTile = ({ openTours, tourHref, toursHref }) => {
  const { count, latest } = openTours;
  if (!latest) return (
    <Tile label='Tournée en cours'>
      <strong className={`${styles.statusValue} ${styles.statusQuiet}`}>Aucune</strong>
      <small>Rien en préparation, chargé ou à clôturer.</small>
    </Tile>
  );
  return (
    <Tile href={tourHref(latest.id)} label='Tournée en cours' linkLabel='Ouvrir'>
      <strong className={`${styles.statusValue} ${statusStyles[latest.status] ?? ''}`}>{formatTourStatus(latest.status)}</strong>
      <small><strong>{nextSteps[latest.status]}</strong> · <code><span aria-hidden='true'>{formatDayTourReference(latest.reference)}</span><span className='sr-only'>{latest.reference}</span></code> · {plannedLabel(latest.plannedDate)}</small>
      {count > 1 && <small><EditingLink href={toursHref}>+ {count - 1} autre{count > 2 ? 's' : ''} tournée{count > 2 ? 's' : ''} ouverte{count > 2 ? 's' : ''}</EditingLink></small>}
    </Tile>
  );
};

const RemainderTile = ({ href, summary }) => {
  if (!summary.reliable) return (
    <Tile href={href} label='Reste à payer' linkLabel='Détail' tone={styles.statusDanger}>
      <strong className={styles.statusValue}>Non calculable</strong>
      <small>Données manquantes ou incohérentes.</small>
    </Tile>
  );
  if (summary.countedTourCount === 0) return (
    <Tile label='Reste à payer'>
      <strong className={`${styles.statusValue} ${styles.statusQuiet}`}>—</strong>
      <small>Aucune tournée comptée.</small>
    </Tile>
  );
  const outstanding = summary.remainingDueInCentimes > 0;
  return (
    <Tile href={href} label='Reste à payer' linkLabel='Détail' tone={outstanding ? styles.statusWarning : styles.statusSuccess}>
      <strong className={styles.statusValue}>{outstanding ? formatCashAmount(summary.remainingDueInCentimes) : 'Soldé'}</strong>
      <small>Encaissé {formatCashAmount(summary.amountPaidInCentimes)} sur {formatCashAmount(summary.netDueInCentimes)} net</small>
    </Tile>
  );
};

const ExposureTile = ({ creditLimit, exposure, href }) => {
  if (!exposure.reliable) return (
    <Tile href={href} label='Engagement' linkLabel='Détail' tone={styles.statusDanger}>
      <strong className={styles.statusValue}>Non calculable</strong>
      <small>Données manquantes ou incohérentes.</small>
    </Tile>
  );
  const status = exposure.comparison?.status;
  const ratio = creditLimit.configured && creditLimit.amountInCentimes > 0
    ? exposure.engagementInCentimes / creditLimit.amountInCentimes * 100 : null;
  return (
    <Tile href={href} label='Engagement' linkLabel='Détail'
      tone={status === 'EXCEEDED' ? styles.statusDanger : status === 'REACHED' ? styles.statusWarning : ''}>
      <strong className={styles.statusValue}>{formatCashAmount(exposure.engagementInCentimes)}</strong>
      {ratio !== null && <Meter label='Engagement par rapport au seuil' over={status === 'EXCEEDED'} value={ratio} valueText={`${percentage.format(ratio)} % du seuil`} />}
      <small>{!creditLimit.configured ? exposure.loadedValueInCentimes > 0 ? `Dont ${formatCashAmount(exposure.loadedValueInCentimes)} chargés non comptés · aucun seuil` : 'Aucun seuil configuré'
        : status === 'EXCEEDED' ? <><strong>Dépasse de {formatCashAmount(exposure.comparison.amountInCentimes)}</strong> le seuil de {formatCashAmount(creditLimit.amountInCentimes)}</>
          : status === 'REACHED' ? `Seuil de ${formatCashAmount(creditLimit.amountInCentimes)} atteint`
            : `${percentage.format(ratio)} % du seuil de ${formatCashAmount(creditLimit.amountInCentimes)}`}</small>
    </Tile>
  );
};

const ObjectiveTile = ({ achievement, href }) => {
  if (!achievement.complete) return (
    <Tile href={href} label='Objectif du mois' linkLabel='Objectifs' tone={styles.statusDanger}>
      <strong className={styles.statusValue}>Calcul incomplet</strong>
      <small>Des comptages sont à vérifier.</small>
    </Tile>
  );
  if (achievement.targetInCentimes === null) return (
    <Tile href={href} label='Objectif du mois' linkLabel='Objectifs'>
      <strong className={`${styles.statusValue} ${styles.statusQuiet}`}>Non défini</strong>
      <small>CA du mois : {formatCashAmount(achievement.salesInCentimes)}</small>
    </Tile>
  );
  return (
    <Tile href={href} label='Objectif du mois' linkLabel='Objectifs' tone={achievement.reached ? styles.statusSuccess : ''}>
      <strong className={styles.statusValue}>{formatObjectivePercentage(achievement.achievementPercentage)}</strong>
      <Meter label='Progression de l’objectif mensuel' value={achievement.achievementPercentage} valueText={formatObjectivePercentage(achievement.achievementPercentage)} />
      <small>{achievement.reached ? `Dépassé de ${formatCashAmount(achievement.excessInCentimes)}` : <>Encore <strong>{formatCashAmount(achievement.remainingInCentimes)}</strong></>} sur {formatCashAmount(achievement.targetInCentimes)}</small>
    </Tile>
  );
};

// Each figure appears only when the page could read it for this account.
const DelivererStatusBar = ({ achievement, cashSummary, creditLimit, exposure, hrefForTab, openTours, tourHref }) => {
  const tiles = [
    openTours && <OpenTourTile key='tour' openTours={openTours} tourHref={tourHref} toursHref={hrefForTab('tournees')} />,
    cashSummary && <RemainderTile key='remainder' href={hrefForTab('ensemble')} summary={cashSummary} />,
    exposure && creditLimit && <ExposureTile key='exposure' creditLimit={creditLimit} exposure={exposure} href={hrefForTab('ensemble')} />,
    achievement && <ObjectiveTile key='objective' achievement={achievement} href={hrefForTab('objectifs')} />,
  ].filter(Boolean);
  if (!tiles.length) return null;
  return <dl aria-label='Situation du livreur' className={styles.statusBar}>{tiles}</dl>;
};

export default DelivererStatusBar;
