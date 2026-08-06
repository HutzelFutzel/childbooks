/**
 * Local text state that commits to the store on a debounce (and on blur /
 * unmount). Keeps typing snappy when the commit path re-renders the studio.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function useBufferedText(
  external: string,
  commit: (value: string) => void,
  debounceMs = 300,
) {
  const [value, setValue] = useState(external);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);
  const externalRef = useRef(external);
  const commitRef = useRef(commit);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  valueRef.current = value;
  externalRef.current = external;
  commitRef.current = commit;

  // Adopt external updates while the field isn't being edited.
  useEffect(() => {
    if (focusedRef.current) return;
    if (timerRef.current) return;
    setValue(external);
  }, [external]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = valueRef.current;
    if (next === externalRef.current) return;
    externalRef.current = next;
    commitRef.current(next);
  }, []);

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      valueRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const v = valueRef.current;
        if (v === externalRef.current) return;
        externalRef.current = v;
        commitRef.current(v);
      }, debounceMs);
    },
    [debounceMs],
  );

  const onFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const onBlur = useCallback(() => {
    focusedRef.current = false;
    flush();
  }, [flush]);

  useEffect(() => () => flush(), [flush]);

  return { value, onChange, onFocus, onBlur, flush };
}
