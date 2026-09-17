import { formatObjectiveMonth } from '../../../../lib/deliverer-objective-calculations.js';
import { formatReceptionMoney } from '../../../../lib/receptions.js';
import styles from './deliverer-detail.module.css';

const DelivererMonthlyAchievement = ({ achievement }) => (
  <section className={styles.card} aria-labelledby='monthly-achievement-title'>
    <div className={styles.cardHead}><h2 id='monthly-achievement-title'>Chiffre d’affaires réalisé</h2><p>{formatObjectiveMonth(achievement.month)} · Selon la date du comptage en Algérie.</p></div>
    <div className={styles.creditValue}>
      <p className={styles.eyebrow}>Ventes du mois</p>
      <p className={styles.bigNumber}>{achievement.complete ? formatReceptionMoney(achievement.salesInCentimes) : 'Calcul incomplet'}</p>
      {achievement.complete ? <small>{achievement.validTourCount} tournée{achievement.validTourCount > 1 ? 's' : ''} comptée{achievement.validTourCount > 1 ? 's' : ''} ou terminée{achievement.validTourCount > 1 ? 's' : ''} prise{achievement.validTourCount > 1 ? 's' : ''} en compte.</small>
        : <div className={`${styles.attention} ${styles.danger}`} role='alert'>
          <strong>Le chiffre d’affaires total ne peut pas être confirmé.</strong>
          <p>{achievement.invalidTourCount > 0 && `${achievement.invalidTourCount} tournée(s) à vérifier. `}{achievement.anomalies[0].tourReference} — {achievement.anomalies[0].label}</p>
          {achievement.anomalies.some(({ monthUnknown }) => monthUnknown) && <p>Certains comptages ne peuvent pas être rattachés à un mois. Ils empêchent de confirmer ce total.</p>}
          {achievement.knownSalesInCentimes !== null && <small>Sous-total des {achievement.validTourCount} tournée(s) fiables uniquement : {formatReceptionMoney(achievement.knownSalesInCentimes)}. Ce montant est partiel.</small>}
        </div>}
    </div>
    <p className={styles.footnote}>Quantités vendues après retours, aux prix de vente historiques du chargement, y compris les prix par pack. Chaque tournée compte une seule fois. Les frais et les versements n’affectent pas ce chiffre.</p>
  </section>
);

export default DelivererMonthlyAchievement;
