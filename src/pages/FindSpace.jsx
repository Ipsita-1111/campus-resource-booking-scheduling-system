import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Search, MapPin, Users, CalendarSearch } from 'lucide-react';

const TYPES = ['ALL', 'CLASSROOM', 'LABORATORY', 'SEMINAR_HALL'];
const TYPE_VARIANT = {
  CLASSROOM: 'secondary',
  LABORATORY: 'default',
  SEMINAR_HALL: 'outline',
};

export default function FindSpace() {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [type, setType] = useState('ALL');
  const [building, setBuilding] = useState('ALL');
  const [minCap, setMinCap] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [checkStart, setCheckStart] = useState('');
  const [checkEnd, setCheckEnd] = useState('');
  const [checkAttendance, setCheckAttendance] = useState('');
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState({}); // resourceId -> { available, conflictType, conflictReason }

  useEffect(() => {
    (async () => {
      try {
        setResources(await base44.entities.Resource.list());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const buildings = useMemo(
    () => [
      'ALL',
      ...Array.from(
        new Set(resources.map((r) => r.building).filter(Boolean))
      ),
    ],
    [resources]
  );

  const filtered = resources.filter((r) => {
    if (type !== 'ALL' && r.resource_type !== type) return false;
    if (building !== 'ALL' && r.building !== building) return false;
    if (minCap && (r.capacity || 0) < Number(minCap)) return false;
    if (q) {
      const s = (r.name + ' ' + r.building + ' ' + (r.description || '')).toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const canCheck =
    checkDate && checkStart && checkEnd && checkStart < checkEnd && !checking;

  const runAvailabilityCheck = async () => {
    setChecking(true);
    setAvailability({});
    const startDateTime = `${checkDate}T${checkStart}:00`;
    const endDateTime = `${checkDate}T${checkEnd}:00`;
    const requestedCapacity = checkAttendance ? Number(checkAttendance) : null;
    const results = await Promise.all(
      filtered.map(async (r) => {
        try {
          const res = await base44.functions.invoke('checkAvailability', {
            resourceId: r.id,
            startDateTime,
            endDateTime,
            requestedCapacity,
            bookingContext: { mode: 'SEARCH' },
          });
          return [r.id, res.data];
        } catch (e) {
          return [r.id, { available: false, conflictReason: e.message }];
        }
      })
    );
    setAvailability(Object.fromEntries(results));
    setChecking(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          Find a Space
        </h1>
        <p className="text-muted-foreground mt-1">
          Search classrooms, laboratories and seminar halls across campus.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or building"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === 'ALL' ? 'All types' : t.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={building} onValueChange={setBuilding}>
          <SelectTrigger>
            <SelectValue placeholder="Building" />
          </SelectTrigger>
          <SelectContent>
            {buildings.map((b) => (
              <SelectItem key={b} value={b}>
                {b === 'ALL' ? 'All buildings' : b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min="0"
          placeholder="Min capacity"
          value={minCap}
          onChange={(e) => setMinCap(e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarSearch className="w-4 h-4 text-primary" />
            Check real-time availability
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:flex lg:flex-1 gap-3">
            <Input type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} className="lg:w-40" />
            <Input type="time" value={checkStart} onChange={(e) => setCheckStart(e.target.value)} className="lg:w-32" />
            <Input type="time" value={checkEnd} onChange={(e) => setCheckEnd(e.target.value)} className="lg:w-32" />
            <Input type="number" min="1" placeholder="Attendance" value={checkAttendance} onChange={(e) => setCheckAttendance(e.target.value)} className="lg:w-28" />
            <Button onClick={runAvailabilityCheck} disabled={!canCheck} size="sm" className="lg:w-auto">
              {checking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Check availability
            </Button>
          </div>
        </div>
        {Object.keys(availability).length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Showing availability for {checkDate} {checkStart}–{checkEnd}. Clear the slot to hide.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p>No resources match your filters.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <Link
              key={r.id}
              to={`/resources/${r.id}`}
              className="block rounded-2xl border border-border bg-card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{r.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {r.building}
                    {r.floor != null ? `, Floor ${r.floor}` : ''}
                    {r.room_number ? ` · ${r.room_number}` : ''}
                  </p>
                </div>
                <Badge variant={TYPE_VARIANT[r.resource_type] || 'secondary'}>
                  {r.resource_type?.replace('_', ' ')}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {r.capacity}
                </span>
                <span
                  className={`flex items-center gap-1 ${
                    r.availability_status === 'AVAILABLE'
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }`}
                >
                  ● {r.availability_status?.toLowerCase()}
                </span>
              </div>
              {availability[r.id] && (
                <div className={`mt-3 rounded-md px-3 py-2 text-xs font-medium ${
                  availability[r.id].available
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                }`}>
                  {availability[r.id].available
                    ? 'Available for this slot'
                    : `Unavailable — ${availability[r.id].conflictReason || availability[r.id].conflictType || 'conflict'}`}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}