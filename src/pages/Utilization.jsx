import React, { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import {
  Building2,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Lightbulb,
  Loader2,
  BarChart3,
} from 'lucide-react';

const RANGE_OPTIONS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'semester', label: 'This semester' },
  { value: 'custom', label: 'Custom range' },
];

const PIE_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Utilization() {
  const { user } = useAuth();
  const role = normalizeRole(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const payload = { range };
      if (range === 'custom' && customStart) payload.startDate = customStart;
      if (range === 'custom' && customEnd) payload.endDate = customEnd;
      const res = await base44.functions.invoke('getUtilization', payload);
      setData(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range !== 'custom') load();
  }, [range]);

  if (role !== 'ADMINISTRATOR') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="text-muted-foreground">
          The utilization dashboard is restricted to administrators.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        Unable to load utilization data.
      </div>
    );
  }

  const s = data.summary;
  const cards = [
    { label: 'Resources', value: s.totalResources, icon: Building2, tone: 'text-primary' },
    { label: 'Utilization', value: `${s.utilizationPct}%`, icon: BarChart3, tone: 'text-emerald-600' },
    { label: 'Booked hours', value: s.totalBookedHours, icon: Clock, tone: 'text-primary' },
    { label: 'Approved', value: s.totalApproved, icon: CheckCircle2, tone: 'text-emerald-600' },
    { label: 'Pending', value: s.totalPending, icon: Clock, tone: 'text-amber-600' },
    { label: 'Conflicts', value: s.totalConflicts, icon: AlertTriangle, tone: 'text-rose-600' },
    { label: 'Cancellations', value: s.totalCancellations, icon: Ban, tone: 'text-muted-foreground' },
    { label: 'Class hours', value: s.timetableHours, icon: Clock, tone: 'text-primary' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Utilization Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Resource utilization across campus · {data.range.startDate} to {data.range.endDate}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {range === 'custom' && (
            <>
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-40"
              />
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-40"
              />
              <Button size="sm" onClick={load} disabled={!customStart || !customEnd}>
                Apply
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon className={`w-4 h-4 ${tone}`} />
              </div>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.insights?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="w-4 h-4 text-amber-500" /> Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.insights.map((insight, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  {insight}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resource utilization</CardTitle>
          </CardHeader>
          <CardContent>
            {data.mostUtilized?.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No booking data in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={[...data.mostUtilized, ...data.leastUtilized].slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="utilization" fill="#4f46e5" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Utilization by resource type</CardTitle>
          </CardHeader>
          <CardContent>
            {data.utilizationByType?.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No data available.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.utilizationByType}
                    dataKey="bookedHours"
                    nameKey="type"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e) => e.type.replace('_', ' ')}
                  >
                    {data.utilizationByType.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `${v} hrs`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking volume over time</CardTitle>
        </CardHeader>
        <CardContent>
          {data.volumeOverTime?.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No bookings in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.volumeOverTime}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="approved" stroke="#10b981" strokeWidth={2} />
                <Line type="monotone" dataKey="pending" stroke="#f59e0b" strokeWidth={2} />
                <Line type="monotone" dataKey="conflicted" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="cancelled" stroke="#94a3b8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4 text-emerald-600" /> Most utilized
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.mostUtilized?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data.</p>
            ) : (
              <div className="space-y-2">
                {data.mostUtilized.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.type.replace('_', ' ')} · {r.bookedHours} hrs</div>
                    </div>
                    <Badge variant="default">{r.utilization}%</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="w-4 h-4 text-muted-foreground" /> Least utilized
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.leastUtilized?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data.</p>
            ) : (
              <div className="space-y-2">
                {data.leastUtilized.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.type.replace('_', ' ')} · {r.bookedHours} hrs</div>
                    </div>
                    <Badge variant="outline">{r.utilization}%</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.utilizationByBuilding?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Utilization by building</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.utilizationByBuilding}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="building" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Bar dataKey="utilization" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}