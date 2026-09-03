import type { TaskOccurrenceAction } from '../task-occurrence-actions';
import { CourseColor, MeetingLocation, MeetingSeriesProjection } from '../../shared/workspace-course-contract';
import { AgendaItemProjection, CalendarHolidaySegmentProjection, MeetingTimeClassification, PlanMeetingProjection, PlanTaskProjection, TaskTimeClassification } from '../../shared/workspace-plan-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
import { TaskDeadline } from '../../shared/workspace-task-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
export const taskClassificationNames: Readonly<Record<TaskTimeClassification, string>> = {
    overdue: '逾期',
    today: '今天',
    'near-due': '即将到期',
    future: '未来',
    completed: '已完成',
    skipped: '已跳过',
    TBA: 'TBA',
};

export const taskOccurrenceActionLabels: Readonly<Record<TaskOccurrenceAction, string>> = {
    complete: '完成',
    skip: '跳过',
    restore: '恢复待完成',
};

export const meetingClassificationNames: Readonly<Record<MeetingTimeClassification, string>> = {
    upcoming: '即将开始',
    'in-progress': '进行中',
    ended: '已结束',
    cancelled: '已取消',
    'holiday-suppressed': '假期抑制',
};

export const courseColorNames: Readonly<Record<CourseColor, string>> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    gray: '灰色',
};

export const weekdayNames: Readonly<Record<MeetingSeriesProjection['weekday'], string>> = {
    MON: '星期一',
    TUE: '星期二',
    WED: '星期三',
    THU: '星期四',
    FRI: '星期五',
    SAT: '星期六',
    SUN: '星期日',
};

export const calendarWeekdayNames = [
    '星期日',
    '星期一',
    '星期二',
    '星期三',
    '星期四',
    '星期五',
    '星期六',
] as const;

export const shortWeekdayNames = [
    '周日',
    '周一',
    '周二',
    '周三',
    '周四',
    '周五',
    '周六',
] as const;

export const percentageFormatter = new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 0,
});

/**
 * Returns visible context without substituting a historical or invented Term.
 *
 * @param {SetupProjection} setup Current setup projection.
 * @return {string} Current Term context or an explicit missing state.
 */
export function termContext(setup: SetupProjection): string {
    if (!setup.currentTerm) {
        return '尚无当前学期';
    }

    return `${setup.currentTerm.name} · ${setup.currentTerm.startDate} - ${setup.currentTerm.endDate}`;
}

/**
 * Formats a persisted deadline union without assigning TBA to a date.
 *
 * @param {TaskDeadline} deadline Persisted occurrence deadline.
 * @return {string} User-visible deadline fact.
 */
export function taskDeadlineLabel(deadline: TaskDeadline): string {
    if (deadline.kind === 'date-only') {
        return deadline.date;
    }
    if (deadline.kind === 'timed') {
        return `${deadline.instant} · ${deadline.timeZone}`;
    }

    return 'TBA';
}

/**
 * Formats PLAN-owned remaining milliseconds for display without selecting or reclassifying a Task.
 *
 * @param {number} remainingMilliseconds Signed duration supplied by PLAN.
 * @return {string} Coarse, stable countdown text.
 */
export function remainingTimeLabel(remainingMilliseconds: number): string {
    if (remainingMilliseconds === 0) {
        return '现在到期';
    }

    const magnitude = Math.abs(remainingMilliseconds);
    const prefix = remainingMilliseconds > 0 ? '剩余时间' : '已逾期';
    const minutes = Math.max(1, Math.ceil(magnitude / 60_000));
    if (minutes < 60) {
        return `${prefix}：${minutes} 分钟`;
    }

    const hours = Math.ceil(magnitude / 3_600_000);
    if (hours < 24) {
        return `${prefix}：${hours} 小时`;
    }

    return `${prefix}：${Math.ceil(magnitude / 86_400_000)} 天`;
}

/**
 * Formats a meeting location while preserving TBA as its own state.
 *
 * @param {MeetingLocation} location Persisted meeting location.
 * @return {string} Known location text or TBA.
 */
export function meetingLocationLabel(location: MeetingLocation): string {
    return location.kind === 'known' ? location.value : 'TBA';
}

/**
 * Builds the stable identity used for a rendered Task occurrence.
 *
 * @param {PlanTaskProjection} task PLAN task projection.
 * @return {string} Stable Task occurrence identity.
 */
