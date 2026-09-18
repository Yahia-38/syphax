export const isMainNavigationLinkActive = (pathname, href) => {
  if (typeof pathname !== 'string' || typeof href !== 'string') return false;
  if (pathname === href) return true;
  return href !== '/' && pathname.startsWith(`${href}/`);
};
