import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  MapPin,
  Users,
  Clock,
  ShieldAlert,
  Wrench,
  GraduationCap,
  Award,
  CheckCircle2,
} from 'lucide-react';
import BookingRequestDialog from '@/components/BookingRequestDialog';
import RecurringBookingDialog from '@/components/RecurringBookingDialog';
import AvailabilityChecker from '@/components/AvailabilityChecker';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ResourceDetail() {
  const { id } = useParams();
  const [resource, setResource] = useState(null);
  const [timetable, setTimetable] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [r, tt, bl] = await Promise.all([
          base44.entities.Resource.get(id),
          base44.entities.TimetableEvent.filter({ resource_id: id }),
          base44.entities.ResourceBlock.filter({ resource_id: id }),
        ]);
        setResource(r);
        setTimetable(tt);
        setBlocks(bl);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  if (!resource) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Resource not found.</p>
        <Button asChild variant="link">
          <Link to="/resources">Back to spaces</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link to="/resources">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to spaces
        </Link>
      </Button>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge>{resource.resource_type?.replace('_', ' ')}</Badge>
            <Badge
              variant={
                resource.availability_status === 'AVAILABLE'
                  ? 'secondary'
                  : 'outline'
              }
            >
              {resource.availability_status?.toLowerCase()}
            </Badge>
            {resource.requires_approval && (
              <Badge variant="outline">Approval required</Badge>
            )}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
            {resource.name}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            {resource.building}
            {resource.floor != null ? `, Floor ${resource.floor}` : ''}
            {resource.room_number ? ` · Room ${resource.room_number}` : ''}
          </p>
        </div>
        <div className="flex gap-6">
          <div className="text-center">
            <div className="flex items-center gap-1 text-muted-foreground text-xs justify-center">
              <Users className="w-3 h-3" /> Capacity
            </div>
            <div className="text-xl font-semibold">{resource.capacity}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-1 text-muted-foreground text-xs justify-center">
              <Clock className="w-3 h-3" /> Hours
            </div>
            <div className="text-xl font-semibold">
              {resource.open_time || '—'}–{resource.close_time || '—'}
            </div>
          </div>
        </div>
      </div>

      {resource.description && (
        <p className="text-muted-foreground max-w-3xl">
          {resource.description}
        </p>
      )}

      <AvailabilityChecker resourceId={resource.id} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-4 h-4" /> Booking constraints
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">Capacity</div>
                <div className="text-muted-foreground">{resource.capacity} people</div>
              </div>
            </div>
            {resource.resource_type === 'LABORATORY' && (
              <>
                <div className="flex items-start gap-2">
                  <GraduationCap className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Supervision required</div>
                    <div className="text-muted-foreground">
                      {resource.requires_supervising_faculty ? 'Yes' : 'No'}
                      {resource.supervising_faculty_name ? ` · ${resource.supervising_faculty_name}` : ''}
                    </div>
                  </div>
                </div>
                {resource.required_supervisor_qualification && (
                  <div className="flex items-start gap-2">
                    <Award className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">Supervisor qualification</div>
                      <div className="text-muted-foreground">{resource.required_supervisor_qualification}</div>
                    </div>
                  </div>
                )}
              </>
            )}
            {resource.required_certification_ids?.length > 0 && (
              <div className="flex items-start gap-2">
                <Award className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Required certification</div>
                  <div className="text-muted-foreground">{resource.required_certification_ids.join(', ')}</div>
                </div>
              </div>
            )}
            {resource.open_time && (
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">Operating hours</div>
                  <div className="text-muted-foreground">{resource.open_time}–{resource.close_time}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Weekly timetable</CardTitle>
          </CardHeader>
          <CardContent>
            {timetable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No scheduled classes.
              </p>
            ) : (
              <div className="space-y-2">
                {timetable.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0"
                  >
                    <div>
                      <div className="font-medium">{t.course_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.course_code} · {DAYS[t.day_of_week]} {t.start_time}–
                        {t.end_time}
                      </div>
                    </div>
                    <Badge variant="outline">{t.semester || ''}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Restrictions & blocks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" /> Restrictions
              </div>
              {resource.restrictions?.length ? (
                <div className="flex flex-wrap gap-1">
                  {resource.restrictions.map((x, i) => (
                    <Badge key={i} variant="secondary">
                      {x}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">None</span>
              )}
            </div>

            {resource.resource_type === 'LABORATORY' && (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">
                  Laboratory requirements
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">
                    Supervision {resource.requires_supervising_faculty ? 'required' : 'optional'}
                  </Badge>
                  {resource.required_supervisor_qualification && (
                    <Badge variant="outline">
                      Qualification: {resource.required_supervisor_qualification}
                    </Badge>
                  )}
                  {resource.required_certification_ids?.map((c, i) => (
                    <Badge key={i} variant="secondary">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Wrench className="w-3 h-3" /> Administrative blocks
              </div>
              {blocks.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  None scheduled.
                </span>
              ) : (
                blocks.map((b) => (
                  <div key={b.id} className="text-sm">
                    {b.reason} · {(b.start_time || '').slice(0, 16)} →{' '}
                    {(b.end_time || '').slice(0, 16)}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="font-semibold">Request this space</div>
          <p className="text-sm text-muted-foreground">
            {resource.requires_approval
              ? 'Requests for this resource require approval before confirmation.'
              : 'Submit a booking request for this resource.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BookingRequestDialog resource={resource} />
          <RecurringBookingDialog resource={resource} />
        </div>
      </div>
    </div>
  );
}