export function taskItemId(task: PlanTaskProjection): string {
    const { occurrenceId } = task.occurrence;
    return `task:${occurrenceId.taskSeriesId}:${occurrenceId.originalLogicalAnchor}`;
}

/**
 * Builds the stable identity used for a rendered Meeting occurrence.
 *
 * @param {PlanMeetingProjection} meeting PLAN meeting projection.
 * @return {string} Stable Meeting occurrence identity.
 */
export function meetingItemId(meeting: PlanMeetingProjection): string {
    const { occurrenceId } = meeting.occurrence;
    return `meeting:${occurrenceId.meetingSeriesId}:${occurrenceId.originalLogicalAnchor}`;
}

/**
 * Builds the stable identity used for a visible Holiday segment.
 *
 * @param {CalendarHolidaySegmentProjection} holiday Calendar holiday segment.
 * @return {string} Stable range and visible-segment identity.
 */
export function calendarHolidayItemId(holiday: CalendarHolidaySegmentProjection): string {
    return [
        'holiday',
        holiday.holidayRange.holidayRangeId,
        holiday.visibleStartDate,
        holiday.visibleEndDate,
    ].join(':');
}

/**
 * Returns a stable key for a Calendar PLAN item.
 *
 * @param {PlanMeetingProjection | PlanTaskProjection} item Calendar item.
 * @return {string} Stable occurrence identity.
 */
export function planItemId(item: PlanMeetingProjection | PlanTaskProjection): string {
    return item.kind === 'meeting' ? meetingItemId(item) : taskItemId(item);
}

/**
 * Returns a stable key for an Agenda item.
 *
 * @param {AgendaItemProjection} item Agenda item.
 * @return {string} Stable occurrence or Holiday identity.
 */
export function agendaItemId(item: AgendaItemProjection): string {
    if (item.kind === 'meeting') {
        return meetingItemId(item);
    }
    if (item.kind === 'task') {
        return taskItemId(item);
    }

    return `holiday:${item.holidayRange.holidayRangeId}`;
}

/**
 * Converts a canonical Instant to LocalDate and minute-of-day in the Workspace TermZone.
 *
 * @param {string} instant Canonical timed Task deadline.
 * @param {string} timeZone Workspace-owned IANA zone.
 * @return {Object} Local date and minute used by the shared Calendar grid.
 */
