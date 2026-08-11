export {
  API_KEY_PREFIX,
  type Auth,
  type AuthOptions,
  CLI_CLIENT_ID,
  createAuth,
  resolveRole,
  type SocialProviderCredentials,
} from "./auth";
export {
  createApiKeyFor,
  ensureUser,
  type Identity,
  mintApiKeyForEmail,
  type Role,
  roleOf,
  ROLES,
  setRole,
  setRoleByEmail,
  verifyApiKeyIdentity,
} from "./identity";
