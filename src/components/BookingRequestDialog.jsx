import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CalendarPlus, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

export default function BookingRequestDialog({ resource, onCreated, trigger }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [attendance, setAttendance] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [faculty, setFaculty] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const needsSupervisor = resource?.resource_type === 'LABORATORY' && resource?.requires_supervising_faculty;

  useEffect(() => {
    if (open && needsSupervisor) {
      (async () => {
        try {
          const users = await base44.entities.User.list();
          setFaculty(users.filter((u) => u.campus_role === 'FACULTY'));
        } catch (e) {
          setFaculty([]);
        }
      })();
    }
  }, [open, needsSupervisor]);

  const reset = () => {
    setDate(''); setStartTime(''); setEndTime(''); setTitle(''); setPurpose(''); setAttendance(''); setSupervisorId(''); setResult(null);
  };

  const canSubmit =
    date && startTime && endTime && title && !submitting &&
    startTime < endTime &&
    (!resource?.open_time || startTime >= resource.open_time) &&
    (!resource?.close_time || endTime <= resource.close_time) &&
    (!needsSupervisor || !!supervisorId);

  const handleSubmit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const startDateTime = `${date}T${startTime}:00`;
      const endDateTime = `${date}T${endTime}:00`;
      const supervisor = faculty.find((f) => f.id === supervisorId);
      const res = await base44.functions.invoke('createBooking', {
        resourceId: resource.id,
        startDateTime,
        endDateTime,
        title,
        purpose,
        expectedAttendance: attendance ? Number(attendance) : null,
        supervisingFacultyId: supervisorId || null,
        supervisingFacultyName: supervisor ? (supervisor.full_name || supervisor.email) : null,
        idempotencyKey: `${resource.id}|${startDateTime}|${endDateTime}|${title}|${Date.now()}`,
      });
      const r = res.data;
      if (r.success) {
        setResult({ ok: true, status: r.status });
        toast({ title: r.status === 'APPROVED' ? 'Booking approved' : 'Request submitted', description: `${r.title || title} — ${r.status}` });
        if (onCreated) onCreated();
      } else {
        setResult({ ok: false, reason: r.reason || r.status });
      }
    } catch (e) {
      setResult({ ok: false, reason: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <CalendarPlus className="w-4 h-4 mr-2" /> Request this space
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request {resource?.name}</DialogTitle>
        </DialogHeader>

        {result?.ok ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" />
            <div className="font-medium">
              {result.status === 'APPROVED' ? 'Booking approved' : 'Request submitted'}
            </div>
            <p className="text-sm text-muted-foreground">
              {result.status === 'APPROVED'
                ? 'Your booking was auto-approved and added to the schedule.'
                : 'Your request is now pending approval. You can track it under My Requests.'}
            </p>
            <DialogClose asChild>
              <Button variant="outline" className="mt-2">Done</Button>
            </DialogClose>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bk-title">Title</Label>
                <Input id="bk-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Project review meeting" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-date">Date</Label>
                <Input id="bk-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-att">Expected attendance</Label>
                <Input id="bk-att" type="number" min="1" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder={`Max ${resource?.capacity || ''}`} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-start">Start time</Label>
                <Input id="bk-start" type="time" value={startTime} min={resource?.open_time} max={resource?.close_time} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-end">End time</Label>
                <Input id="bk-end" type="time" value={endTime} min={resource?.open_time} max={resource?.close_time} onChange={(e) => setEndTime(e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="bk-purpose">Purpose</Label>
                <Textarea id="bk-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Brief description of the activity" rows={2} />
              </div>
              {needsSupervisor && (
                <div className="col-span-2 space-y-1.5">
                  <Label>Supervising faculty</Label>
                  <Select value={supervisorId} onValueChange={setSupervisorId}>
                    <SelectTrigger><SelectValue placeholder="Select a supervisor" /></SelectTrigger>
                    <SelectContent>
                      {faculty.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.full_name || f.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {resource.required_supervisor_qualification && (
                    <p className="text-xs text-muted-foreground">
                      Requires qualification: {resource.required_supervisor_qualification}
                    </p>
                  )}
                </div>
              )}
              {resource?.required_certification_ids?.length > 0 && (
                <div className="col-span-2 text-xs text-muted-foreground">
                  This resource requires certification: {resource.required_certification_ids.join(', ')}.
                </div>
              )}
            </div>

            {resource?.open_time && (
              <p className="text-xs text-muted-foreground">
                Operating hours: {resource.open_time}–{resource.close_time}. Capacity: {resource.capacity}.
              </p>
            )}

            {result && !result.ok && (
              <div className="flex items-start gap-2 rounded-md bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{result.reason}</span>
              </div>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}