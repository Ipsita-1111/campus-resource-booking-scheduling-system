import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { checkResourceAvailability } from '../../shared/availability.ts';

// Availability check endpoint. Frontend calls this to display availability.
// Booking creation and approval (Phase 4+) also call the shared engine before
// committing — see the concurrency note in shared/availability.ts.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { resourceId, startDateTime, endDateTime, requestedCapacity, supervisingFacultyId, bookingContext } = body;

    if (!resourceId || !startDateTime || !endDateTime) {
      return Response.json(
        { error: 'resourceId, startDateTime and endDateTime are required' },
        { status: 400 }
      );
    }

    const result = await checkResourceAvailability(base44, {
      resourceId,
      startDateTime,
      endDateTime,
      requestedBy: user.id,
      requestedCapacity,
      supervisingFacultyId,
      bookingContext,
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}