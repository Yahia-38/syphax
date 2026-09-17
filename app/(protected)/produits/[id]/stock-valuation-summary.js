import { formatReceptionMoney } from '../../../../lib/receptions.js';
import styles from './product-detail.module.css';

const StockValuationSummary = ({ valuation, baseUnitLabel }) => {
  if (!valuation) return null;
  const average = valuation.averageUnitCostInCentimes;
  return <section aria-label='Valorisation du stock en entrepôt' className={styles.valuation}>
    <dl className={styles.valuationGrid}>
      <div className={styles.stockCard}>
        <dt className={styles.stockLabel}>Valeur du stock en entrepôt</dt>
        <dd className={styles.valuationValue}>{valuation.complete ? formatReceptionMoney(valuation.valueInCentimes) : 'Non valorisé'}</dd>
        <small>Coût d’achat TTC des marchandises physiquement en entrepôt</small>
      </div>
      <div className={styles.stockCard}>
        <dt className={styles.stockLabel}>Coût moyen pondéré</dt>
        <dd className={styles.valuationValue}>{!valuation.complete ? 'Non calculable' : average === null ? 'Non applicable' : `${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 4 }).format(average / 100)} DA`}</dd>
        <small>{valuation.complete && average === null ? 'Entrepôt vide · valeur du stock nulle' : `TTC / ${baseUnitLabel.toLocaleLowerCase('fr')} · valeur du stock ÷ quantité en entrepôt`}</small>
      </div>
    </dl>
    {!valuation.complete && <p className={styles.valuationNotice}>Valorisation incomplète : les coûts et l’historique physique doivent être réconciliés ou migrés avant de calculer une valeur fiable.</p>}
    <p className={styles.valuationHint}>Le coût moyen porte sur le stock restant en entrepôt, y compris les quantités réservées. Le dernier coût d’achat est présenté séparément dans la tarification.</p>
  </section>;
};

export default StockValuationSummary;
