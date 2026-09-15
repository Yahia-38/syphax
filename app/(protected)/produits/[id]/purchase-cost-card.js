import { EditingLink } from '../../components/editing-session.js';
import { formatReceptionDate, formatReceptionUnitCost } from '../../../../lib/receptions.js';
import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

const formatGap = (centimes) => `${centimes > 0 ? '+' : centimes < 0 ? '−' : ''}${new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 4 }).format(Math.abs(centimes) / 100)} DA TTC`;

export const PurchasePriceGap = ({ baseUnitLabel, purchaseCost, salePriceInCentimes }) => {
  const gap = Number.isSafeInteger(salePriceInCentimes) && Number.isFinite(purchaseCost?.unitCostInCentimes)
    ? salePriceInCentimes - purchaseCost.unitCostInCentimes : null;
  return <section className={styles.gapStrip} aria-label='Écart vente − dernier achat'>
    <ProductIcon name='compare' /><div><h3 className={styles.gapTitle}>Écart vente − dernier achat</h3>
      <p>{gap === null ? 'Les deux montants sont nécessaires à la comparaison.' : gap > 0 ? 'Vente supérieure au dernier achat.' : gap < 0 ? 'Vente inférieure au dernier achat.' : 'Montants identiques.'}</p></div>
    <div className={styles.gapAmount}><strong>{gap === null ? 'Non calculable' : formatGap(gap)}</strong>{gap !== null && <small>/ {baseUnitLabel.toLocaleLowerCase('fr')}</small>}</div>
  </section>;
};

const PurchaseCostCard = ({ baseUnitLabel, purchaseCost }) => {
  const source = purchaseCost?.source;
  return <section aria-labelledby='purchase-cost-title' className={`${styles.card} ${styles.purchase}`}>
    <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='in' /><h2 id='purchase-cost-title'>Dernier coût d’achat renseigné</h2></div></div>
    <div className={styles.priceMain}>
      <p className={styles.eyebrow}>Dernier achat compatible</p>
      {purchaseCost ? <p className={styles.priceValue}><strong>{formatReceptionUnitCost(purchaseCost).replace(/\sDA$/u, '')}</strong><span>DA TTC / {baseUnitLabel.toLocaleLowerCase('fr')}</span></p>
        : <p className={styles.emptyValue}>À renseigner</p>}
      <p className={styles.priceHint}>{purchaseCost ? 'Montant unitaire TTC de la dernière ligne compatible.' : 'Aucune ligne de réception compatible avec un montant TTC calculable.'}</p>
    </div>
    {source && <div className={styles.sourceBox}><div className='min-w-0 flex-1'>
      <p>{source.supplierReference ?? 'Référence indisponible'}{source.supplierName ? ` · ${source.supplierName}` : ''}</p>
      <small>{source.receptionDate ? `Reçue le ${formatReceptionDate(source.receptionDate)}` : 'Date indisponible'}{source.lineNumber ? ` · Ligne ${source.lineNumber}` : ''}</small>
    </div>{source.receptionId && <EditingLink className={styles.sourceLink} href={`/receptions/${source.receptionId}`}>Voir la réception source →</EditingLink>}</div>}
  </section>;
};

export default PurchaseCostCard;
