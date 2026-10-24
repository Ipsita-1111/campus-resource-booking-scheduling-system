import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, CalendarSearch } from 'lucide-react';

// Reusable single-resource availability checker. Calls the central
// checkAvailability backend function (the same engine Find a Space uses).
export default function AvailabilityChecker({ resourceId, defaultDate }) {
  const [date, setDate] = useState(defaultDate || '');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [attendance, setAttendance] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);

  const canCheck = date && startTime && endTime && startTime < endTime && !checking;

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('checkAvailability', {
        resourceId,
        startDateTime: `${date}T${startTime}:00`,
        endDateTime: `${date}T${endTime}:00`,
        requestedCapacity: attendance ? Number(attendance) : null,
        bookingContext: { mode: 'SEARCH' },
      });
      setResult(res.data);
    } catch (e) {
      setResult({ available: false, conflictReason: e.message });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarSearch className="w-4 h-4" /> Check availability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ac-date" className="text-xs">Date</Label>
            <Input id="ac-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-start" className="text-xs">Start</Label>
            <Input id="ac-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-end" className="text-xs">End</Label>
            <Input id="ac-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac-att" className="text-xs">Attendance</Label>
            <Input id="ac-att" type="number" min="1" value={attendance} onChange={(e) => setAttendance(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <Button onClick={handleCheck} disabled={!canCheck} size="sm">
          {checking && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Check availability
        </Button>

        {result && (
          <div className={`flex items-start gap-2 rounded-md p-3 text-sm ${
            result.available
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
          }`}>
            {result.available
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <div>
              <div className="font-medium">
                {result.available ? 'Available for this slot' : 'Not available'}
              </div>
              {!result.available && result.conflictReason && (
                <div className="text-xs mt-0.5">{result.conflictReason}</div>
              )}
              {!result.available && result.conflictType && (
                <Badge variant="outline" className="mt-1.5">{result.conflictType}</Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}