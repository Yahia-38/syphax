import { notFound } from 'next/navigation';

import { getUserPermissions } from '../../../../lib/access.js';
import {
  formatQuantityInDisplayUnit,
  getDisplayQuantitySeparator,
  getDisplayUnitLabel,
  getDisplayUnitSalePrice,
  getProductDisplayUnit,
  getQuantityInDisplayUnit,
} from '../../../../lib/product-display-unit.js';
import { validateProductListHref } from '../../../../lib/product-list-navigation.js';
import { readTab } from '../../../../lib/tab-navigation.js';
import { BASE_UNITS, getProductById } from '../../../../lib/products.js';
import { getLatestProductPurchaseCost } from '../../../../lib/reception-records.js';
import { requirePermission } from '../../../../lib/sessions.js';
import DeleteProductButton from '../delete-product-button.js';
import DefaultSaleUnitForm from './default-sale-unit-form.js';
import PackagingForm from './packaging-form.js';
import PackPricing from './pack-pricing.js';
import PriceHistory from './price-history.js';
import PricingForm from './pricing-form.js';
import ProductEditForm from './product-edit-form.js';
import ProductTabs, { getProductTabs } from './product-tabs.js';
import PurchaseCostCard, { PurchasePriceGap } from './purchase-cost-card.js';
import StockMovementHistory from './stock-movement-history.js';
import StockValuationSummary from './stock-valuation-summary.js';
import { EditingLink, EditingSessionProvider } from '../../components/editing-session.js';
import styles from './product-detail.module.css';
import ProductIcon from './product-icon.js';

export const metadata = {
  title: 'Fiche produit | Syphax',
};

const formatDate = (value) => {
  if (!value) {
    return 'Non renseignée';
  }

  return new Intl.DateTimeFormat('fr-DZ', {
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: 'Africa/Algiers',
  }).format(new Date(value));
};

const formatPriceInput = (amountInCentimes) => {
  if (!Number.isSafeInteger(amountInCentimes)) {
    return '';
  }

  return (amountInCentimes / 100).toFixed(2).replace(/\.00$/u, '');
};

const formatStockQuantity = (quantity) => new Intl.NumberFormat('fr-DZ', {
  maximumFractionDigits: 0,
}).format(quantity);

const formatMoney = (value) => new Intl.NumberFormat('fr-DZ', { maximumFractionDigits: 2 }).format(value / 100);

// Whole default units and any base-unit remainder, each number followed by its unit label.
const DisplayQuantity = ({ quantity, unitOptions }) => {
  const { negative, parts } = getQuantityInDisplayUnit(quantity, unitOptions);
  return <>{negative && '−'}{parts.map(({ count, label }, index) => <span className={styles.quantityPart} key={label}>
    {index > 0 && `${getDisplayQuantitySeparator(negative).trim()} `}{formatStockQuantity(count)}<span>{label}</span>
  </span>)}</>;
};

const SectionHeading = ({ title, description, note = 'Quantités et montants par unité de base' }) => (
  <div className={styles.sectionHeading}>
    <div><h2>{title}</h2><p>{description}</p></div>
    <span className={styles.subnote}>{note}</span>
  </div>
);

