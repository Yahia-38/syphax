import { buildProductHref } from '../../../../lib/product-list-navigation.js';
import Tabs from '../../components/tabs.js';
import ProductIcon from './product-icon.js';

const TAB_ICONS = { conditionnements: 'box', tarification: 'price' };

const ALL_TABS = [
  { key: 'stock', label: 'Stock' },
  { key: 'identification', label: 'Identification & traçabilité' },
  { key: 'tarification', label: 'Tarification' },
  { key: 'conditionnements', label: 'Conditionnements' },
];

// The page reads the address against the same list the bar renders, so a tab
// the reader cannot open is never selected.
export const getProductTabs = ({ canReadPackaging, canReadTarification }) =>
  ALL_TABS.filter(({ key }) => (
    (key !== 'conditionnements' || canReadPackaging)
    && (key !== 'tarification' || canReadTarification)
  ));

const ProductTabs = ({ activeTab, productId, returnHref, tabs }) => (
  <Tabs
    activeTab={activeTab}
    buildHref={(tab) => buildProductHref({ productId, returnHref, tab })}
    label='Sections de la fiche produit'
    sticky
    tabs={tabs.map((tab) => ({
      ...tab,
      icon: <ProductIcon name={TAB_ICONS[tab.key] ?? tab.key} />,
    }))}
  />
);

export default ProductTabs;
