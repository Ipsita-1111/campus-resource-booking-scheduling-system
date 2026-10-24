import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRole, ROLE_LABELS } from '@/lib/roles';
import { base44 } from '@/api/base44Client';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2, XCircle, Eye, Loader2, ClipboardList, AlertTriangle,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  STATUS_VARIANT, fmtDate, fmtTime, fmtDateTime, hasConflict, APPROVER_LABEL,
} from '@/lib/booking-ui';

const STATUS_OPTIONS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'CONFLICTED', 'CANCELLED', 'COMPLETED'];

export default function Approvals() {
  const { user } = useAuth();
  const role = normalizeRole(user);
  const { toast } = useToast();
  const [bookings, setBookings] = useState([]);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('PENDING');
  const [resourceType, setResourceType] = useState('ALL');
  const [q, setQ] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [actingId, setActingId] = useState(null);

  const load = async () => {
    try {
      const [bk, rs] = await Promise.all([
        base44.entities.Booking.list('-created_date', 200),
        base44.entities.Resource.list(),
      ]);
      setBookings(bk);
      setResources(rs);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const resourceMap = useMemo(
    () => Object.fromEntries(resources.map((r) => [r.id, r])),
    [resources]
  );

  const canApprove = (b) => {
    if (role === 'ADMINISTRATOR') return b.status === 'PENDING';
    if (role === 'FACULTY') {
      if (b.status !== 'PENDING') return false;
      if (b.user_id === user.id) return false;
      if (b.required_approver_role !== 'FACULTY') return false;
      const r = resourceMap[b.resource_id];
      if (r?.supervising_faculty_id) return r.supervising_faculty_id === user.id;
      return true;
    }
    return false;
  };

  const filtered = bookings.filter((b) => {
    if (status !== 'ALL' && b.status !== status) return false;
    if (resourceType !== 'ALL' && b.resource_type !== resourceType) return false;
    if (dateFilter && (b.date || (b.start_time || '').slice(0, 10)) !== dateFilter) return false;
    if (q) {
      const s = (b.title + ' ' + b.user_name + ' ' + b.resource_name).toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const handleApprove = async (id) => {
    setActingId(id);
    try {
      const res = await base44.functions.invoke('approveBooking', { bookingId: id });
      const r = res.data;
      if (r.success) {
        toast({ title: 'Request approved', description: 'The booking is now confirmed.' });
      } else if (r.notAuthorized) {
        toast({ variant: 'destructive', title: 'Not authorized', description: r.reason });
      } else {
        toast({ variant: 'destructive', title: 'Could not approve', description: r.reason || r.status });
      }
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally { setActingId(null); }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await base44.functions.invoke('rejectBooking', { bookingId: rejectTarget.id, reason: rejectReason });
      const r = res.data;
      if (r.success) {
        toast({ title: 'Request rejected', description: 'The requester has been notified.' });
      } else if (r.notAuthorized) {
        toast({ variant: 'destructive', title: 'Not authorized', description: r.reason });
      } else {
        toast({ variant: 'destructive', title: 'Could not reject', description: r.reason || r.status });
      }
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setRejecting(false); setRejectTarget(null); setRejectReason('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-2">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Approval queue</h1>
          <p className="text-muted-foreground mt-1">
            Review and act on booking requests across campus resources.
          </p>
        </div>
        <Badge variant="outline">{ROLE_LABELS[role]} view</Badge>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Input placeholder="Search requester, title, resource" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === 'ALL' ? 'All statuses' : s.toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resourceType} onValueChange={setResourceType}>
          <SelectTrigger><SelectValue placeholder="Resource type" /></SelectTrigger>
          <SelectContent>
            {['ALL', 'CLASSROOM', 'LABORATORY', 'SEMINAR_HALL'].map((t) => (
              <SelectItem key={t} value={t}>{t === 'ALL' ? 'All types' : t.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No requests match your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Requester</th>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Date / Time</th>
                    <th className="px-4 py-3 font-medium">Attendance</th>
                    <th className="px-4 py-3 font-medium">Approver</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Conflict</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((b) => {
                    const conflict = hasConflict(b, bookings);
                    const approvable = canApprove(b);
                    return (
                      <tr key={b.id} className="hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.user_name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{b.title}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.resource_name}</div>
                          <div className="text-xs text-muted-foreground">{b.resource_type?.replace('_', ' ')}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{fmtDate(b.start_time)}</div>
                          <div className="text-xs text-muted-foreground">{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</div>
                        </td>
                        <td className="px-4 py-3">{b.expected_attendance ?? '—'}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{APPROVER_LABEL[b.required_approver_role] || 'Administrator'}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[b.status] || 'secondary'}>{b.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {conflict && b.status === 'PENDING' ? (
                            <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" /> Possible
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button asChild variant="ghost" size="icon" title="View details">
                              <Link to={`/approvals/${b.id}`}><Eye className="w-4 h-4" /></Link>
                            </Button>
                            {approvable && (
                              <>
                                <Button
                                  size="sm" variant="default"
                                  disabled={actingId === b.id}
                                  onClick={() => handleApprove(b.id)}
                                >
                                  {actingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                                  Approve
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  onClick={() => setRejectTarget(b)}
                                >
                                  <XCircle className="w-4 h-4 mr-1" /> Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reject “{rejectTarget?.title}” for {rejectTarget?.resource_name}. The requester will be notified.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="rej-reason">Reason (optional)</Label>
              <Textarea id="rej-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="e.g. Outside academic hours" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button variant="destructive" onClick={handleReject} disabled={rejecting}>
              {rejecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}