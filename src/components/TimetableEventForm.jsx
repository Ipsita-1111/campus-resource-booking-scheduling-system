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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertTriangle, Plus, Pencil } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Reusable create/edit form for a TimetableEvent. Faculty/admin only (enforced
// server-side). `event` = null => create mode; otherwise edit mode.
export default function TimetableEventForm({ resources, event, onSaved, trigger }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const isEdit = !!event;
  const [form, setForm] = useState({
    resource_id: '',
    course_name: '',
    course_code: '',
    faculty_name: '',
    recurrence: 'WEEKLY',
    day_of_week: '1',
    specific_date: '',
    start_time: '09:00',
    end_time: '10:00',
    semester: '',
    academic_year: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (event) {
      setForm({
        resource_id: event.resource_id || '',
        course_name: event.course_name || '',
        course_code: event.course_code || '',
        faculty_name: event.faculty_name || '',
        recurrence: event.recurrence || 'WEEKLY',
        day_of_week: String(event.day_of_week != null ? event.day_of_week : '1'),
        specific_date: event.specific_date || '',
        start_time: event.start_time || '09:00',
        end_time: event.end_time || '10:00',
        semester: event.semester || '',
        academic_year: event.academic_year || '',
      });
    } else {
      setForm((f) => ({
        ...f,
        resource_id: resources[0]?.id || '',
      }));
    }
  }, [event, resources, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const canSubmit =
    form.resource_id && form.course_name && form.start_time && form.end_time &&
    form.start_time < form.end_time && !submitting &&
    (form.recurrence === 'WEEKLY' || form.specific_date);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        resource_id: form.resource_id,
        course_name: form.course_name,
        course_code: form.course_code || null,
        faculty_name: form.faculty_name || null,
        recurrence: form.recurrence,
        day_of_week: form.recurrence === 'WEEKLY' ? Number(form.day_of_week) : null,
        specific_date: form.recurrence === 'ONE_TIME' ? form.specific_date : null,
        start_time: form.start_time,
        end_time: form.end_time,
        semester: form.semester || null,
        academic_year: form.academic_year || null,
      };
      const fn = isEdit ? 'updateTimetableEvent' : 'createTimetableEvent';
      const body = isEdit ? { eventId: event.id, updates: payload } : payload;
      const res = await base44.functions.invoke(fn, body);
      const r = res.data;
      if (r.success) {
        toast({ title: isEdit ? 'Class updated' : 'Class added', description: `${payload.course_name} — ${payload.start_time}–${payload.end_time}` });
        setOpen(false);
        if (onSaved) onSaved();
      } else {
        setError(r.reason || 'Could not save class');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Add class
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit class' : 'Add scheduled class'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Resource</Label>
            <Select value={form.resource_id} onValueChange={(v) => set('resource_id', v)}>
              <SelectTrigger><SelectValue placeholder="Select resource" /></SelectTrigger>
              <SelectContent>
                {resources.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Course name</Label>
            <Input value={form.course_name} onChange={(e) => set('course_name', e.target.value)} placeholder="e.g. Database Systems" />
          </div>
          <div className="space-y-1.5">
            <Label>Course code</Label>
            <Input value={form.course_code} onChange={(e) => set('course_code', e.target.value)} placeholder="CS301" />
          </div>
          <div className="space-y-1.5">
            <Label>Faculty</Label>
            <Input value={form.faculty_name} onChange={(e) => set('faculty_name', e.target.value)} placeholder="Instructor name" />
          </div>
          <div className="space-y-1.5">
            <Label>Recurrence</Label>
            <Select value={form.recurrence} onValueChange={(v) => set('recurrence', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="ONE_TIME">One-time</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.recurrence === 'WEEKLY' ? (
            <div className="space-y-1.5">
              <Label>Day of week</Label>
              <Select value={form.day_of_week} onValueChange={(v) => set('day_of_week', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.specific_date} onChange={(e) => set('specific_date', e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Semester</Label>
            <Input value={form.semester} onChange={(e) => set('semester', e.target.value)} placeholder="Fall" />
          </div>
          <div className="space-y-1.5">
            <Label>Academic year</Label>
            <Input value={form.academic_year} onChange={(e) => set('academic_year', e.target.value)} placeholder="2026-2027" />
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add class'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}