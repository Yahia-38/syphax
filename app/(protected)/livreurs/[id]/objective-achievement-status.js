import { OBJECTIVE_ACHIEVEMENT_STATUSES } from '../../../../lib/deliverer-objective-calculations.js';
import styles from './deliverer-detail.module.css';

const ObjectiveAchievementStatus = ({ status }) => (
  <span className={`${styles.tourState} ${status === 'reached' ? styles.closed
    : status === 'missed' || status === 'incomplete' ? styles.cancelled
      : status === 'ongoing' ? styles.counted : styles.preparation}`}>
    {OBJECTIVE_ACHIEVEMENT_STATUSES[status]}
  </span>
);

export default ObjectiveAchievementStatus;
