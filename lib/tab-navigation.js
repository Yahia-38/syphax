// The single parameter that addresses a tab, everywhere in the application, so
// a deep link and a back navigation behave the same on every workspace.
export const TAB_PARAMETER = 'onglet';

const readSingleValue = (value) => Array.isArray(value) ? value[0] : value;

// Accepts either the plain object a server page receives or the
// URLSearchParams a client component reads, and rejects a repeated parameter:
// an address that names two tabs names none.
const readParameter = (source, key) => {
  if (source && typeof source.getAll === 'function') {
    const values = source.getAll(key);
    return values.length === 1 ? values[0] : undefined;
  }

  const value = source?.[key];
  return Array.isArray(value)
    ? (value.length === 1 ? value[0] : undefined)
    : value;
};

// `tabs` are the keys the page actually offers, already filtered by permission,
// so a tab the reader cannot open never wins. `fallback` is the page's own
// default, which depends on things a tab bar has no business knowing.
export const readTab = (source, tabs = [], fallback) => {
  const requested = readParameter(source, TAB_PARAMETER);
  const available = tabs.map((tab) => (
    typeof tab === 'string' ? tab : tab?.key
  ));

  if (available.includes(requested)) return requested;

  return available.includes(fallback) ? fallback : available[0] ?? '';
};

// Keeps the rest of the address intact, for the workspaces whose tabs share a
// page with their own filters.
export const withTab = (search, tab) => {
  const parameters = new URLSearchParams(search);

  parameters.set(TAB_PARAMETER, tab);

  return parameters;
};
