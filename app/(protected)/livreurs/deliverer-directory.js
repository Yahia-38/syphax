'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import styles from './deliverer-list.module.css';

// Keep the directory and its GET controls rendered on the server. Enhance only
// explicit list navigation; typing never starts a request.
const DelivererDirectory = ({ children, returnHref, appliedQuery, announcement }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const directoryRef = useRef(null);
  const navigationRef = useRef(false);
  const wasPendingRef = useRef(false);

  useEffect(() => {
    const focusSearch = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
        || event.target.closest('input, textarea, select') || event.target.isContentEditable) return;
      event.preventDefault();
      directoryRef.current?.querySelector('input[type="search"]')?.focus();
    };
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (wasPendingRef.current && !pending) {
      navigationRef.current = false;
      directoryRef.current?.querySelector('#deliverer-result-count')?.focus({ preventScroll: true });
    }
    wasPendingRef.current = pending;
  }, [pending]);

  const navigate = (href, retry = false) => {
    if (navigationRef.current) return;
    navigationRef.current = true;
    startTransition(() => {
      if (retry || href === returnHref) router.refresh();
      else router.push(href, { scroll: false });
    });
  };

  return (
    <section aria-labelledby='deliverer-list-title' aria-busy={pending} className={styles.directory} ref={directoryRef}
      onSubmit={(event) => {
        if (event.target.getAttribute('role') !== 'search') return;
        event.preventDefault();
        const parameters = new URLSearchParams(new FormData(event.target));
        navigate(`/livreurs?${parameters.toString()}`);
      }}
      onClickCapture={(event) => {
        const link = event.target.closest('a');
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const destination = new URL(link.href);
        if (destination.origin !== window.location.origin || destination.pathname !== '/livreurs') return;
        event.preventDefault();
        directoryRef.current.querySelector('input[type="search"]').value = appliedQuery;
        navigate(`${destination.pathname}${destination.search}`, link.hasAttribute('data-retry'));
      }}>
      <p className={styles.loading} role='status'>{pending ? 'Chargement des résultats…' : ''}</p>
      {pending && <div className={styles.loadingLine} aria-hidden='true' />}
      <div inert={pending ? true : undefined}>{children}</div>
      <p className='sr-only' role='status' aria-live='polite'>{pending ? '' : announcement}</p>
    </section>
  );
};

export default DelivererDirectory;
