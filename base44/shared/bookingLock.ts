// ============================================================
// PER-RESOURCE MUTEX backed by an atomic document-level conditional write.
//
// Base44's database is a document store. It does NOT expose multi-document
// transactions, SELECT ... FOR UPDATE, or PostgreSQL EXCLUDE USING GIST to the
// app builder. The strongest atomic primitive it DOES expose is a single-document
// conditional update (compare-and-swap): updateMany({ <match> }, { $set: ... })
// atomically updates a document only if it currently matches <match>.
//
// We use that to implement a per-resource mutex stored ON THE EXISTING RESOURCE
// ROW (never on the not-yet-existing booking row). Acquiring the lock is one
// atomic conditional update: set lock_held_by = me ONLY IF it is currently free
// (null/empty) or expired. Two concurrent acquisitions for the same resource
// are therefore serialized by the database engine at the document level — only
// one conditional update matches. The winner then runs the availability re-check
// + booking insert inside the critical section; the loser retries until the lock
// is released, then re-checks and sees the winner's booking as a conflict.
//
// This serializes the check-then-write critical section per resource, which is
// what prevents two overlapping bookings from both becoming APPROVED.
// ============================================================

const LOCK_TTL_MS = 30000;
const RETRIES = 15;
const BASE_BACKOFF_MS = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryAcquire(base44, resourceId, lockId) {
  const now = Date.now();
  const exp = now + LOCK_TTL_MS;
  // Atomic conditional update: claim the lock only if free or expired.
  await base44.entities.Resource.updateMany(
    {
      id: resourceId,
      $or: [
        { lock_held_by: null },
        { lock_held_by: '' },
        { lock_held_until: { $lt: now } },
      ],
    },
    { $set: { lock_held_by: lockId, lock_held_until: exp } }
  );
  // Verify we are the holder (read-back). Once we hold it, no one else can
  // acquire because their condition requires lock_held_by to be free/expired.
  const r = await base44.entities.Resource.get(resourceId);
  return !!r && r.lock_held_by === lockId;
}

export async function withResourceLock(base44, resourceId, lockId, fn) {
  let acquired = false;
  for (let i = 0; i < RETRIES; i++) {
    if (await tryAcquire(base44, resourceId, lockId)) {
      acquired = true;
      break;
    }
    await sleep(BASE_BACKOFF_MS * (i + 1) + Math.floor(Math.random() * 40));
  }
  if (!acquired) throw new Error('RESOURCE_LOCK_BUSY');

  try {
    return await fn();
  } finally {
    // Release only if we still hold it (conditional update prevents clobbering
    // a different owner that may have acquired after our TTL expired).
    try {
      await base44.entities.Resource.updateMany(
        { id: resourceId, lock_held_by: lockId },
        { $set: { lock_held_by: null, lock_held_until: null } }
      );
    } catch (e) {
      // best-effort release; lock will expire via TTL
    }
  }
}