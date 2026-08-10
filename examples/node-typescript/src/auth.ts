/**
 * The HTTP status a login attempt should produce: 200 for valid credentials,
 * 401 (Unauthorized) otherwise.
 */
export function loginStatus(credentialsValid: boolean): number {
  return credentialsValid ? 200 : 401;
}

/** How long, in milliseconds, an idle session may live before it expires. */
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
