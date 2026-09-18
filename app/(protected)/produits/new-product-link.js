'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  buildNewProductHref,
  buildProductListHref,
  readProductListState,
} from '../../../lib/product-list-navigation.js';

// Reads the address the table keeps up to date, so creating a product returns
// to the filtered view it was started from.
const NewProductLink = ({ children, className }) => {
  const parameters = useSearchParams();
  const listHref = buildProductListHref(
    readProductListState(Object.fromEntries(parameters)),
  );

  return (
    <Link className={className} href={buildNewProductHref(listHref)}>
      {children}
    </Link>
  );
};

export default NewProductLink;
