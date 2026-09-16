import Link from 'next/link';

import { getReceptionUnitLabel, summarizeReceptionQuantities } from '../../../../lib/reception-detail.js';
import {
  formatReceptionDate,
  formatReceptionDifference,
  formatReceptionMoney,
  formatReceptionRecordedAt,
  summarizeReceptionAmounts,
} from '../../../../lib/receptions.js';
import ReceptionDetailLines from './reception-detail-lines.js';
import styles from './reception-detail.module.css';

const ReceptionDetailView = ({ reception, returnHref, baseUnits }) => {
  const amounts = summarizeReceptionAmounts(reception.lines, reception.totalAmountInCentimes);
  const quantities = summarizeReceptionQuantities(reception.lines);
  const unitLabels = new Map(baseUnits.map(({ code, label }) => [code, label]));
  const unsafeSubtotal = amounts.knownSubtotalInCentimes !== null && !Number.isSafeInteger(amounts.knownSubtotalInCentimes);
  // An unsafe sum must never produce a seemingly reliable difference, even if
  // subtracting the document total happens to bring it back into the safe range.
  const gap = !unsafeSubtotal && Number.isSafeInteger(amounts.gapInCentimes) ? amounts.gapInCentimes : null;
  const reference = reception.supplierReference?.trim() || 'Sans référence documentaire';
  const supplier = reception.supplierName?.trim() || 'Fournisseur non renseigné';
  const gapHelp = gap === 0 ? 'Le total du document correspond aux lignes.'
    : gap > 0 ? 'Le total du document diffère du total des lignes.'
      : gap < 0 ? 'Le total du document diffère du total des lignes.'
        : unsafeSubtotal ? 'La somme des montants dépasse la précision des entiers sûrs.'
          : amounts.documentTotalInCentimes === null ? 'Le total du document n’est pas renseigné.'
            : !reception.lines.length ? 'Aucune ligne disponible pour comparer.'
              : 'Tous les montants de lignes sont nécessaires pour comparer.';

  return (
    <main className={styles.page}>
      <Link className={styles.back} href={returnHref}><span aria-hidden='true'>←</span>Retour à l’historique</Link>
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <span className={styles.heroIcon}><svg aria-hidden='true' viewBox='0 0 24 24'><path d='M14 2H5v20h14V7zM14 2v5h5M8 12h8m-8 4h5' /></svg></span>
          <div><p className={styles.eyebrow}>Fiche de réception</p><h1>{reference}</h1><div className={styles.meta}><span>{supplier}</span><span aria-hidden='true'>·</span><span>{formatReceptionDate(reception.receptionDate)}</span></div></div>
        </div>
        <span className={styles.badge}>Lecture seule</span>
      </header>
      <div className={styles.layout}>
        <div className={styles.stack}>
          <section className={styles.card} aria-label='Informations du document fournisseur'>
            <dl className={styles.document}>
              {[
                ['Document fournisseur', reference],
                ['Date de réception', formatReceptionDate(reception.receptionDate)],
                ['Fournisseur à la réception', supplier],
                ['Contenu enregistré', `${reception.lines.length} ligne${reception.lines.length > 1 ? 's' : ''} de produits`],
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
          </section>
          <ReceptionDetailLines baseUnits={baseUnits} lines={reception.lines} />
          <section className={`${styles.card} ${styles.trace}`} aria-labelledby='reception-trace-title'>
            <h2 id='reception-trace-title'>Traçabilité</h2>
            <dl className={styles.traceFields}>
              <div><dt>Enregistrée par</dt><dd>{reception.createdBy || 'Compte indisponible'}</dd></div>
              <div><dt>Enregistrée le</dt><dd>{formatReceptionRecordedAt(reception.createdAt)}</dd></div>
            </dl>
            <details className={styles.technical}><summary>Identifiant de la réception</summary><code>{reception.id}</code></details>
            <p className={styles.help}>L’auteur est affiché avec le nom actuel du compte.</p>
          </section>
        </div>
        <aside className={styles.sidebar} aria-label='Synthèse de toute la réception'>
          <section className={`${styles.card} ${styles.moneyCard}`} aria-labelledby='reception-amounts-title'>
            <div className={styles.moneyBody}>
              <h2 id='reception-amounts-title'>Montants TTC</h2>
              <p className={styles.moneyLabel}>{amounts.complete ? 'Total des lignes TTC' : 'Sous-total TTC connu'}</p>
              <p className={styles.moneyValue}>{unsafeSubtotal ? 'Non calculable' : formatReceptionMoney(amounts.knownSubtotalInCentimes)}</p>
              <p className={styles.scopeNote}>Toute la réception · Indépendant des filtres</p>
              {unsafeSubtotal && <p className={styles.warning}>La somme dépasse la précision des entiers sûrs. Le total et l’écart ne sont pas calculables.</p>}
              {!amounts.complete && reception.lines.length > 0 && <p className={styles.warning}>{amounts.incompleteLineCount} ligne{amounts.incompleteLineCount > 1 ? 's' : ''} sans montant TTC. {amounts.knownSubtotalInCentimes === null ? 'Aucun montant n’est renseigné.' : 'Le sous-total connu est incomplet.'}</p>}
              {!reception.lines.length && <p className={styles.help}>Aucune ligne enregistrée : aucun total de lignes disponible.</p>}
              <dl className={styles.moneyFields}>
                <div><dt>Total TTC du document</dt><dd>{formatReceptionMoney(amounts.documentTotalInCentimes)}</dd></div>
                <div><dt>Écart document − lignes</dt><dd className={gap === 0 ? styles.concordance : gap !== null ? styles.missing : undefined}>{gap === null ? 'Non calculable' : formatReceptionDifference(gap)}</dd><p className={styles.help}>{gapHelp}</p></div>
              </dl>
            </div>
            <p className={styles.footer}>Montants d’achat enregistrés. Ils ne constituent pas une preuve de paiement.</p>
          </section>
          <section className={`${styles.card} ${styles.quantities}`} aria-labelledby='reception-quantities-title'>
            <h2 id='reception-quantities-title'>Quantités reçues</h2>
            <dl>{quantities.totals.length ? quantities.totals.map(({ baseUnit, quantity }) => <div key={baseUnit}><dt>{getReceptionUnitLabel(baseUnit, unitLabels, 2)}</dt><dd>{quantity === null ? 'Non calculable' : new Intl.NumberFormat('fr-DZ').format(quantity)}</dd></div>) : <div><dt>Quantités</dt><dd>Non renseignées</dd></div>}</dl>
            <p className={styles.quantityNote}>Totaux de toute la réception, séparés par unité de base.</p>
            {quantities.incompleteLineCount > 0 && <p className={styles.warning}>{quantities.incompleteLineCount} ligne{quantities.incompleteLineCount > 1 ? 's' : ''} avec quantité ou unité non renseignée. Seuls les sous-totaux connus sont présentés.</p>}
            {quantities.totals.some(({ quantity }) => quantity === null) && <p className={styles.warning}>Une somme de quantités dépasse la précision des entiers sûrs.</p>}
          </section>
          <p className={styles.info}>Cette fiche présente la réception historique. Le stock disponible aujourd’hui se consulte dans les produits.</p>
        </aside>
      </div>
    </main>
  );
};

export default ReceptionDetailView;
