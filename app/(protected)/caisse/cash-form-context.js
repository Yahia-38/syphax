'use client';

import { createContext, useContext, useEffect, useRef } from 'react';

export const CashNoticeContext = createContext(null);
export const useCashNotice = () => useContext(CashNoticeContext);

export const useCashFormLifecycle = ({ onPending, onDraftChange, pending, uncertain, values, result }) => {
  const formRef = useRef(null);
  const draft = JSON.stringify(values);
  useEffect(() => { onPending(pending || uncertain); }, [onPending, pending, uncertain]);
  useEffect(() => { onDraftChange(draft); }, [onDraftChange, draft]);
  useEffect(() => {
    if (!result || pending) return;
    requestAnimationFrame(() => {
      (formRef.current?.querySelector('[aria-invalid="true"]') ?? formRef.current?.querySelector('[role="alert"]'))?.focus();
    });
  }, [result, pending]);
  return formRef;
};
