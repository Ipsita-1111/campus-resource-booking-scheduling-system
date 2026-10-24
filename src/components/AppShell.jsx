import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRole, ROLE_LABELS } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  GraduationCap,
  LayoutDashboard,
  Search,
  LogOut,
  Menu,
  ClipboardCheck,
  CalendarClock,
  BookOpen,
  BarChart3,
} from 'lucide-react';

// Nav items render only when their page is built (no fake/disabled links).
// The approval queue is only shown to faculty and administrators.
export default function AppShell() {
  const { user, logout } = useAuth();
  const role = normalizeRole(user);
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const NAV = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/resources', label: 'Find a Space', icon: Search },
    { to: '/my-requests', label: 'My Requests', icon: CalendarClock },
  ];
  if (role === 'FACULTY' || role === 'ADMINISTRATOR') {
    NAV.splice(2, 0, { to: '/approvals', label: 'Approval Queue', icon: ClipboardCheck });
    NAV.push({ to: '/timetable', label: 'Timetable', icon: BookOpen });
  }
  if (role === 'ADMINISTRATOR') {
    NAV.push({ to: '/utilization', label: 'Utilization', icon: BarChart3 });
  }

  const initials = (user?.full_name || user?.email || 'U')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-primary-foreground" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">CRBS</div>
          <div className="text-[11px] text-muted-foreground">Campus Booking</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active =
            location.pathname === to || location.pathname.startsWith(to + '/');
          return (
            <Link
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar className="w-9 h-9">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {user?.full_name || user?.email}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {ROLE_LABELS[role]}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start mt-1 text-muted-foreground"
          onClick={() => logout()}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-64 border-r border-border bg-card">
        {SidebarContent}
      </aside>

      {/* Mobile sidebar */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <div className="flex items-center justify-between h-16 px-4 border-b border-border bg-card sticky top-0 z-30">
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">CRBS</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => logout()}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            {SidebarContent}
          </SheetContent>
        </Sheet>
      </div>

      <main className="lg:pl-64">
        <div className="hidden lg:flex items-center justify-end h-16 px-6 border-b border-border bg-card/60 backdrop-blur sticky top-0 z-20">
          <Badge variant="outline" className="mr-3">
            {ROLE_LABELS[role]}
          </Badge>
          <span className="text-sm text-muted-foreground mr-3">
            {user?.email}
          </span>
          <Avatar className="w-8 h-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </div>
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}