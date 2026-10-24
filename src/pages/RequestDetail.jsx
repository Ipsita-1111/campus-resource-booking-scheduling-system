import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRole, ROLE_LABELS } from '@/lib/roles';
import { base44 } from '@/api/base44Client';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft, CheckCircle2, XCircle, Ban, Loader2, MapPin, Users, Clock,
  ShieldCheck, AlertTriangle, History, CalendarDays,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  STATUS_VARIANT, fmtDate, fmtTime, fmtDateTime, APPROVER_LABEL,
} from '@/lib/booking-ui';

const AUDIT_LABEL = {
  BOOKING_CREATED: 'Created',
  BOOKING_APPROVED: 'Approved',
  BOOKING_REJECTED: 'Rejected',
  BOOKING_CONFLICTED: 'Conflicted',
  BOOKING_CANCELLED: 'Cancelled',
  BOOKING_COMPLETED: 'Completed',
};

export default function RequestDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = normalizeRole(user);
  const { toast } = useToast();
  const [booking, setBooking] = useState(null);
  const [resource, setResource] = useState(null);
  const [audits, setAudits] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = async () => {
    try {
      const b = await base44.entities.Booking.get(id);
      setBooking(b);
      if (b) {
        const [r, au] = await Promise.all([
          base44.entities.Resource.get(b.resource_id),
          base44.entities.AuditLog.filter({ booking_id: id }),
        ]);
        setResource(r);
        setAudits(au.sort((x, y) => new Date(y.created_date) - new Date(x.created_date)));
        try {
          const res = await base44.functions.invoke('checkAvailability', {
            resourceId: b.resource_id,
            startDateTime: b.start_time,
            endDateTime: b.end_time,
            requestedCapacity: b.expected_attendance,
            bookingContext: { excludeBookingId: b.id, treatPendingAsOccupancy: false },
          });
          setAvailability(res.data);
        } catch (e) { setAvailability(null); }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  if (!booking) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Request not found.</p>
        <Button asChild variant="link"><Link to="/approvals">Back to approvals</Link></Button>
      </div>
    );
  }

  const canApprove = role !== 'STUDENT' && booking.status === 'PENDING' && booking.user_id !== user.id &&
    (role === 'ADMINISTRATOR' || (booking.required_approver_role === 'FACULTY' &&
      (!resource?.supervising_faculty_id || resource.supervising_faculty_id === user.id)));
  const canCancel = (booking.user_id === user.id || role === 'ADMINISTRATOR') &&
    (booking.status === 'PENDING' || booking.status === 'APPROVED');

  const act = async (fn, payload, okMsg) => {
    setActing(fn);
    try {
      const res = await base44.functions.invoke(fn, payload);
      const r = res.data;
      if (r.success) {
        toast({ title: okMsg });
      } else if (r.notAuthorized) {
        toast({ variant: 'destructive', title: 'Not authorized', description: r.reason });
      } else {
        toast({ variant: 'destructive', title: 'Action failed', description: r.reason || r.status });
      }
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally { setActing(null); }
  };

  const doApprove = () => act('approveBooking', { bookingId: booking.id }, 'Request approved');
  const doReject = async () => {
    await act('rejectBooking', { bookingId: booking.id, reason: rejectReason }, 'Request rejected');
    setRejectOpen(false); setRejectReason('');
  };
  const doCancel = async () => {
    await act('cancelBooking', { bookingId: booking.id, reason: cancelReason }, 'Request cancelled');
    setCancelOpen(false); setCancelReason('');
  };

  const available = availability?.available;
  const conflicts = availability?.conflicts || [];

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link to="/approvals"><ArrowLeft className="w-4 h-4 mr-1" /> Back to approvals</Link>
      </Button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge variant={STATUS_VARIANT[booking.status]}>{booking.status}</Badge>
            <Badge variant="outline">{APPROVER_LABEL[booking.required_approver_role] || 'Administrator'} approval</Badge>
            {booking.auto_approved && <Badge variant="secondary">Auto-approved</Badge>}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">{booking.title}</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="w-4 h-4" /> {booking.resource_name} · {booking.resource_type?.replace('_', ' ')}
          </p>
        </div>
        {(canApprove || canCancel) && (
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <>
                <Button onClick={doApprove} disabled={!!acting}>
                  {acting === 'approveBooking' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
                <Button variant="outline" onClick={() => setRejectOpen(true)}>
                  <XCircle className="w-4 h-4 mr-2" /> Reject
                </Button>
              </>
            )}
            {canCancel && (
              <Button variant="outline" onClick={() => setCancelOpen(true)}>
                <Ban className="w-4 h-4 mr-2" /> Cancel request
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Request details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><CalendarDays className="w-3 h-3" /> Date</div>
                <div className="font-medium">{fmtDate(booking.start_time)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Clock className="w-3 h-3" /> Time</div>
                <div className="font-medium">{fmtTime(booking.start_time)}–{fmtTime(booking.end_time)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Users className="w-3 h-3" /> Expected attendance</div>
                <div className="font-medium">{booking.expected_attendance ?? '—'}{resource ? ` / ${resource.capacity} capacity` : ''}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Requester</div>
                <div className="font-medium">{booking.user_name || '—'}</div>
              </div>
            </div>
            {booking.purpose && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Purpose</div>
                <p className="text-sm">{booking.purpose}</p>
              </div>
            )}
            {(booking.rejection_reason || booking.conflict_reason) && (
              <div className="rounded-md bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">
                <div className="flex items-center gap-1.5 font-medium mb-1"><AlertTriangle className="w-4 h-4" />{booking.status === 'REJECTED' ? 'Rejection reason' : 'Conflict reason'}</div>
                {booking.rejection_reason || booking.conflict_reason}
              </div>
            )}
            {booking.approved_by_name && (
              <div className="text-sm text-muted-foreground">
                {booking.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {booking.approved_by_name} on {fmtDateTime(booking.approved_date)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Current availability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {availability === null ? (
              <p className="text-sm text-muted-foreground">Checking…</p>
            ) : available ? (
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Available for this slot</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="font-medium">Not available</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {conflicts.slice(0, 4).map((c, i) => (
                    <li key={i}>• {c.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground pt-2 border-t border-border">
              Informational only. The Approve action re-checks availability on the backend under a resource lock.
            </p>
          </CardContent>
        </Card>
      </div>

      {resource && (
        <Card>
          <CardHeader><CardTitle>Resource constraints</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div><div className="text-xs text-muted-foreground mb-1">Operating hours</div><div>{resource.open_time}–{resource.close_time}</div></div>
            <div><div className="text-xs text-muted-foreground mb-1">Capacity</div><div>{resource.capacity}</div></div>
            <div><div className="text-xs text-muted-foreground mb-1">Approval required</div><div>{resource.requires_approval ? 'Yes' : 'No'}</div></div>
            {resource.resource_type === 'LABORATORY' && (
              <div><div className="text-xs text-muted-foreground mb-1">Supervising faculty</div><div>{resource.supervising_faculty_name || 'Unassigned'}</div></div>
            )}
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="text-xs text-muted-foreground mb-1">Restrictions</div>
              {resource.restrictions?.length ? (
                <div className="flex flex-wrap gap-1">{resource.restrictions.map((x, i) => <Badge key={i} variant="secondary">{x}</Badge>)}</div>
              ) : <span className="text-muted-foreground">None</span>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="w-4 h-4" /> Request history</CardTitle></CardHeader>
        <CardContent>
          {audits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recorded history.</p>
          ) : (
            <ol className="relative border-l border-border pl-5 space-y-4">
              {audits.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="absolute -left-[7px] w-3 h-3 rounded-full bg-primary mt-1" />
                  <div className="font-medium">{AUDIT_LABEL[a.action] || a.action}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.user_name || 'System'} · {fmtDateTime(a.created_date)}
                    {a.previous_status && a.new_status ? ` · ${a.previous_status} → ${a.new_status}` : ''}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Reject request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rd-reason">Reason (optional)</Label>
              <Textarea id="rd-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={doReject} disabled={acting === 'rejectBooking'}>
              {acting === 'rejectBooking' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancel request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">This will cancel your request. The slot will be released.</p>
            <div className="space-y-1.5">
              <Label htmlFor="cn-reason">Reason (optional)</Label>
              <Textarea id="cn-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Keep request</Button></DialogClose>
            <Button variant="outline" onClick={doCancel} disabled={acting === 'cancelBooking'}>
              {acting === 'cancelBooking' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Confirm cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}