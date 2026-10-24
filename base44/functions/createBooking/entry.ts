import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createBookingCore } from '../../shared/bookingCore.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { resourceId, startDateTime, endDateTime } = body;
    if (!resourceId || !startDateTime || !endDateTime) {
      return Response.json(
        { error: 'resourceId, startDateTime and endDateTime are required' },
        { status: 400 }
      );
    }

    const result = await createBookingCore(base44, user, body);
    return Response.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    if (error.message === 'RESOURCE_LOCK_BUSY') {
      return Response.json(
        { success: false, status: 'CONFLICTED', reason: 'Resource is currently being booked by another request. Please retry.' },
        { status: 503 }
      );
    }
    return Response.json(
      { success: false, status: 'ERROR', reason: error.message },
      { status: 400 }
    );
  }
}