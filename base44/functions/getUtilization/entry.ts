import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// ============================================================
// UTILIZATION ANALYTICS — computes real utilization metrics from
// persisted Booking, TimetableEvent and Resource data. No fake stats.
// Admin-only.
// ============================================================

function rangeFor(preset, customStart, customEnd) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'custom') {
    const s = customStart ? new Date(customStart + 'T00:00:00') : new Date(today);
    const e = customEnd ? new Date(customEnd + 'T23:59:59') : new Date(today);
    return { start: s, end: e };
  }
  if (preset === 'week') {
    const day = today.getDay();
    const start = new Date(today.getTime() - day * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    end.setHours(23, 59, 59);
    return { start, end };
  }
  if (preset === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    return { start, end };
  }
  if (preset === 'semester') {
    // Approximate a semester as ~4 months around the current date.
    const m = today.getMonth();
    let semStartMonth;
    if (m >= 7) semStartMonth = 7;       // Aug start
    else if (m >= 0) semStartMonth = 0;  // Jan start
    const start = new Date(today.getFullYear(), semStartMonth, 1);
    const end = new Date(today.getFullYear(), semStartMonth + 4, 0, 23, 59, 59);
    return { start, end };
  }
  // default: month
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

function hoursBetween(msA, msB) {
  return (msB - msA) / 3600000;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — administrators only' }, { status: 403 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // GET or empty body — default to month
    }
    const preset = body.range || 'month';
    const customStart = body.startDate;
    const customEnd = body.endDate;
    const { start, end } = rangeFor(preset, customStart, customEnd);

    const startMs = start.getTime();
    const endMs = end.getTime();
    const daysInRange = Math.max(1, Math.ceil((endMs - startMs) / 86400000));

    const [resources, bookings, timetable] = await Promise.all([
      base44.entities.Resource.list('-created_date', 500),
      base44.entities.Booking.list('-created_date', 500),
      base44.entities.TimetableEvent.list('-created_date', 500),
    ]);

    // Filter bookings that overlap the range.
    const inRange = bookings.filter((b) => {
      const bs = new Date(b.start_time).getTime();
      const be = new Date(b.end_time).getTime();
      return bs < endMs && be > startMs;
    });

    const approved = inRange.filter((b) => b.status === 'APPROVED');
    const conflicts = inRange.filter((b) => b.status === 'CONFLICTED');
    const cancelled = inRange.filter((b) => b.status === 'CANCELLED');
    const pending = inRange.filter((b) => b.status === 'PENDING');

    // Total booked hours (approved only, clamped to range).
    let totalBookedHours = 0;
    const resourceBookedHours = {};
    const resourceBookedCount = {};
    for (const b of approved) {
      const bs = Math.max(new Date(b.start_time).getTime(), startMs);
      const be = Math.min(new Date(b.end_time).getTime(), endMs);
      const hrs = Math.max(0, hoursBetween(bs, be));
      totalBookedHours += hrs;
      resourceBookedHours[b.resource_id] = (resourceBookedHours[b.resource_id] || 0) + hrs;
      resourceBookedCount[b.resource_id] = (resourceBookedCount[b.resource_id] || 0) + 1;
    }

    // Add timetable hours to occupancy (scheduled classes also occupy resources).
    let timetableHours = 0;
    for (const t of timetable) {
      if (t.status !== 'ACTIVE') continue;
      // Weekly recurring: estimate occurrences in range.
      if (t.recurrence === 'ONE_TIME' && t.specific_date) {
        const d = new Date(t.specific_date + 'T00:00:00').getTime();
        if (d >= startMs && d <= endMs) {
          const [sh, sm] = t.start_time.split(':').map(Number);
          const [eh, em] = t.end_time.split(':').map(Number);
          const hrs = (eh * 60 + em - sh * 60 - sm) / 60;
          timetableHours += hrs;
          resourceBookedHours[t.resource_id] = (resourceBookedHours[t.resource_id] || 0) + hrs;
        }
      } else if (t.recurrence === 'WEEKLY') {
        // Count weekdays in range that match t.day_of_week.
        let count = 0;
        for (let d = new Date(startMs); d.getTime() <= endMs; d = new Date(d.getTime() + 86400000)) {
          if (d.getDay() === t.day_of_week) count++;
        }
        if (count > 0) {
          const [sh, sm] = t.start_time.split(':').map(Number);
          const [eh, em] = t.end_time.split(':').map(Number);
          const hrs = ((eh * 60 + em - sh * 60 - sm) / 60) * count;
          timetableHours += hrs;
          resourceBookedHours[t.resource_id] = (resourceBookedHours[t.resource_id] || 0) + hrs;
        }
      }
    }

    // Available hours = sum over resources of (operating_hours_per_day * daysInRange) - booked.
    let totalAvailableHours = 0;
    for (const r of resources) {
      let dailyHours = 8; // default
      if (r.open_time && r.close_time) {
        const [oh, om] = r.open_time.split(':').map(Number);
        const [ch, cm] = r.close_time.split(':').map(Number);
        dailyHours = Math.max(0, (ch * 60 + cm - oh * 60 - om) / 60);
      }
      totalAvailableHours += dailyHours * daysInRange;
    }
    const totalOccupiedHours = totalBookedHours + timetableHours;
    const utilizationPct = totalAvailableHours > 0
      ? Math.round((totalOccupiedHours / totalAvailableHours) * 1000) / 10
      : 0;

    // Per-resource utilization.
    const resourceStats = resources.map((r) => {
      let dailyHours = 8;
      if (r.open_time && r.close_time) {
        const [oh, om] = r.open_time.split(':').map(Number);
        const [ch, cm] = r.close_time.split(':').map(Number);
        dailyHours = Math.max(0, (ch * 60 + cm - oh * 60 - om) / 60);
      }
      const cap = dailyHours * daysInRange;
      const used = resourceBookedHours[r.id] || 0;
      return {
        id: r.id,
        name: r.name,
        type: r.resource_type,
        building: r.building,
        bookedHours: Math.round(used * 10) / 10,
        capacityHours: Math.round(cap * 10) / 10,
        utilization: cap > 0 ? Math.round((used / cap) * 1000) / 10 : 0,
        bookingCount: resourceBookedCount[r.id] || 0,
      };
    });
    const sorted = [...resourceStats].sort((a, b) => b.utilization - a.utilization);
    const mostUtilized = sorted.slice(0, 5);
    const leastUtilized = sorted.filter((s) => s.utilization < 100).reverse().slice(0, 5);

    // Utilization by resource type.
    const byType = {};
    for (const s of resourceStats) {
      if (!byType[s.type]) byType[s.type] = { bookedHours: 0, capacityHours: 0, count: 0 };
      byType[s.type].bookedHours += s.bookedHours;
      byType[s.type].capacityHours += s.capacityHours;
      byType[s.type].count += 1;
    }
    const utilizationByType = Object.entries(byType).map(([type, v]) => ({
      type,
      bookedHours: Math.round(v.bookedHours * 10) / 10,
      capacityHours: Math.round(v.capacityHours * 10) / 10,
      utilization: v.capacityHours > 0 ? Math.round((v.bookedHours / v.capacityHours) * 1000) / 10 : 0,
      resourceCount: v.count,
    }));

    // Utilization by building.
    const byBuilding = {};
    for (const s of resourceStats) {
      const b = s.building || 'Unspecified';
      if (!byBuilding[b]) byBuilding[b] = { bookedHours: 0, capacityHours: 0, count: 0 };
      byBuilding[b].bookedHours += s.bookedHours;
      byBuilding[b].capacityHours += s.capacityHours;
      byBuilding[b].count += 1;
    }
    const utilizationByBuilding = Object.entries(byBuilding).map(([building, v]) => ({
      building,
      bookedHours: Math.round(v.bookedHours * 10) / 10,
      capacityHours: Math.round(v.capacityHours * 10) / 10,
      utilization: v.capacityHours > 0 ? Math.round((v.bookedHours / v.capacityHours) * 1000) / 10 : 0,
      resourceCount: v.count,
    })).sort((a, b) => b.utilization - a.utilization);

    // Peak booking hours (by hour-of-day from approved bookings).
    const hourCounts = new Array(24).fill(0);
    for (const b of approved) {
      const bs = new Date(b.start_time);
      const be = new Date(b.end_time);
      let cursor = new Date(bs);
      while (cursor < be) {
        hourCounts[cursor.getHours()]++;
        cursor = new Date(cursor.getTime() + 3600000);
      }
    }
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Booking volume over time (daily counts in range, by status).
    const dailyMap = {};
    for (const b of inRange) {
      const day = (b.start_time || '').slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { date: day, approved: 0, pending: 0, conflicted: 0, cancelled: 0 };
      const key = (b.status || '').toLowerCase();
      if (dailyMap[day][key] !== undefined) dailyMap[day][key]++;
    }
    const volumeOverTime = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Insights.
    const insights = [];
    if (mostUtilized.length > 0 && mostUtilized[0].utilization > 0) {
      insights.push(`${mostUtilized[0].name} has the highest utilization at ${mostUtilized[0].utilization}%.`);
    }
    const under = resourceStats.filter((s) => s.utilization === 0 && s.capacityHours > 0);
    if (under.length > 0) {
      insights.push(`${under[0].name} is underutilized (0% utilization in this period).`);
    }
    if (utilizationByType.length >= 2) {
      const top = [...utilizationByType].sort((a, b) => b.utilization - a.utilization)[0];
      if (top && top.utilization > 0) {
        insights.push(`${top.type.replace('_', ' ')}s are the most utilized resource type (${top.utilization}%).`);
      }
    }

    return Response.json({
      range: { preset, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) },
      summary: {
        totalResources: resources.length,
        totalBookedHours: Math.round(totalBookedHours * 10) / 10,
        timetableHours: Math.round(timetableHours * 10) / 10,
        totalAvailableHours: Math.round(totalAvailableHours * 10) / 10,
        utilizationPct,
        totalApproved: approved.length,
        totalPending: pending.length,
        totalConflicts: conflicts.length,
        totalCancellations: cancelled.length,
      },
      mostUtilized,
      leastUtilized,
      utilizationByType,
      utilizationByBuilding,
      peakHours,
      volumeOverTime,
      insights,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}