const StockSection = ({ baseUnitLabel, displayUnit, product }) => {
  const { stock } = product;
  const available = stock.availableQuantityInBaseUnits;
  const unit = baseUnitLabel.toLocaleLowerCase('fr');
  const unitOptions = { baseUnitLabel, displayUnit };
  // With a default packaging, the card figure is in packs and the base-unit figure goes underneath.
  const baseFigure = (quantity) => (displayUnit ? `= ${formatQuantityInDisplayUnit(quantity, { baseUnitLabel, displayUnit: null })}` : unit);
  return (
    <div aria-labelledby='stock-tab' id='stock-panel'>
      <SectionHeading title='Stock & disponibilité' description='Le stock physique, les réservations et ce qui reste disponible.'
        note={displayUnit ? `Quantités en ${displayUnit.label.toLocaleLowerCase('fr')}, puis en unités de base` : undefined} />
      <dl className={styles.stockGrid}>
        <div className={styles.stockCard}>
          <dt className={styles.stockLabel}><ProductIcon name='stock' />En entrepôt</dt>
          <dd><DisplayQuantity quantity={stock.quantityInBaseUnits} unitOptions={unitOptions} /></dd>
          <small>{baseFigure(stock.quantityInBaseUnits)} · quantité physiquement en stock</small>
        </div>
        <div className={`${styles.stockCard} ${styles.reserved}`}>
          <dt className={styles.stockLabel}><ProductIcon name='reserved' />Réservé</dt>
          <dd><DisplayQuantity quantity={stock.reservedQuantityInBaseUnits} unitOptions={unitOptions} /></dd>
          <small>{baseFigure(stock.reservedQuantityInBaseUnits)} · quantité déjà réservée</small>
        </div>
        <div className={`${styles.stockCard} ${styles.available} ${available < 0 ? styles.anomaly : available === 0 ? styles.zero : ''}`}>
          <dt className={styles.stockLabel}><ProductIcon name={available < 0 ? 'info' : 'check'} />Disponible</dt>
          <dd><DisplayQuantity quantity={available} unitOptions={unitOptions} /></dd>
          <small>{baseFigure(available)} · {available < 0 ? 'Disponible négatif · à vérifier' : available === 0 ? 'Aucune quantité disponible' : 'Disponible après réservations'}</small>
        </div>
      </dl>
      <p className={styles.formula}><ProductIcon name='info' /><span>Disponible = entrepôt − réservé. Une réservation n’est pas une sortie physique.</span></p>
      <StockValuationSummary valuation={stock.valuation} baseUnitLabel={baseUnitLabel} />
      {available < 0 && <p className='mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'>Le disponible est négatif : les sorties physiques et réservations dépassent le stock en entrepôt.</p>}
      <StockMovementHistory baseUnitLabel={baseUnitLabel} movements={stock.movements} movementCount={stock.movementCount} stock={stock} includeValuation={Boolean(stock.valuation)} />
      <details className={styles.help}><summary>Comprendre les chiffres</summary><p>Les compteurs portent sur tous les mouvements physiques enregistrés pour ce produit, indépendamment des filtres. Un disponible nul ne signifie pas que l’entrepôt est vide : tout le stock peut être réservé. Le stock évolue lors des opérations métier.</p></details>
    </div>
  );
};

