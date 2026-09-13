import Link from 'next/link';

const TABS = [
  { label: 'Identification & traçabilité', section: 'identification' },
  { label: 'Tarification', section: 'tarification' },
  { label: 'Conditionnements', section: 'conditionnements' },
];

const ProductTabs = ({ activeSection, canReadPackaging, productId }) => (
  <nav
    aria-label='Sections de la fiche produit'
    className='mt-6 flex flex-wrap gap-1'
    role='tablist'
  >
    {TABS
      .filter((tab) =>
        tab.section !== 'conditionnements' || canReadPackaging)
      .map((tab) => {
        const isActive = tab.section === activeSection;

        return (
          <Link
            aria-controls={`${tab.section}-panel`}
            aria-selected={isActive}
            className={`rounded-t-lg border-b-2 px-4 py-3 text-[15px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
              isActive
                ? 'border-blue-700 font-bold text-blue-700'
                : 'border-transparent font-medium text-slate-600 hover:text-slate-900'
            }`}
            href={`/produits/${productId}?section=${tab.section}`}
            id={`${tab.section}-tab`}
            key={tab.section}
            role='tab'
          >
            {tab.label}
          </Link>
        );
      })}
  </nav>
);

export default ProductTabs;
