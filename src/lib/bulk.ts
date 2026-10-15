/**
 * Limits on bulk approval at a desk, shared by the desk page and the
 * server (src/app/api/bills/bulk-action), which enforces them.
 */

/** At most this many bills in one bulk approval. */
export const BULK_MAX_BILLS = 75;
/** At most this much money (₹) in one bulk approval. */
export const BULK_MAX_TOTAL = 25_00_000;
/** A bill above this amount (₹) must be approved on its own. */
export const BULK_LARGE_BILL = 5_00_000;
/** How long the page waits, offering Undo, before sending a bulk approval. */
export const BULK_UNDO_MS = 8_000;
