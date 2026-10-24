import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import {
  GraduationCap,
  CalendarRange,
  ShieldCheck,
  Layers,
  ArrowRight,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Layers,
    title: 'Resource discovery',
    desc: 'Search classrooms, laboratories and seminar halls by building, capacity and equipment.',
  },
  {
    icon: CalendarRange,
    title: 'Conflict-aware scheduling',
    desc: 'Arbitrary time ranges with overlap detection across bookings, timetable and blocks.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval workflows',
    desc: 'Role-based approvals with concurrency-safe checks for students, faculty and admins.',
  },
  {
    icon: GraduationCap,
    title: 'Built for campus',
    desc: 'Timetable integration, recurring semester bookings and utilization analytics.',
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 lg:px-12 h-16 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold tracking-tight text-sm lg:text-base">
            Campus Resource Booking & Scheduling System
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button asChild>
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link to="/register">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <section className="px-6 lg:px-12 py-20 lg:py-28 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" /> University
          resource scheduling, reimagined
        </div>
        <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-tight">
          Book classrooms, labs & seminar halls with confidence.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          A unified platform to discover campus spaces, resolve scheduling
          conflicts, manage approvals, and visualize utilization — all in one
          place.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" asChild>
            <Link to={isAuthenticated ? '/dashboard' : '/register'}>
              {isAuthenticated ? 'Open dashboard' : 'Get started'}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
          {!isAuthenticated && (
            <Button size="lg" variant="outline" asChild>
              <Link to="/login">I already have an account</Link>
            </Button>
          )}
        </div>
      </section>

      <section className="px-6 lg:px-12 pb-24 max-w-6xl mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="rounded-2xl border border-border bg-card p-6"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Icon className="w-5 h-5" />
            </div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1.5">{desc}</p>
          </div>
        ))}
      </section>
    </div>
  );
}