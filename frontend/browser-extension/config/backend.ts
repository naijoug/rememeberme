// Internal configuration only. Account sync remains on the canonical service.
export const SERVICE_ORIGIN = 'https://rememberme.couplelabs.cn';
// Optional account controls are enabled after session/migration verification.
// Sign-in checks server session capabilities; vocabulary upload remains opt-in.
export const ACCOUNT_SYNC_ENABLED = true;
export const PRIVACY_POLICY_URL = 'https://rememberme-lookup.couplelabs.workers.dev/privacy';
// Persistent HTTPS lookup gateway; service restarts do not change this address.
export const LOOKUP_SERVICE_ORIGIN = 'https://rememberme-lookup.couplelabs.workers.dev';
// Released capability; an explicit build false remains available for rollback. Server and user consent are separate gates.
export const CONTEXT_EXPLANATION_ENABLED = import.meta.env.VITE_CONTEXT_EXPLANATION_ENABLED !== 'false';
