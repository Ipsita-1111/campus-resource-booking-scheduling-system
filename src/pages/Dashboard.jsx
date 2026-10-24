import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRole, ROLE_LABELS } from '@/lib/roles';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Bell,
} from 'lucide-react';

const STATUS_VARIANT = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CONFLICTED: 'destructive',
  CANCELLED: 'outline',
  COMPLETED: 'default',
  EXPIRED: 'outline',
};

export default function Dashboard() {
  const { user } = useAuth();
  const role = normalizeRole(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [resources, allBookings, myBookings, pendingAll, myNotifs] =
          await Promise.all([
            base44.entities.Resource.list(),
            base44.entities.Booking.list(),
            base44.entities.Booking.filter({ user_id: user.id }),
            base44.entities.Booking.filter({ status: 'PENDING' }),
            base44.entities.Notification.filter({ user_id: user.id }),
          ]);
        setData({ resources, allBookings, myBookings, pendingAll, myNotifs });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const isAdmin = role === 'ADMINISTRATOR';
  const bookings = isAdmin ? data.allBookings : data.myBookings;

  const cards = isAdmin
    ? [
        {
          label: 'Resources',
          value: data.resources.length,
          icon: Building2,
          hint: 'Managed campus spaces',
        },
        {
          label: 'Total bookings',
          value: data.allBookings.length,
          icon: CalendarClock,
          hint: 'All requests',
        },
        {
          label: 'Pending approvals',
          value: data.pendingAll.length,
          icon: CheckCircle2,
          hint: 'Awaiting action',
        },
        {
          label: 'Conflicts',
          value: data.allBookings.filter((b) => b.status === 'CONFLICTED')
            .length,
          icon: AlertTriangle,
          hint: 'Detected conflicts',
        },
      ]
    : [
        {
          label: 'My bookings',
          value: data.myBookings.length,
          icon: CalendarClock,
          hint: 'Submitted requests',
        },
        {
          label: 'Approved',
          value: bookings.filter((b) => b.status === 'APPROVED').length,
          icon: CheckCircle2,
          hint: 'Confirmed for you',
        },
        {
          label: 'Pending',
          value: bookings.filter((b) => b.status === 'PENDING').length,
          icon: AlertTriangle,
          hint: 'Awaiting decision',
        },
        {
          label: 'Notifications',
          value: data.myNotifs.length,
          icon: Bell,
          hint: 'Your updates',
        },
      ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          Welcome back
          {user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
        </h1>
        <div className="text-muted-foreground mt-1 flex items-center gap-2">
          <span>Signed in as</span>
          <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, hint }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground mt-1">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {isAdmin ? 'Recent bookings' : 'My recent bookings'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bookings.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <CalendarClock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No bookings yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {bookings.slice(0, 6).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <div className="font-medium">
                      {b.title || b.resource_name || 'Booking'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.resource_name} ·{' '}
                      {b.date || (b.start_time || '').slice(0, 10)}
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[b.status] || 'secondary'}>
                    {b.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/resources">Find a space</Link>
        </Button>
        {isAdmin && (
          <Button asChild variant="outline">
            <Link to="/utilization">View utilization</Link>
          </Button>
        )}
      </div>
    </div>
  );
}