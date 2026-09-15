'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

import ConfirmationDialog from '../confirmation-dialog.js';

const EditingContext = createContext(null);

export const EditingSessionProvider = ({ children }) => {
  const sessionRef = useRef(null);
  const dialogRef = useRef(null);
  const destinationRef = useRef(null);
  const triggerRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = `${pathname}${searchParams.size ? `?${searchParams}` : ''}`;
  const historyRef = useRef({ index: 0, url: currentUrl, restoring: false });

  const request = useCallback((proceed) => {
    const session = sessionRef.current;
    if (session?.pending) return;
    if (session?.dirty) {
      destinationRef.current = proceed;
      triggerRef.current = document.activeElement;
      dialogRef.current?.showModal();
      return;
    }
    session?.discard();
    proceed();
  }, []);

  const register = useCallback((session) => {
    sessionRef.current = session;
    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = historyRef.current;
    const storedIndex = window.history.state?.syphaxEditingIndex;
    const index = Number.isInteger(storedIndex)
      ? storedIndex
      : previous.index + (previous.url === currentUrl ? 0 : 1);
    window.history.replaceState({ ...window.history.state, syphaxEditingIndex: index }, '', currentUrl);
    historyRef.current = { index, url: currentUrl, restoring: false };
  }, [currentUrl]);

  useEffect(() => {
    const onPopState = (event) => {
      const previous = historyRef.current;
      if (previous.restoring) {
        previous.restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const session = sessionRef.current;
      if (!session?.dirty && !session?.pending) return;
      if (window.location.pathname !== pathname) return;
      const destination = `${window.location.pathname}${window.location.search}`;
      const targetIndex = event.state?.syphaxEditingIndex;
      // Only traverse entries belonging to this editing zone; older external
      // entries have no index and their direction cannot safely be inferred.
      if (!Number.isInteger(targetIndex)) return;
      const delta = targetIndex - previous.index;
      if (!delta) return;
      event.stopImmediatePropagation();
      previous.restoring = true;
      window.history.go(-delta);
      request(() => {
        if (destination !== previous.url) window.history.go(delta);
      });
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, [pathname, request]);

  return (
    <EditingContext.Provider value={{ register, request, router }}>
      {children}
      <ConfirmationDialog
        cancelLabel='Continuer la modification'
        confirmLabel='Quitter sans enregistrer'
        confirmType='button'
        dialogRef={dialogRef}
        onClose={() => {
          destinationRef.current = null;
          triggerRef.current?.focus();
        }}
        onConfirm={() => {
          const proceed = destinationRef.current;
          destinationRef.current = null;
          sessionRef.current?.discard();
          sessionRef.current = null;
          dialogRef.current?.close();
          proceed?.();
        }}
        title='Quitter la modification ?'
      >
        <p>Vos changements ne sont pas enregistrés. Vous pouvez poursuivre la modification ou abandonner le brouillon.</p>
      </ConfirmationDialog>
    </EditingContext.Provider>
  );
};

export const useEditingSession = () => useContext(EditingContext);

export const EditingLink = ({ href, children, ...props }) => {
  const session = useEditingSession();
  return (
    <Link {...props} href={href} onNavigate={(event) => {
      if (!session) return;
      event.preventDefault();
      session.request(() => session.router.push(href, { scroll: false }));
    }}>{children}</Link>
  );
};
