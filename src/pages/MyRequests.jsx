import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CalendarClock, Eye, Ban, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { STATUS_VARIANT, fmtDate, fmtTime } from '@/lib/booking-ui';

const STATUS_OPTIONS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CONFLICTED', 'CANCELLED', 'COMPLETED'];

export default function MyRequests() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('ALL');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [acting, setActing] = useState(false);

  const load = async () => {
    try {
      const bk = await base44.entities.Booking.filter({ user_id: user.id });
      bk.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      setBookings(bk);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [user.id]);

  const filtered = bookings.filter((b) => status === 'ALL' || b.status === status);

  const doCancel = async () => {
    if (!cancelTarget) return;
    setActing(true);
    try {
      const res = await base44.functions.invoke('cancelBooking', { bookingId: cancelTarget.id, reason: cancelReason });
      const r = res.data;
      if (r.success) toast({ title: 'Request cancelled' });
      else toast({ variant: 'destructive', title: 'Could not cancel', description: r.reason || r.status });
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally { setActing(false); setCancelTarget(null); setCancelReason(''); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">My requests</h1>
        <p className="text-muted-foreground mt-1">Track the status of your booking requests.</p>
      </div>

      <div className="flex items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : s.toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="outline"><Link to="/resources">Find a space</Link></Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No requests yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((b) => {
            const cancellable = b.status === 'PENDING' || b.status === 'APPROVED';
            return (
              <Card key={b.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{b.title}</div>
                      <div className="text-xs text-muted-foreground">{b.resource_name}</div>
                    </div>
                    <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {fmtDate(b.start_time)} · {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                  </div>
                  {b.rejection_reason && <p className="text-xs text-rose-600">{b.rejection_reason}</p>}
                  {b.conflict_reason && <p className="text-xs text-rose-600">{b.conflict_reason}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/approvals/${b.id}`}><Eye className="w-4 h-4 mr-1" /> Details</Link>
                    </Button>
                    {cancellable && (
                      <Button variant="outline" size="sm" onClick={() => setCancelTarget(b)}>
                        <Ban className="w-4 h-4 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(o) => { if (!o) { setCancelTarget(null); setCancelReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancel request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Cancel “{cancelTarget?.title}”? The slot will be released.</p>
            <div className="space-y-1.5">
              <Label htmlFor="mr-reason">Reason (optional)</Label>
              <Textarea id="mr-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Keep</Button></DialogClose>
            <Button variant="outline" onClick={doCancel} disabled={acting}>
              {acting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Confirm cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}