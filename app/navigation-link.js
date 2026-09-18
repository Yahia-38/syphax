'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { isMainNavigationLinkActive } from '../lib/main-navigation.js';

const NavigationLink = ({ href, className = '', children }) => {
  const pathname = usePathname();
  const active = isMainNavigationLinkActive(pathname, href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? 'bg-blue-50 !text-blue-700' : ''}`}>
      {children}
    </Link>
  );
};

export default NavigationLink;
