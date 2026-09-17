import { formatObjectiveMonth, formatObjectivePercentage } from '../../../../lib/deliverer-objective-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import { buildDelivererToursHref } from '../../../../lib/tours.js';
import ObjectiveAchievementStatus from './objective-achievement-status.js';
import ObjectiveNavigationFields from './objective-navigation-fields.js';
import ObjectiveNavigationForm from './objective-navigation-form.js';
import styles from './deliverer-detail.module.css';

const money = (value) => value === null ? '—' : formatReceptionMoney(value);

const DelivererMonthlyAchievement = ({ achievement, delivererId, returnHref, navigationState }) => {
  const href = buildDelivererToursHref({ delivererId, returnHref, section: 'objectifs', ...navigationState });
  return (
    <section className={styles.card} aria-labelledby='monthly-achievement-title'>
      <div className={styles.cardHead}><h2 id='monthly-achievement-title'>Objectif et réalisation du mois</h2><p>{formatObjectiveMonth(achievement.month)} · Selon la date du comptage en Algérie.</p></div>
      <ObjectiveNavigationForm key={href} className={styles.filters} action={`/livreurs/${delivererId}`}>
        <ObjectiveNavigationFields href={href} omit={['bilanMois']} />
        <div><label htmlFor='achievement-month'>Mois à consulter</label><input id='achievement-month' name='bilanMois' type='month' required min='1000-01' max='9999-12' defaultValue={achievement.month} /></div>
        <button type='submit'>Consulter</button>
      </ObjectiveNavigationForm>
      <div className={styles.achievementSummary}>
        <ObjectiveAchievementStatus status={achievement.status} />
        <dl className={styles.achievementMetrics}>
          <div><dt>Objectif</dt><dd>{achievement.targetInCentimes === null ? 'Non défini' : money(achievement.targetInCentimes)}</dd></div>
          <div><dt>CA réalisé</dt><dd>{achievement.complete ? money(achievement.salesInCentimes) : 'Calcul incomplet'}</dd></div>
          <div><dt>Pourcentage réalisé</dt><dd>{formatObjectivePercentage(achievement.achievementPercentage)}</dd></div>
          <div><dt>Reste à réaliser</dt><dd>{money(achievement.remainingInCentimes)}</dd></div>
          <div><dt>Excédent</dt><dd>{money(achievement.excessInCentimes)}</dd></div>
        </dl>
        {achievement.achievementPercentage !== null && <div className={styles.meter} role='progressbar'
          aria-label='Progression de l’objectif mensuel' aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.min(100, achievement.achievementPercentage)} aria-valuetext={formatObjectivePercentage(achievement.achievementPercentage)}>
          <span style={{ width: `${Math.min(100, achievement.achievementPercentage)}%` }} />
        </div>}
        {achievement.complete ? <p className={styles.muted}>{achievement.validTourCount} tournée(s) comptée(s) ou terminée(s) prise(s) en compte. Le statut « Non atteint » s’applique uniquement après la fin du mois.</p>
          : <div className={`${styles.attention} ${styles.danger}`} role='alert'>
            <strong>Le chiffre d’affaires total ne peut pas être confirmé.</strong>
            <p>{achievement.invalidTourCount > 0 && `${achievement.invalidTourCount} tournée(s) à vérifier. `}{achievement.anomalies[0].tourReference} — {achievement.anomalies[0].label}</p>
            {achievement.anomalies.some(({ monthUnknown }) => monthUnknown) && <p>Certains comptages ne peuvent pas être rattachés à un mois. Ils empêchent de confirmer ce total.</p>}
            {achievement.knownSalesInCentimes !== null && <small>Sous-total des {achievement.validTourCount} tournée(s) fiables uniquement : {money(achievement.knownSalesInCentimes)}. Ce montant est partiel.</small>}
          </div>}
        {achievement.targetInCentimes === null && <p className={styles.muted}>Aucun objectif n’est défini pour ce mois. La progression et les montants à comparer sont indisponibles.</p>}
      </div>
      <p className={styles.footnote}>Quantités vendues après retours, aux prix de vente historiques du chargement, y compris les prix par pack. Chaque tournée compte une seule fois. Les frais et les versements n’affectent pas ce chiffre.</p>
    </section>
  );
};

export default DelivererMonthlyAchievement;