const ProductPage = async ({ params, searchParams }) => {
  const session = await requirePermission('products.read');
  const [{ id }, query = {}, permissions] = await Promise.all([params, searchParams, getUserPermissions(session.userId)]);
  const canReadPackaging = permissions.includes('packaging.read');
  const canReadPricing = permissions.includes('pricing.read');
  const canReadPurchaseCosts = permissions.includes('receptions.read');
  const canReadTarification = canReadPricing || canReadPurchaseCosts;
  const returnHref = validateProductListHref(query.retour);
  const tabs = getProductTabs({ canReadPackaging, canReadTarification });
  const activeTab = readTab(query, tabs, 'identification');
  const product = await getProductById(id, {
    includePricing: canReadPricing,
    includePackagings: canReadPackaging,
    includeStockMovements: activeTab === 'stock',
    includeTourSources: permissions.includes('tours.read'),
    includeReceptionSources: canReadPurchaseCosts,
    includeValuation: activeTab === 'stock',
    userId: session.userId,
  });
  if (!product) notFound();
  const canUpdateProduct = permissions.includes('products.update');
  const canUpdatePrice = canReadPricing && permissions.includes('pricing.update');
  const baseUnitLabel = BASE_UNITS.find((unit) => unit.code === product.baseUnit)?.label ?? product.baseUnit;
  const displayUnit = getProductDisplayUnit(product);
  const unitOptions = { baseUnitLabel, displayUnit };
  const displaySalePrice = getDisplayUnitSalePrice({ displayUnit, packagings: product.packagings, salePrice: product.salePrice });
  const latestPriceChange = product.salePriceHistory[0] ?? (product.salePrice ? {
    changedAt: product.salePrice.updatedAt, changedBy: product.salePrice.updatedBy,
  } : null);
  const latestPurchaseCost = activeTab === 'tarification' && canReadPurchaseCosts
    ? await getLatestProductPurchaseCost({ baseUnit: product.baseUnit, productId: product.id, userId: session.userId }) : null;
  const unitPricing = <div>
    <PricingForm baseUnitLabel={baseUnitLabel} canUpdatePrice={canUpdatePrice} title={`Prix par ${baseUnitLabel.toLocaleLowerCase('fr')}`}
      description={`Unité de base · 1 ${baseUnitLabel.toLocaleLowerCase('fr')}`}
      currentPrice={formatPriceInput(product.salePrice?.amountInCentimes)} currentPriceInCentimes={product.salePrice?.amountInCentimes ?? null}
      initiallyOpen={query.prix === '1' && canUpdatePrice}
      lastChange={latestPriceChange?.changedAt ? { author: latestPriceChange.changedBy ?? 'Compte indisponible', date: formatDate(latestPriceChange.changedAt) } : null}
      productId={product.id} />
    <details className={styles.help}>
      <summary>Historique du tarif unitaire</summary>
      <PriceHistory history={product.salePriceHistory} title='Historique du prix unitaire' />
    </details>
  </div>;

  return (
    <EditingSessionProvider key={product.id}>
      <main className={`${styles.page} mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-9`}>
        <nav aria-label='Fil d’Ariane' className={styles.breadcrumb}>
          <EditingLink href={returnHref}>Produits</EditingLink>
          <span aria-hidden='true'>/</span><span>Fiche produit</span>
        </nav>
        <header className={styles.hero}>
          <div className={styles.heroMain}>
            <span className={styles.heroIcon}><ProductIcon name='box' /></span>
            <div className='min-w-0'><p className={styles.eyebrow}>Fiche produit</p><h1>{product.designation}</h1>
              <div className={styles.meta}><code>{product.code}</code><span aria-hidden='true' className={styles.dot} /><span>Unité de base : {baseUnitLabel}</span></div>
            </div>
          </div>
          <dl className={styles.heroSummary}>
            <div><dt>Disponible</dt><dd className={product.stock.availableQuantityInBaseUnits > 0 ? styles.positive : product.stock.availableQuantityInBaseUnits < 0 ? styles.negative : ''}><DisplayQuantity quantity={product.stock.availableQuantityInBaseUnits} unitOptions={unitOptions} /></dd></div>
            {canReadPricing && <div><dt>Prix de vente TTC</dt><dd>{displaySalePrice !== null ? `${formatMoney(displaySalePrice)} DA` : 'À renseigner'}{displaySalePrice !== null && <span>/ {getDisplayUnitLabel(unitOptions)}</span>}</dd></div>}
          </dl>
        </header>
        <ProductTabs activeTab={activeTab} productId={product.id} returnHref={returnHref} tabs={tabs} />
        <div>
          {activeTab === 'stock' && <StockSection baseUnitLabel={baseUnitLabel} displayUnit={displayUnit} product={product} />}
          {activeTab === 'identification' && <div aria-labelledby='identification-tab' id='identification-panel'>
            <SectionHeading title='Identification & traçabilité' description='Les informations du produit, sa création et sa dernière modification renseignée.' />
            <div className={styles.infoGrid}>
              <ProductEditForm baseUnits={BASE_UNITS} baseUnitLabel={baseUnitLabel} canUpdateProduct={canUpdateProduct}
                initiallyOpen={query.modifier === '1' && canUpdateProduct} product={{ id: product.id, code: product.code, designation: product.designation, baseUnit: product.baseUnit }} />
              <aside className={styles.card} aria-labelledby='traceability-title'>
                <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='clock' /><h2 id='traceability-title'>Traçabilité</h2></div></div>
                <dl className={styles.timeline}>
                  {product.updatedAt && <div className={styles.event}><dt>Dernière modification</dt><dd>{formatDate(product.updatedAt)}<span>Par {product.updatedBy ?? 'Compte indisponible'}</span></dd></div>}
                  {product.createdAt && <div className={styles.event}><dt>Création du produit</dt><dd>{formatDate(product.createdAt)}<span>Par {product.createdBy ?? 'Compte indisponible'}</span></dd></div>}
                  {!product.createdAt && !product.updatedAt && <p className={styles.priceHint}>Aucun événement renseigné.</p>}
                </dl>
              </aside>
            </div>
            {permissions.includes('products.delete') && <details className={styles.dangerZone}>
              <summary>Actions sensibles</summary>
              <div><p>La suppression dépend des références et des règles métier du produit.</p><DeleteProductButton product={{ id: product.id, code: product.code, designation: product.designation }} returnHref={returnHref} /></div>
            </details>}
          </div>}
          {activeTab === 'tarification' && <div aria-labelledby='tarification-tab' id='tarification-panel'>
            <SectionHeading title='Tarification' note='Montants TTC en DA' description={canReadPricing ? 'Prix de vente à l’unité et par pack, dernier coût d’achat renseigné et historique.' : 'Dernier coût d’achat renseigné et réception source.'} />
            <div className={`${styles.priceGrid} ${canReadPricing && canReadPurchaseCosts ? '' : styles.priceSingle}`}>
              {canReadPricing && <section aria-labelledby='sale-pricing-title' className={`${styles.card} ${styles.priceCurrent}`}>
                <div className={styles.cardHead}><div className={styles.cardTitle}><ProductIcon name='price' /><h2 id='sale-pricing-title'>Prix de vente TTC</h2></div></div>
                <PackPricing packagings={product.packagings} productId={product.id} baseUnitLabel={baseUnitLabel} canReadPackaging={canReadPackaging}
                  basePriceInCentimes={product.salePrice?.amountInCentimes ?? null} canUpdatePrice={canUpdatePrice} unitPricing={unitPricing} />
              </section>}
              {canReadPurchaseCosts && <PurchaseCostCard baseUnitLabel={baseUnitLabel} purchaseCost={latestPurchaseCost}
                 />}
            </div>
            {canReadPricing && canReadPurchaseCosts && <PurchasePriceGap baseUnitLabel={baseUnitLabel} purchaseCost={latestPurchaseCost} salePriceInCentimes={product.salePrice?.amountInCentimes ?? null} />}
            {canReadPurchaseCosts && <details className={styles.help}><summary>Comment lire le coût d’achat ?</summary><p>Il provient de la dernière ligne de réception compatible dont le montant TTC et la quantité permettent un calcul. Ce n’est pas un coût moyen ni une valorisation FIFO. L’écart vente − dernier achat est uniquement une comparaison de montants unitaires.</p></details>}
          </div>}
          {activeTab === 'conditionnements' && <div aria-labelledby='conditionnements-tab' id='conditionnements-panel'>
            <SectionHeading title='Conditionnements' description='Des conversions claires pour les achats et les réceptions.' />
            <section aria-label='Unité de stock' className={styles.unitBanner}>
              <ProductIcon name='box' /><div><strong>Unité de stock : 1 {baseUnitLabel.toLocaleLowerCase('fr')}</strong><p>Chaque conditionnement est converti directement en unités de base.</p></div>
            </section>
            <DefaultSaleUnitForm baseUnitLabel={baseUnitLabel} canUpdateProduct={canUpdateProduct} defaultSaleUnit={product.defaultSaleUnit}
              packagings={product.packagings} productId={product.id} />
            <PackagingForm baseUnitLabel={baseUnitLabel} canCreatePackaging={canReadPackaging && permissions.includes('packaging.create')}
              canDeletePackaging={canReadPackaging && permissions.includes('packaging.delete')} defaultSaleUnit={product.defaultSaleUnit} packagings={product.packagings}
              product={{ id: product.id, code: product.code, designation: product.designation }} />
          </div>}
        </div>
      </main>
    </EditingSessionProvider>
  );
};

export default ProductPage;
