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

    return `${setup.currentTerm.name} · ${setup.currentTerm.startDate} – ${setup.currentTerm.endDate}`;
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
