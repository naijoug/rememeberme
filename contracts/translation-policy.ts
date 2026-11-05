// Word translation budgets. Keep the first HTTP attempt longer than the complete
// Magpie -> MyMemory path, including time for the public gateway round trip.
export const WORD_PRIMARY_TIMEOUT_MS = 3_000;
export const WORD_FALLBACK_TIMEOUT_MS = 4_000;
export const TRANSLATION_FIRST_ATTEMPT_MS = WORD_PRIMARY_TIMEOUT_MS + WORD_FALLBACK_TIMEOUT_MS + 2_000;
export const TRANSLATION_REQUEST_BUDGET_MS = 2 * TRANSLATION_FIRST_ATTEMPT_MS + 1_000;
export const TRANSLATION_SERVICE_TIMEOUT_MS = TRANSLATION_REQUEST_BUDGET_MS + 1_000;
export const TRANSLATION_UI_TIMEOUT_MS = TRANSLATION_SERVICE_TIMEOUT_MS + 2_000;
export const TRANSLATION_CIRCUIT_FAILURES = 2;
export const TRANSLATION_CIRCUIT_COOLDOWN_MS = 30_000;
