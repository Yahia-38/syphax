'use client';

import { createContext, useContext, useState } from 'react';

import { formatProfitabilityAmount, formatProfitabilityExactAmount } from '../../../lib/profitability-format.js';
import styles from './profitability.module.css';

// The reading only changes how amounts are written: never the report, its
// filters or its address.
const AmountModeContext = createContext({ exact: false, setExact: () => {} });

export const AmountModeProvider = ({ children }) => {
  const [exact, setExact] = useState(false);

  return <AmountModeContext value={{ exact, setExact }}>{children}</AmountModeContext>;
};

export const useExactAmounts = () => useContext(AmountModeContext).exact;

export const AmountModeToggle = () => {
  const { exact, setExact } = useContext(AmountModeContext);

  return (
    <div className={styles.modeControl}>
      <span id='profitability-amount-mode'>Lecture des montants</span>
      <div aria-labelledby='profitability-amount-mode' className={styles.mode} role='group'>
        <button aria-pressed={!exact} onClick={() => setExact(false)} type='button'>Lecture courante</button>
        <button aria-pressed={exact} onClick={() => setExact(true)} type='button'>Dinars exacts</button>
      </div>
    </div>
  );
};

export const Amount = ({ unknownLabel = 'Inconnu', value }) => {
  const exact = useExactAmounts();
  const formatted = exact ? formatProfitabilityExactAmount(value) : formatProfitabilityAmount(value);

  return formatted
    ? <span className={value < 0 ? styles.negative : undefined} title={exact ? undefined : formatProfitabilityExactAmount(value)}>{formatted}</span>
    : <span className={styles.unknown}>{unknownLabel}</span>;
};

// The exact amount stays readable without hovering, next to the usual reading.
export const ExactAmountLine = ({ fallback, value }) => {
  const exact = useExactAmounts();
  const formatted = formatProfitabilityExactAmount(value);
  // Below 10 000 DA the usual reading is already exact.
  const differs = formatted && formatted !== formatProfitabilityAmount(value);

  return <>{!exact && differs ? `Soit ${formatted}` : fallback}</>;
};
