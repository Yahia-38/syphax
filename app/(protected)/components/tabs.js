import { EditingLink } from './editing-session.js';
import styles from './tabs.module.css';

// The one tab bar of the application. It renders the tabs the page offers and
// marks the active one; the page keeps ownership of where each tab leads,
// because only it knows the rest of its address.
//
// Deliberately not a client component: the fiches render it on the server and
// pass `buildHref`, which would not survive a client boundary.
const Tabs = ({ activeTab, buildHref, className = '', label, sticky = false, tabs }) => (
  <nav
    aria-label={label}
    className={`${styles.tabs} ${sticky ? styles.sticky : ''} ${className}`.trim()}
  >
    {tabs.map(({ icon = null, key, label: tabLabel }) => (
      <EditingLink
        aria-current={key === activeTab ? 'page' : undefined}
        href={buildHref(key)}
        id={`${key}-tab`}
        key={key}
      >
        {icon}{tabLabel}
      </EditingLink>
    ))}
  </nav>
);

export default Tabs;
