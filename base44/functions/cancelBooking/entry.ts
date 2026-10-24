import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { cancelBookingCore } from '../../shared/bookingCore.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { bookingId, reason } = body;
    if (!bookingId) {
      return Response.json({ error: 'bookingId is required' }, { status: 400 });
    }

    const result = await cancelBookingCore(base44, user, bookingId, reason);
    const status = result.notAuthorized ? 403 : result.success ? 200 : 409;
    return Response.json(result, { status });
  } catch (error) {
    if (error.message === 'RESOURCE_LOCK_BUSY') {
      return Response.json(
        { success: false, status: 'CONFLICTED', reason: 'Resource is currently being modified. Please retry.' },
        { status: 503 }
      );
    }
    return Response.json(
      { success: false, status: 'ERROR', reason: error.message },
      { status: 500 }
    );
  }
}