export function localInstantLabel(
    instant: string,
    timeZone: string,
): string {
    const { date, minute } = localInstantParts(instant, timeZone);
    const hour = String(Math.floor(minute / 60)).padStart(2, '0');
    return `${date} ${hour}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Splits one exact Instant into its TermZone date and minute-of-day.
 *
 * @param {string} instant Canonical Instant.
 * @param {string} timeZone IANA TermZone identity.
 * @return {Readonly<{ date: string; minute: number }>} TermZone date and minute of day.
 */
export function localInstantParts(
    instant: string,
    timeZone: string,
): Readonly<{ date: string; minute: number }> {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes): string => (
        parts.find(part => part.type === type)?.value ?? ''
    );
    return {
        date: `${value('year')}-${value('month')}-${value('day')}`,
        minute: Number(value('hour')) * 60 + Number(value('minute')),
    };
}

/**
 * Converts one canonical local clock to minute-of-day.
 *
 * @param {string} value Canonical HH:mm.
 * @return {number} Minute offset from local midnight.
 */
export function localTimeMinute(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour! * 60 + minute!;
}

/**
 * Adds one bounded number of days without consulting the host time zone.
 *
 * @param {string} date Canonical LocalDate.
 * @param {number} days Whole day offset.
 * @return {string} Shifted canonical LocalDate.
 */
export function addCalendarDays(date: string, days: number): string {
    const millisecondsPerDay = 86_400_000;
    return new Date(
        Date.parse(`${date}T00:00:00.000Z`) + days * millisecondsPerDay,
    ).toISOString().slice(0, 10);
}

/**
 * Returns seven stable LocalDate labels for the visible Calendar columns.
 *
 * @param {string} startDate First date from the PLAN-owned Calendar window.
 * @return {readonly string[]} Seven consecutive display dates.
 */
export function sevenDayDates(startDate: string): readonly string[] {
    const startCoordinate = Date.parse(`${startDate}T00:00:00.000Z`);
    const millisecondsPerDay = 86_400_000;

    return [0, 1, 2, 3, 4, 5, 6].map(offset => (
        new Date(startCoordinate + offset * millisecondsPerDay).toISOString().slice(0, 10)
    ));
}

/**
 * Builds the Today heading from the PLAN-owned local date and evaluation Instant.
 * @param {PlanProjection} plan Unified PLAN evaluation context.
 * @return {string} Local weekday followed by a stable time-of-day greeting.
 */
export function todayGreetingTitle(plan: PlanProjection): string {
    const applicableDate = new Date(`${plan.evaluationContext.applicableDate}T00:00:00.000Z`);
    const weekday = calendarWeekdayNames[applicableDate.getUTCDay()];
    const localHour = Math.floor(localInstantParts(
        plan.evaluationContext.evaluatedAt,
        plan.evaluationContext.termZone,
    ).minute / 60);
    let greeting = '晚上好';
    if (localHour >= 5 && localHour < 12) {
        greeting = '早上好';
    }
    else if (localHour < 18 && localHour >= 12) {
        greeting = '下午好';
    }
    return `${weekday}，${greeting}`;
}

/** Height of one visible hour row; mirrors `.calendar-time-grid` and `.today-timeline-grid`. */
export const CALENDAR_HOUR_HEIGHT = 33;

/** Default first visible hour; 2026-08-29 user instruction. */
export const CALENDAR_DEFAULT_START_HOUR = 7;

/** Default last visible hour boundary; 2026-08-29 user instruction. */
export const CALENDAR_DEFAULT_END_HOUR = 22;

export const CALENDAR_EVENT_MIN_HEIGHT = 30;

export const CALENDAR_EVENT_MIN_DURATION = Math.ceil(
    (CALENDAR_EVENT_MIN_HEIGHT * 60) / CALENDAR_HOUR_HEIGHT,
);

export type CalendarTimedPlacement = Readonly<{
    date: string;
    startMinute: number;
    durationMinutes: number;
    continuation: boolean;
    item: PlanMeetingProjection | PlanTaskProjection;
    overlapLane: number;
    overlapLaneCount: number;
}>;

export type CalendarTimedPlacementSource = Omit<
    CalendarTimedPlacement,
    'overlapLane' | 'overlapLaneCount'
>;

/**
 * Converts a minute count to its exact pixel offset inside the hour grid.
 *
 * Multiplying first keeps the result on integer arithmetic, so a whole number of hours
 * renders as a whole number of pixels instead of a binary-float approximation.
 *
 * @param {number} minutes Minutes measured from the first visible hour.
 * @return {number} Pixel offset inside the hour grid.
 */
export function calendarMinutePixels(minutes: number): number {
    return (minutes * CALENDAR_HOUR_HEIGHT) / 60;
}

/**
 * Chooses the visible hour band, widened only by items that fall outside it.
 *
 * The default band answers "when are classes"; an item scheduled outside it is a real
 * fact, so the band grows to contain it rather than hiding it.
 *
 * @param {readonly CalendarTimedPlacement[]} placements Positioned timed items.
 * @return {Readonly<{ startHour: number; endHour: number }>} Inclusive-exclusive hour band.
 */
export function calendarHourWindow(
    placements: readonly CalendarTimedPlacement[],
): Readonly<{ startHour: number; endHour: number }> {
    let startHour = CALENDAR_DEFAULT_START_HOUR;
    let endHour = CALENDAR_DEFAULT_END_HOUR;
    for (const placement of placements) {
        startHour = Math.min(startHour, Math.floor(placement.startMinute / 60));
        endHour = Math.max(
            endHour,
            Math.ceil((placement.startMinute + placement.durationMinutes) / 60),
        );
    }
    return Object.freeze({
        startHour: Math.max(0, startHour),
        endHour: Math.min(24, Math.max(endHour, startHour + 1)),
    });
}

/**
 * Converts existing timed PLAN items into date-lane placements without changing their meaning.
 * Overnight Meetings are split at midnight so both visible date columns remain truthful.
 *
 * @param {readonly (PlanMeetingProjection | PlanTaskProjection)[]} items Timed PLAN items.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @return {readonly CalendarTimedPlacement[]} Stable minute placements for the seven-day grid.
 */
export function calendarTimedPlacements(
    items: readonly (PlanMeetingProjection | PlanTaskProjection)[],
    termZone: string,
): readonly CalendarTimedPlacement[] {
    const placements = items.flatMap(item => {
        if (item.kind === 'task') {
            if (item.occurrence.deadline.kind !== 'timed') {
                return [];
            }
            const local = localInstantParts(item.occurrence.deadline.instant, termZone);
            return [{
                date: local.date,
                startMinute: local.minute,
                durationMinutes: 30,
                continuation: false,
                item,
            }];
        }

        const startMinute = localTimeMinute(item.occurrence.localStart);
        const endMinute = localTimeMinute(item.occurrence.localEnd);
        const totalDuration = endMinute
            + item.occurrence.endDayOffset * 1_440
            - startMinute;
        const firstDuration = Math.min(totalDuration, 1_440 - startMinute);
        const placements: CalendarTimedPlacementSource[] = [{
            date: item.occurrence.date,
            startMinute,
            durationMinutes: firstDuration,
            continuation: false,
            item,
        }];
        const remainingDuration = totalDuration - firstDuration;
        if (remainingDuration > 0) {
            placements.push({
                date: addCalendarDays(item.occurrence.date, 1),
                startMinute: 0,
                durationMinutes: remainingDuration,
                continuation: true,
                item,
            });
        }
        return placements;
    });
    return assignCalendarOverlapLanes(placements);
}

/**
 * Assigns non-overlapping visual lanes to each connected overlap cluster.
 * @param {readonly CalendarTimedPlacementSource[]} placements Exact date/minute placements.
 * @return {readonly CalendarTimedPlacement[]} Placements with deterministic lane geometry.
 */
export function assignCalendarOverlapLanes(
    placements: readonly CalendarTimedPlacementSource[],
): readonly CalendarTimedPlacement[] {
    const laneByPlacement = new Map<CalendarTimedPlacementSource, Readonly<{
        lane: number;
        laneCount: number;
    }>>();
    const dates = [...new Set(placements.map(placement => placement.date))];

    for (const date of dates) {
        const sorted = placements.filter(placement => placement.date === date).toSorted((first, second) => (
            first.startMinute - second.startMinute
            || second.durationMinutes - first.durationMinutes
            || planItemId(first.item).localeCompare(planItemId(second.item))
        ));
        let cluster: CalendarTimedPlacementSource[] = [];
        let clusterEnd = -1;

        const flushCluster = (): void => {
            const laneEnds: number[] = [];
            const assigned = cluster.map(placement => {
                const availableLane = laneEnds.findIndex(endMinute => endMinute <= placement.startMinute);
                const lane = availableLane === -1 ? laneEnds.length : availableLane;
                laneEnds[lane] = placement.startMinute + Math.max(
                    placement.durationMinutes,
                    CALENDAR_EVENT_MIN_DURATION,
                );
                return { placement, lane };
            });
            for (const value of assigned) {
                laneByPlacement.set(value.placement, {
                    lane: value.lane,
                    laneCount: laneEnds.length,
                });
            }
            cluster = [];
            clusterEnd = -1;
        };

        for (const placement of sorted) {
            if (cluster.length > 0 && placement.startMinute >= clusterEnd) {
                flushCluster();
            }
            cluster.push(placement);
            clusterEnd = Math.max(
                clusterEnd,
                placement.startMinute + Math.max(
                    placement.durationMinutes,
                    CALENDAR_EVENT_MIN_DURATION,
                ),
            );
        }
        if (cluster.length > 0) {
            flushCluster();
        }
    }

    return placements.map(placement => {
        const lane = laneByPlacement.get(placement) ?? { lane: 0, laneCount: 1 };
        return {
            ...placement,
            overlapLane: lane.lane,
            overlapLaneCount: lane.laneCount,
        };
    });
}

/**
 * Builds the stable labels for one visible hour band.
 *
 * @param {number} startHour First visible hour.
 * @param {number} endHour Exclusive last visible hour.
 * @return {readonly string[]} One label per hour.
 */
export function calendarHourLabels(
    startHour = 0,
    endHour = 24,
): readonly string[] {
    return Array.from(
        { length: Math.max(0, endHour - startHour) },
        (_value, offset) => `${String(startHour + offset).padStart(2, '0')}:00`,
    );
}

/**
 * Formats one minute-of-day as a local clock.
 *
 * @param {number} minute Minute offset from midnight.
 * @return {string} HH:mm label.
 */
export function minuteLabel(minute: number): string {
    const hour = Math.floor(minute / 60);
    return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Counts whole calendar days between two canonical LocalDates.
 *
 * @param {string} from Earlier canonical LocalDate.
 * @param {string} to Later canonical LocalDate.
 * @return {number} Signed whole-day difference.
 */
export function calendarDayDifference(from: string, to: string): number {
    return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
}

/**
 * Returns the Monday that opens the ISO week containing one canonical LocalDate.
 *
 * @param {string} date Canonical LocalDate.
 * @return {string} Canonical LocalDate of that week's Monday.
 */
export function weekStartDate(date: string): string {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return addCalendarDays(date, -((weekday + 6) % 7));
}

/**
 * Names the visible week relative to the Term without inventing a week before it starts.
 *
 * The ordinal is pure date arithmetic between two PLAN-owned dates, so it stays a label
 * rather than a new classification.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {string} Term-relative week label or the real out-of-term state.
 */
export function termWeekLabel(plan: PlanProjection): string {
    const { applicableDate } = plan.evaluationContext;
    if (applicableDate < plan.term.startDate) {
        return '学期未开始';
    }
    if (applicableDate > plan.term.endDate) {
        return '学期已结束';
    }
    const offsetWeeks = calendarDayDifference(
        weekStartDate(plan.term.startDate),
        plan.week.window.startDate,
    ) / 7;
    return `第 ${Math.floor(offsetWeeks) + 1} 周`;
}

export type TodayHeadlineMeeting = Readonly<{
    label: string;
    value: string;
    dateTime: string | null;
}>;

/**
 * Resolves the "next class" headline without stepping outside the projected week.
 *
 * PLAN already ordered both lists by start Instant and already classified every
 * occurrence, so this only reads the first match and then degrades to facts the
 * projection actually carries.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {TodayHeadlineMeeting} Visible label, value, and machine-readable time.
 */
export function todayHeadlineMeeting(plan: PlanProjection): TodayHeadlineMeeting {
    const today = plan.today.meetings.find(meeting => (
        meeting.classification === 'in-progress' || meeting.classification === 'upcoming'
    ));
    if (today !== undefined) {
        return {
            label: '下一节',
            value: today.occurrence.localStart,
            dateTime: today.occurrence.localStart,
        };
    }

    const laterThisWeek = plan.week.meetings.find(meeting => meeting.classification === 'upcoming');
    if (laterThisWeek !== undefined) {
        const { date, localStart } = laterThisWeek.occurrence;
        const weekday = calendarWeekdayNames[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
        return {
            label: '下一节',
            value: `${weekday} ${localStart}`,
            dateTime: `${date}T${localStart}`,
        };
    }

    if (plan.term.startDate > plan.evaluationContext.applicableDate) {
        return { label: '学期开始', value: plan.term.startDate, dateTime: plan.term.startDate };
    }

    return { label: '下一节', value: '本周无', dateTime: null };
}

export type StatusSeverity = 'critical' | 'warning' | 'success' | 'neutral';

/**
 * Maps one PLAN-owned Task classification to its display severity.
 *
 * Severity only recolours a chip that already carries its own words, and the accent
 * yellow never appears here: it means "selected" or "current", never "overdue".
 *
 * @param {TaskTimeClassification} classification PLAN-owned Task classification.
 * @return {StatusSeverity} Display severity.
 */
export function taskSeverity(classification: TaskTimeClassification): StatusSeverity {
    if (classification === 'overdue') {
        return 'critical';
    }
    if (classification === 'today') {
        return 'warning';
    }
    if (classification === 'completed') {
        return 'success';
    }
    return 'neutral';
}

/**
 * Collects the Meeting occurrence identities PLAN already reported as overlapping.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {ReadonlySet<string>} Stable Meeting occurrence identities in a conflict.
 */
export function conflictingMeetingIds(plan: PlanProjection): ReadonlySet<string> {
    const identities = new Set<string>();
    for (const warning of plan.agenda.warnings) {
        identities.add(meetingItemId(warning.first));
        identities.add(meetingItemId(warning.second));
    }
    return identities;
}

/**
 * Looks up one Course accent colour by the stable identity PLAN already carries.
 *
 * @param {SetupProjection} setup Current setup projection.
 * @param {string} courseId Stable Course identity from a PLAN occurrence.
 * @return {CourseColor | null} Chosen Course colour, or null when the user picked none.
 */
export function courseColorFor(setup: SetupProjection, courseId: string): CourseColor | null {
    return setup.courses.find(course => course.courseId === courseId)?.color ?? null;
}

/** Weekday code order shared by the course roster and its slot lists. */
export const meetingWeekdayOrder: readonly MeetingSeriesProjection['weekday'][] = [
    'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN',
];

/** Single-character weekday marks used where a full 周x label would crowd the row. */
export const weekdayMarks: Readonly<Record<MeetingSeriesProjection['weekday'], string>> = {
    MON: '一',
    TUE: '二',
    WED: '三',
    THU: '四',
    FRI: '五',
    SAT: '六',
    SUN: '日',
};

/**
 * Names one canonical LocalDate's weekday in the short 周x form.
 *
 * @param {string} date Canonical LocalDate.
 * @return {string} 周x label.
 */
export function shortWeekdayOf(date: string): string {
    return shortWeekdayNames[new Date(`${date}T00:00:00.000Z`).getUTCDay()]!;
}

/**
 * Reads the first Meeting of the Term that has not started yet.
 *
 * PLAN sorts `plan.meetings` by start Instant and classifies every occurrence, so the
 * first `upcoming` entry is the next class of the whole Term; this is a read, not an
 * inference (UI spec §8.2).
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @return {PlanMeetingProjection | undefined} Next upcoming Meeting, if any.
 */
export function nextTermMeeting(plan: PlanProjection): PlanMeetingProjection | undefined {
    return plan.meetings.find(meeting => meeting.classification === 'upcoming');
}

/**
 * Formats a positive duration as the student would say it.
 *
 * @param {number} milliseconds Signed duration; the magnitude is used.
 * @return {string} `n 分钟` under an hour, otherwise `n 小时 m 分`.
 */
export function durationLabel(milliseconds: number): string {
    const minutes = Math.max(1, Math.ceil(Math.abs(milliseconds) / 60_000));
    if (minutes < 60) {
        return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

/**
 * Says how far away a later calendar day is, the way the student would.
 *
 * @param {number} days Calendar days ahead, at least 1.
 * @return {string} `明天`, `后天`, or `n 天后`.
 */
export function daysAheadLabel(days: number): string {
    if (days === 1) {
        return '明天';
    }
    return days === 2 ? '后天' : `${days} 天后`;
}

/**
 * Says how much of the Term is left once PLAN lists no later class in it.
 *
 * @param {number} days Calendar days from the applicable date to the Term end date.
 * @return {string} `学期还剩 n 天`, `学期今天结束`, or `学期已结束`.
 */
export function termDaysLeftLabel(days: number): string {
    if (days > 0) {
        return `学期还剩 ${days} 天`;
    }
    return days === 0 ? '学期今天结束' : '学期已结束';
}

/**
 * Formats Meeting minutes as hours with at most one decimal.
 *
 * @param {number} minutes Whole minutes.
 * @return {string} `n 小时`, showing one decimal only when needed.
 */
export function hoursLabel(minutes: number): string {
    const hours = Math.round(minutes / 6) / 10;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
}

/**
 * Formats one Task deadline for a list row, in the TermZone when the deadline is timed.
 *
 * @param {TaskDeadline} deadline Persisted Task deadline.
 * @param {string | undefined} termZone Workspace-owned TermZone; absent keeps the raw form.
 * @return {string} Local date-time, date, or TBA.
 */
export function taskDeadlineRowLabel(deadline: TaskDeadline, termZone?: string): string {
    if (deadline.kind === 'timed' && termZone !== undefined) {
        return localInstantLabel(deadline.instant, termZone);
    }
    return taskDeadlineLabel(deadline);
}

/**
 * Lists the weekdays one Course meets on, deduplicated and in week order.
 *
 * @param {readonly MeetingSeriesProjection[]} meetings Course Meeting series.
 * @return {string} `周一 三 五` style label, or an empty string without series.
 */
export function courseWeekdaySummary(meetings: readonly MeetingSeriesProjection[]): string {
    const present = meetingWeekdayOrder.filter(weekday => (
        meetings.some(meeting => meeting.weekday === weekday)
    ));
    if (present.length === 0) {
        return '';
    }
    return `周${present.map(weekday => weekdayMarks[weekday]).join(' ')}`;
}

/**
 * Orders Course Meeting series by weekday then start time for the roster.
 *
 * @param {readonly MeetingSeriesProjection[]} meetings Course Meeting series.
 * @return {readonly MeetingSeriesProjection[]} Sorted copy.
 */
export function sortedCourseMeetings(
    meetings: readonly MeetingSeriesProjection[],
): readonly MeetingSeriesProjection[] {
    return [...meetings].sort((first, second) => (
        meetingWeekdayOrder.indexOf(first.weekday) - meetingWeekdayOrder.indexOf(second.weekday)
        || first.localStart.localeCompare(second.localStart)
        || first.meetingSeriesId.localeCompare(second.meetingSeriesId)
    ));
}
