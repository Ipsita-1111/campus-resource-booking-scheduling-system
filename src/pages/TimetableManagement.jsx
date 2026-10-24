import React, { useEffect, useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRole } from '@/lib/roles';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, BookOpen, Ban, ShieldAlert } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import TimetableEventForm from '@/components/TimetableEventForm';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function TimetableManagement() {
  const { user } = useAuth();
  const role = normalizeRole(user);
  const { toast } = useToast();
  const [resources, setResources] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterResource, setFilterResource] = useState('ALL');
  const [q, setQ] = useState('');
  const [cancellingId, setCancellingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [res, ev] = await Promise.all([
        base44.entities.Resource.list(),
        base44.entities.TimetableEvent.list('-created_date', 200),
      ]);
      setResources(res);
      setEvents(ev);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resourceName = useMemo(() => {
    const m = {};
    resources.forEach((r) => (m[r.id] = r.name));
    return m;
  }, [resources]);

  const filtered = events.filter((e) => {
    if (filterResource !== 'ALL' && e.resource_id !== filterResource) return false;
    if (q) {
      const s = (e.course_name + ' ' + (e.course_code || '') + ' ' + (e.faculty_name || '')).toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const handleCancel = async (ev) => {
    setCancellingId(ev.id);
    try {
      const res = await base44.functions.invoke('cancelTimetableEvent', { eventId: ev.id });
      const r = res.data;
      if (r.success) {
        toast({ title: 'Class cancelled', description: ev.course_name });
        load();
      } else {
        toast({ title: 'Could not cancel', description: r.reason, variant: 'destructive' });
      }
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setCancellingId(null);
    }
  };

  if (role === 'STUDENT') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">
          Timetable management is restricted to faculty and administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Timetable Management</h1>
          <p className="text-muted-foreground mt-1">
            Schedule recurring classes and one-time sessions that block resource availability.
          </p>
        </div>
        <TimetableEventForm resources={resources} onSaved={load} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Input
          placeholder="Search by course, code or faculty"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={filterResource} onValueChange={setFilterResource}>
          <SelectTrigger><SelectValue placeholder="All resources" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All resources</SelectItem>
            {resources.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center text-sm text-muted-foreground">
          {filtered.length} class{filtered.length === 1 ? '' : 'es'}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No scheduled classes. Use “Add class” to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Course</th>
                  <th className="text-left font-medium px-4 py-3">Resource</th>
                  <th className="text-left font-medium px-4 py-3">When</th>
                  <th className="text-left font-medium px-4 py-3">Time</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ev) => (
                  <tr key={ev.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{ev.course_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {ev.course_code}{ev.faculty_name ? ` · ${ev.faculty_name}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {resourceName[ev.resource_id] || ev.resource_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {ev.recurrence === 'WEEKLY'
                        ? DAYS[ev.day_of_week]
                        : (ev.specific_date || '—')}
                      <div className="text-xs text-muted-foreground">
                        {ev.recurrence === 'WEEKLY' ? 'Weekly' : 'One-time'}
                      </div>
                    </td>
                    <td className="px-4 py-3">{ev.start_time}–{ev.end_time}</td>
                    <td className="px-4 py-3">
                      <Badge variant={ev.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                        {ev.status?.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <TimetableEventForm
                          resources={resources}
                          event={ev}
                          onSaved={load}
                          trigger={
                            <Button variant="ghost" size="sm" disabled={ev.status === 'CANCELLED'}>
                              Edit
                            </Button>
                          }
                        />
                        {ev.status === 'ACTIVE' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600"
                            disabled={cancellingId === ev.id}
                            onClick={() => handleCancel(ev)}
                          >
                            {cancellingId === ev.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Ban className="w-4 h-4" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}