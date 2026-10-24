// Shared booking UI helpers.

export const STATUS_VARIANT = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CONFLICTED: 'destructive',
  CANCELLED: 'outline',
  COMPLETED: 'default',
  EXPIRED: 'outline',
};

export const STATUS_TONE = {
  PENDING: 'text-amber-600',
  APPROVED: 'text-emerald-600',
  REJECTED: 'text-rose-600',
  CONFLICTED: 'text-rose-600',
  CANCELLED: 'text-muted-foreground',
  COMPLETED: 'text-emerald-600',
  EXPIRED: 'text-muted-foreground',
};

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Overlap check (half-open intervals; adjacent allowed).
export function overlaps(a, b) {
  return (
    new Date(a.start_time) < new Date(b.end_time) &&
    new Date(a.end_time) > new Date(b.start_time) &&
    a.resource_id === b.resource_id &&
    a.id !== b.id
  );
}

// Conflict indicator: another APPROVED or PENDING booking overlaps this one.
export function hasConflict(booking, allBookings) {
  return allBookings.some(
    (b) =>
      b.id !== booking.id &&
      b.resource_id === booking.resource_id &&
      (b.status === 'APPROVED' || b.status === 'PENDING') &&
      overlaps(booking, b)
  );
}

export const APPROVER_LABEL = {
  FACULTY: 'Faculty',
  ADMINISTRATOR: 'Administrator',
};