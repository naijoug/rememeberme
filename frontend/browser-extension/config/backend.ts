// Internal configuration only. Account sync remains on the canonical service.
export const SERVICE_ORIGIN = 'https://rememberme.couplelabs.cn';
// Public releases expose only accepted features until canonical OAuth is available.
export const ACCOUNT_SYNC_ENABLED = false;
export const PRIVACY_POLICY_URL = 'https://lookup.couplelabs.cn/privacy';
// Persistent HTTPS lookup gateway; service restarts do not change this address.
export const LOOKUP_SERVICE_ORIGIN = 'https://lookup.couplelabs.cn';
