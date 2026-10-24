import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

// Setters retain their originating session even if an async handler finishes after navigation.
export function useAgentSessionState<T>(taskId: string | null, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [values, setValues] = useState<Record<string, T>>({});
  const defaults = useRef<Record<string, T>>({});
  const key = taskId ?? 'new';
  if (!Object.hasOwn(defaults.current, key)) defaults.current[key] = typeof initial === 'function' ? (initial as () => T)() : initial;
  const fallback = () => defaults.current[key];
  const value = Object.hasOwn(values, key) ? values[key] : fallback();
  return [value, update => setValues(current => {
    const previous = Object.hasOwn(current, key) ? current[key] : fallback();
    return { ...current, [key]: typeof update === 'function' ? (update as (value: T) => T)(previous) : update };
  })];
}
