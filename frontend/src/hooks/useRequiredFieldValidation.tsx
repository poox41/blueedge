/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from "react";

export type RequiredFieldRule<Field extends string> = {
  field: Field;
  valid: boolean;
  message: string;
  elementId: string;
};

export function useRequiredFieldValidation<Field extends string>() {
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const clearError = useCallback((field: Field) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const resetErrors = useCallback(() => setErrors({}), []);

  const validate = useCallback((rules: RequiredFieldRule<Field>[]) => {
    const nextErrors: Partial<Record<Field, string>> = {};
    rules.forEach((rule) => {
      if (!rule.valid) nextErrors[rule.field] = rule.message;
    });
    setErrors(nextErrors);

    const firstInvalid = rules.find((rule) => !rule.valid);
    if (!firstInvalid) return true;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(firstInvalid.elementId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    });
    return false;
  }, []);

  return { errors, clearError, resetErrors, validate };
}

export function RequiredFieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1.5 text-xs font-medium text-[var(--color-danger)]">{message}</p>;
}
