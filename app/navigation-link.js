'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NavigationLink = ({ href, className = '', children }) => {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'location' : undefined}
      className={`${className} min-h-11 ${active ? 'bg-blue-50 !text-blue-700' : ''}`}>
      {children}
    </Link>
  );
};

export default NavigationLink;
