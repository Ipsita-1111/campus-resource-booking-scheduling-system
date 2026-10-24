import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createTimetableEventCore, normalizeRole } from '../../shared/timetableCore.ts';

// Create a scheduled class (TimetableEvent). Only faculty and administrators
// may add timetable occupancy; students receive 403. Validation runs server-side.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const result = await createTimetableEventCore(base44, user, body);

    if (result.success) return Response.json(result);
    if (result.notAuthorized) return Response.json(result, { status: 403 });
    if (result.validationError) return Response.json(result, { status: 400 });
    return Response.json(result, { status: 500 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}