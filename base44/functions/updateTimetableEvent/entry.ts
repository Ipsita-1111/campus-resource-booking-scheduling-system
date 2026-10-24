import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { updateTimetableEventCore } from '../../shared/timetableCore.ts';

// Update an existing scheduled class. Faculty/admin only; validated server-side.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { eventId, updates } = body;
    if (!eventId) return Response.json({ error: 'eventId is required' }, { status: 400 });

    const result = await updateTimetableEventCore(base44, user, eventId, updates || {});
    if (result.success) return Response.json(result);
    if (result.notAuthorized) return Response.json(result, { status: 403 });
    if (result.validationError) return Response.json(result, { status: 400 });
    return Response.json(result, { status: 500 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}