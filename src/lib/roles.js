// Campus role normalization.
// The platform's built-in `role` ('admin'/'user') is kept intact for built-in
// admin privileges. The campus-specific role lives in `campus_role`.
export function normalizeRole(user) {
  if (!user) return 'STUDENT';
  if (user.role === 'admin') return 'ADMINISTRATOR';
  return user.campus_role || 'STUDENT';
}

export const ROLE_LABELS = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  ADMINISTRATOR: 'Administrator',
};