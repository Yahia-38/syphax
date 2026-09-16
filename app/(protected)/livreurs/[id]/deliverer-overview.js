import { formatCashAmount } from '../../../../lib/cash-payments.js';
import styles from './deliverer-detail.module.css';

const amount = (value) => Number.isSafeInteger(value) ? formatCashAmount(value) : 'Non calculable';
const Anomalies = ({ anomalies }) => <p className={styles.anomalies}>{anomalies.map((item) => `${item.tourReference} — ${item.label}`).join(' ; ')}</p>;

export const DelivererCashSummary = ({ summary }) => (
  <section className={styles.card} aria-labelledby='deliverer-cash-title'>
    <div className={styles.cardHead}><h2 id='deliverer-cash-title'>Situation des tournées comptées</h2><p>Les montants à remettre et les encaissements enregistrés.</p></div>
    {!summary.reliable ? <div className={`${styles.attention} ${styles.danger}`} role='alert'>
      <strong>Situation financière non calculable</strong>
      <p>Les montants sont masqués : certaines données sont manquantes ou incohérentes.</p>
      <Anomalies anomalies={summary.anomalies} />
    </div> : summary.countedTourCount === 0 ? <div className={styles.empty}>
      <h3>Aucune tournée comptée</h3><p>La synthèse apparaîtra après le comptage d’une tournée.</p>
    </div> : <>
      <div className={styles.cashGrid}>
        <div className={styles.remainder}>
          <p className={styles.eyebrow}>Reste à payer</p>
          <p className={styles.bigNumber}>{amount(summary.remainingDueInCentimes)}</p>
          <span className={summary.remainingDueInCentimes === 0 ? styles.settled : styles.outstanding}>
            {summary.remainingDueInCentimes === 0 ? 'Reste à payer nul' : 'Montant à remettre'}
          </span>
          <small>Net à remettre − encaissements</small>
        </div>
        <dl className={styles.cashMetrics}>
          {[
            ['Ventes brutes', summary.grossSalesInCentimes, 'Ventes des tournées comptées'],
            ['Frais enregistrés', summary.totalExpensesInCentimes, 'Déduits des ventes brutes'],
            ['Net à remettre', summary.netDueInCentimes, 'Ventes brutes − frais enregistrés'],
            ['Total encaissé', summary.amountPaidInCentimes, 'Versements déjà enregistrés'],
          ].map(([label, value, explanation]) => <div key={label}><dt>{label}</dt><dd>{amount(value)}</dd><small>{explanation}</small></div>)}
        </dl>
      </div>
    </>}
    {(summary.expenseDeclarationsMissingCount > 0 || summary.historicalExpenseDeclarationsMissingCount > 0) && <div className={styles.attention}>
      <strong>Frais à compléter</strong>
      <p>{summary.expenseDeclarationsMissingCount > 0 && `${summary.expenseDeclarationsMissingCount} tournée(s) comptée(s) avec frais non encore déclarés. `}
        {summary.historicalExpenseDeclarationsMissingCount > 0 && `${summary.historicalExpenseDeclarationsMissingCount} tournée(s) historique(s) clôturée(s) sans déclaration. `}
        Le net reflète les frais enregistrés et peut évoluer. Une déclaration manquante ne signifie pas zéro frais déclaré.</p>
    </div>}
    <p className={styles.footnote}>Toutes les tournées comptées et terminées, y compris les soldées, indépendamment des filtres. Les préparations et chargements non comptés sont exclus.</p>
  </section>
);

export const DelivererExposure = ({ exposure, creditLimit }) => {
  const compared = exposure.reliable && creditLimit.configured && exposure.comparison;
  const ratio = compared && creditLimit.amountInCentimes > 0
    ? exposure.engagementInCentimes / creditLimit.amountInCentimes * 100 : null;
  const status = compared ? exposure.comparison.status : null;
  return (
    <section className={styles.card} aria-labelledby='deliverer-exposure-title'>
      <div className={styles.cardHead}><h2 id='deliverer-exposure-title'>Engagement actuel</h2><p>Reste dû + chargements non comptés</p></div>
      <div className={styles.creditValue}>
        <p className={styles.bigNumber}>{exposure.reliable ? amount(exposure.engagementInCentimes) : 'Non calculable'}</p>
        {ratio !== null && <><div className={`${styles.meter} ${status === 'EXCEEDED' ? styles.over : ''}`} aria-hidden='true'><span style={{ width: `${Math.min(100, ratio)}%` }} /></div><small>{new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 1 }).format(ratio)} % du seuil</small></>}
        {!exposure.reliable ? <div className={`${styles.attention} ${styles.danger}`} role='alert'><strong>Engagement non calculable</strong><p>Les composantes fiables restent disponibles ci-dessous.</p><Anomalies anomalies={exposure.anomalies} /></div>
          : status === 'EXCEEDED' ? <p className={styles.fieldError} role='alert'>Seuil dépassé de {amount(exposure.comparison.amountInCentimes)}. Les opérations restent autorisées.</p>
          : status === 'REACHED' ? <p className={styles.comparison}>Seuil atteint. Les opérations restent autorisées.</p>
          : status === 'BELOW' ? <p className={styles.below}>{amount(exposure.comparison.amountInCentimes)} avant d’atteindre le seuil.</p>
          : <p className={styles.muted}>Aucune limite configurée : pas de comparaison au seuil.</p>}
        <dl className={styles.breakdown}>
          <div><dt>Reste dû des tournées comptées</dt><dd>{amount(exposure.countedRemainderInCentimes)}</dd></div>
          <div><dt>Valeur chargée non encore comptée</dt><dd>{amount(exposure.loadedValueInCentimes)}</dd></div>
        </dl>
      </div>
      <p className={styles.footnote}>La valeur chargée n’est pas encore une vente comptée. Elle entre dans l’engagement, pas dans le reste à payer des tournées comptées.</p>
    </section>
  );
};
