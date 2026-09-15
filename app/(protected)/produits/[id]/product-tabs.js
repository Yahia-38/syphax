import { EditingLink } from '../../components/editing-session.js';
import ProductIcon from './product-icon.js';
import styles from './product-detail.module.css';

const TABS = [
  { label: 'Stock', section: 'stock' },
  { label: 'Identification & traçabilité', section: 'identification' },
  { label: 'Tarification', section: 'tarification' },
  { label: 'Conditionnements', section: 'conditionnements' },
];

const ProductTabs = ({
  activeSection,
  canReadPackaging,
  canReadPricing,
  canReadPurchaseCosts,
  productId,
}) => (
  <nav
    aria-label='Sections de la fiche produit'
    className={styles.tabs}
  >
    {TABS
      .filter((tab) => (
        (tab.section !== 'conditionnements' || canReadPackaging)
        && (
          tab.section !== 'tarification'
          || canReadPricing
          || canReadPurchaseCosts
        )
      ))
      .map((tab) => {
        const isActive = tab.section === activeSection;

        return (
          <EditingLink
            aria-current={isActive ? 'page' : undefined}
            href={`/produits/${productId}?section=${tab.section}`}
            id={`${tab.section}-tab`}
            key={tab.section}
          >
            <ProductIcon name={tab.section === 'conditionnements' ? 'box' : tab.section === 'tarification' ? 'price' : tab.section} />{tab.label}
          </EditingLink>
        );
      })}
  </nav>
);

export default ProductTabs;
