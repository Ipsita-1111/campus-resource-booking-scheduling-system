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
import { Repeat, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const WEEKDAYS = [
  { idx: 1, label: 'Mon' },
  { idx: 2, label: 'Tue' },
  { idx: 3, label: 'Wed' },
  { idx: 4, label: 'Thu' },
  { idx: 5, label: 'Fri' },
  { idx: 6, label: 'Sat' },
  { idx: 0, label: 'Sun' },
];

export default function RecurringBookingDialog({ resource, onCreated, trigger }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [weekdays, setWeekdays] = useState([]);
  const [attendance, setAttendance] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [faculty, setFaculty] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const needsSupervisor =
    resource?.resource_type === 'LABORATORY' && resource?.requires_supervising_faculty;

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
    setTitle(''); setPurpose(''); setStartDate(''); setEndDate('');
    setStartTime(''); setEndTime(''); setWeekdays([]); setAttendance('');
    setSupervisorId(''); setResult(null);
  };

  const toggleDay = (idx) => {
    setWeekdays((prev) =>
      prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx].sort()
    );
  };

  const canSubmit =
    title && startDate && endDate && startTime && endTime &&
    startTime < endTime && weekdays.length > 0 &&
    new Date(startDate) <= new Date(endDate) &&
    (!resource?.open_time || startTime >= resource.open_time) &&
    (!resource?.close_time || endTime <= resource.close_time) &&
    (!needsSupervisor || !!supervisorId) && !submitting;

  const handleSubmit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const supervisor = faculty.find((f) => f.id === supervisorId);
      const res = await base44.functions.invoke('createRecurringBooking', {
        resourceId: resource.id,
        startDate,
        endDate,
        weekdays,
        startTime,
        endTime,
        title,
        purpose,
        expectedAttendance: attendance ? Number(attendance) : null,
        supervisingFacultyId: supervisorId || null,
        supervisingFacultyName: supervisor ? supervisor.full_name || supervisor.email : null,
      });
      const r = res.data;
      if (r.success) {
        setResult({ ok: true, ...r });
        toast({
          title: 'Recurring series submitted',
          description: `${r.summary.available} of ${r.summary.total} occurrences available, ${r.summary.conflicts} conflicted.`,
        });
        if (onCreated) onCreated();
      } else {
        setResult({ ok: false, reason: r.reason || r.error || 'Failed' });
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
          <Button variant="outline">
            <Repeat className="w-4 h-4 mr-2" /> Recurring booking
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recurring booking — {resource?.name}</DialogTitle>
        </DialogHeader>

        {result?.ok ? (
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 shrink-0" />
              <div>
                <div className="font-medium text-emerald-800 dark:text-emerald-200">
                  {result.summary.available} of {result.summary.total} occurrences submitted
                </div>
                <div className="text-sm text-emerald-700 dark:text-emerald-300">
                  {result.summary.conflicts > 0
                    ? `${result.summary.conflicts} conflicting date(s) skipped.`
                    : 'All occurrences are available.'}
                </div>
              </div>
            </div>

            {result.occurrences?.some((o) => !o.available) && (
              <div className="space-y-2">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600" /> Conflicting dates
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {result.occurrences
                    .filter((o) => !o.available)
                    .map((o) => (
                      <div
                        key={o.date}
                        className="flex items-start justify-between gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs"
                      >
                        <div className="font-medium">{o.date}</div>
                        <div className="text-muted-foreground text-right">{o.conflictReason}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <DialogClose asChild>
              <Button variant="outline" className="w-full">Done</Button>
            </DialogClose>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rc-title">Title</Label>
              <Input
                id="rc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. CS401 Lab sessions"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rc-start">Start date</Label>
                <Input
                  id="rc-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-end">End date</Label>
                <Input
                  id="rc-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-st">Start time</Label>
                <Input
                  id="rc-st"
                  type="time"
                  value={startTime}
                  min={resource?.open_time}
                  max={resource?.close_time}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-et">End time</Label>
                <Input
                  id="rc-et"
                  type="time"
                  value={endTime}
                  min={resource?.open_time}
                  max={resource?.close_time}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Repeat on</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(({ idx, label }) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      weekdays.includes(idx)
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-accent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rc-att">Expected attendance</Label>
                <Input
                  id="rc-att"
                  type="number"
                  min="1"
                  value={attendance}
                  onChange={(e) => setAttendance(e.target.value)}
                  placeholder={`Max ${resource?.capacity || ''}`}
                />
              </div>
              {needsSupervisor && (
                <div className="space-y-1.5">
                  <Label>Supervising faculty</Label>
                  <Select value={supervisorId} onValueChange={setSupervisorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supervisor" />
                    </SelectTrigger>
                    <SelectContent>
                      {faculty.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.full_name || f.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rc-purpose">Purpose</Label>
              <Textarea
                id="rc-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Brief description of the recurring activity"
                rows={2}
              />
            </div>

            {resource?.open_time && (
              <p className="text-xs text-muted-foreground">
                Operating hours: {resource.open_time}–{resource.close_time}. Capacity: {resource.capacity}.
                Each occurrence is checked individually against all existing bookings, timetable and blocks.
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
                Check & submit
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}