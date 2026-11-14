'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue: (n: number) => void;
  /** decimals to show when the value changes from outside (e.g. a slider) */
  digits?: number;
};

/**
 * A number field that lets you clear it or type "17." mid-edit without the
 * value snapping back, while still following outside changes (reset, slider).
 */
export default function NumberInput({ value, onValue, digits, ...rest }: Props) {
  const show = (n: number) => (digits == null ? String(n) : n.toFixed(digits));
  const [text, setText] = useState(() => show(value));
  const lastSent = useRef(value);

  useEffect(() => {
    if (value !== lastSent.current) {
      lastSent.current = value;
      setText(show(value));
    }
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        const v = Number.isFinite(n) ? n : 0;
        lastSent.current = v;
        onValue(v);
      }}
    />
  );
}
