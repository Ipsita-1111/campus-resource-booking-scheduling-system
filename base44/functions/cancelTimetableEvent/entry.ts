import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { cancelTimetableEventCore } from '../../shared/timetableCore.ts';

// Cancel (soft-delete) a scheduled class. Faculty/admin only.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { eventId } = body;
    if (!eventId) return Response.json({ error: 'eventId is required' }, { status: 400 });

    const result = await cancelTimetableEventCore(base44, user, eventId);
    if (result.success) return Response.json(result);
    if (result.notAuthorized) return Response.json(result, { status: 403 });
    return Response.json(result, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}