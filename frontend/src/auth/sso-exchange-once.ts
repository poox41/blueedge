export interface SsoExchangeGuard {
  current: boolean;
}

/**
 * Marks the page exchange as started before clearing the URL or issuing the
 * request. React StrictMode effect replay therefore cannot submit the code twice.
 */
export function startSsoExchangeOnce(
  guard: SsoExchangeGuard,
  clearCodeFromUrl: () => void,
  exchange: () => void,
): boolean {
  if (guard.current) return false;
  guard.current = true;
  clearCodeFromUrl();
  exchange();
  return true;
}
