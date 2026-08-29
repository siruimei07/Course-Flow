import { CSSProperties } from 'react';
import type { ReactElement } from 'react';
import type { WorkspaceNavigationId } from '../navigation';
import { addCalendarDays, agendaItemId, calendarHolidayItemId, localInstantParts, localTimeMinute, meetingClassificationNames, meetingItemId, planItemId, sevenDayDates, taskClassificationNames, taskItemId, termContext } from './shared';
import { EmptyState, MeetingItem, PageHeader, PlanUnavailable, SetupIncompleteNotice, TaskItem, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
import { AgendaItemProjection, CalendarHolidaySegmentProjection, PlanMeetingProjection, PlanTaskProjection } from '../../shared/workspace-plan-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
/**
 * Renders the unified seven-day Calendar, Agenda, warnings, and separate TBA group.
 *
 * @param {WorkspacePageContentProps} props Existing PLAN facts and executable handlers.
 * @return {ReactElement} Calendar page.
 */
export function CalendarPage(props: WorkspacePageContentProps): ReactElement {
    const { calendarWeek, plan, setup, setupIncomplete } = props;
    // The Calendar may show another week; Today, the week summary and TBA keep the
    // projection evaluated for today, so the two never disagree about "今天".
    const visiblePlan = calendarWeek?.plan ?? plan ?? null;

    return (
        <article
            aria-labelledby="calendar-page-title"
            className="workspace-page workspace-page--calendar"
        >
            <PageHeader
                actions={calendarWeek === undefined || !plan ? undefined : (
                    <CalendarWeekControls week={calendarWeek} />
                )}
                context={termContext(setup)}
                eyebrow="Calendar"
                headingId="calendar-page-title"
                title="日历"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            {calendarWeek?.problem ? (
                <p
                    className="empty-state-reason calendar-week-problem"
                    role="alert"
                >{calendarWeek.problem}</p>
            ) : null}
            {!visiblePlan ? (
                <PlanUnavailable
                    {...props}
                    fallbackActionLabel="返回 Today"
                    fallbackPage="today"
                />
            ) : (
                <CalendarContent
                    applicableDate={plan?.evaluationContext.applicableDate ?? null}
                    onNavigate={props.onNavigate}
                    plan={visiblePlan}
                />
            )}
        </article>
    );
}

/**
 * Renders the explicit week controls without inventing a date the projection lacks.
 *
 * @param {Object} props Calendar week presentation owned by the Shell.
 * @return {ReactElement} Previous, current and next week commands.
 */
export function CalendarWeekControls(props: Readonly<{
    week: NonNullable<WorkspacePageContentProps['calendarWeek']>;
}>): ReactElement {
    const { week } = props;
    const offsetLabel = week.offset === 0
        ? '本周'
        : week.offset > 0 ? `${week.offset} 周后` : `${-week.offset} 周前`;

    return (
        <div
            aria-label="日历周导航"
            className="calendar-week-controls"
            role="group"
        >
            <button
                className="secondary-action"
                disabled={week.busy}
                onClick={() => week.onShift(-1)}
                type="button"
            >上一周</button>
            <span
                aria-live="polite"
                className="calendar-week-offset"
            >{week.busy ? '正在读取…' : offsetLabel}</span>
            <button
                className="secondary-action"
                disabled={week.busy}
                onClick={() => week.onShift(1)}
                type="button"
            >下一周</button>
            <button
                className="secondary-action"
                disabled={week.busy || week.offset === 0}
                onClick={week.onReturnToCurrentWeek}
                type="button"
            >回到本周</button>
        </div>
    );
}

/**
 * Renders Calendar and Agenda structures only when a PLAN projection is available.
 *
 * @param {Object} props Unified PLAN and navigation handler.
 * @return {ReactElement} Seven-day Calendar, Agenda, warnings, and TBA group.
 */
export function CalendarContent(props: Readonly<{
    plan: PlanProjection;
    applicableDate?: string | null;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const todayDate = props.applicableDate === undefined || props.applicableDate === null
        ? props.plan.evaluationContext.applicableDate
        : props.applicableDate;
    const { calendar, agenda, tba } = props.plan;
    const dates = sevenDayDates(calendar.window.startDate);
    const timedPlacements = calendarTimedPlacements(
        calendar.timedItems,
        props.plan.evaluationContext.termZone,
    );
    const agendaGroups = groupAgendaItems(
        agenda.items,
        props.plan.evaluationContext.termZone,
        calendar.window.startDate,
    );
    const hasCalendarFacts = calendar.timedItems.length > 0
        || calendar.allDayItems.length > 0
        || calendar.holidaySegments.length > 0;

    return (
        <>
            <section
                aria-labelledby="calendar-week-title"
                className="content-card calendar-card"
            >
                <h2 id="calendar-week-title">七日课表</h2>
                <p className="page-context">
                    <time dateTime={calendar.window.startDate}>{calendar.window.startDate}</time>
                    {' – '}
                    <time dateTime={calendar.window.endDate}>{calendar.window.endDate}</time>
                </p>
                <div
                    aria-label="可横向滚动的七日课表"
                    className="calendar-scroll-region"
                    tabIndex={0}
                >
                    <div className="calendar-grid-shell">
                        <div
                            aria-hidden="true"
                            className="calendar-grid-corner"
                        >日期</div>
                        <ol className="calendar-day-grid">
                            {dates.map(date => (
                                <li
                                    className="calendar-day-column"
                                    data-current={
                                        date === todayDate
                                            ? 'true'
                                            : undefined
                                    }
                                    data-day={date}
                                    key={date}
                                >
                                    <time
                                        aria-current={
                                            date === todayDate
                                                ? 'date'
                                                : undefined
                                        }
                                        dateTime={date}
                                    >{date}</time>
                                    {date === todayDate ? (
                                        <span className="calendar-current-label">今天</span>
                                    ) : null}
                                </li>
                            ))}
                        </ol>
                        <div className="calendar-all-day-label">全天</div>
                        <ol
                            aria-label="全天事项和日期范围"
                            className="calendar-all-day-grid"
                        >
                            {calendar.holidaySegments.map(holiday => (
                                <CalendarHolidayItem
                                    dates={dates}
                                    holiday={holiday}
                                    key={calendarHolidayItemId(holiday)}
                                />
                            ))}
                            {calendar.allDayItems.map(task => (
                                <CalendarAllDayTaskItem
                                    dates={dates}
                                    key={taskItemId(task)}
                                    task={task}
                                />
                            ))}
                        </ol>
                        <ol
                            aria-hidden="true"
                            className="calendar-time-labels"
                        >
                            {calendarHourLabels().map(label => (
                                <li key={label}>{label}</li>
                            ))}
                        </ol>
                        <ol
                            aria-label="按日期和时间排列的事项"
                            className="calendar-time-grid"
                        >
                            {dates.map(date => (
                             <li
                                className="calendar-time-column"
                                data-calendar-date={date}
                                data-current={
                                    date === todayDate
                                        ? 'true'
                                        : undefined
                                }
                                key={date}
                             >
                                <time
                                    className="visually-hidden"
                                    dateTime={date}
                                >{date}</time>
                                <ol className="calendar-timed-item-list">
                                    {timedPlacements.filter(placement => placement.date === date).map(
                                        placement => (
                                            <CalendarTimedItem
                                                key={`${planItemId(placement.item)}:${placement.date}`}
                                                placement={placement}
                                            />
                                        ),
                                    )}
                                </ol>
                             </li>
                            ))}
                        </ol>
                    </div>
                </div>
                {!hasCalendarFacts ? (
                    <p
                        className="calendar-empty-status"
                        role="status"
                    >此七日网格没有已排期事项。</p>
                ) : null}
            </section>

            <div className="workspace-grid workspace-grid--calendar-details">
                <section
                    aria-labelledby="agenda-title"
                    className="content-card agenda-card"
                >
                    <h2 id="agenda-title">议程</h2>
                    {agenda.items.length === 0 ? (
                        <EmptyState
                            action={tba.tasks.length > 0
                                ? buttonAction('查看任务页', () => props.onNavigate('tasks'))
                                : buttonAction('查看课程', () => props.onNavigate('courses'))}
                            id="agenda-empty"
                            reason={tba.tasks.length > 0
                                ? '当前范围没有已排期事项；尚未确定日期的任务仍保留在 TBA 分组。'
                                : '统一计划投影确认当前范围没有课节、任务或假期。'}
                            title="当前范围没有已排期事项"
                        />
                    ) : (
                        <div className="agenda-groups">
                            {agendaGroups.map(group => {
                                const groupKey = group.date ?? 'tba';
                                return (
                                    <section
                                        aria-labelledby={`agenda-date-${groupKey}`}
                                        className="agenda-date-group"
                                        data-agenda-date={groupKey}
                                        key={groupKey}
                                    >
                                        <h3 id={`agenda-date-${groupKey}`}>
                                            {group.date === null
                                                ? '日期待定'
                                                : <time dateTime={group.date}>{group.date}</time>}
                                        </h3>
                                        <ul className="fact-list agenda-list">
                                            {group.items.map(item => (
                                                <AgendaItem
                                                    item={item}
                                                    key={agendaItemId(item)}
                                                />
                                            ))}
                                        </ul>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                    {agenda.warnings.length > 0 ? (
                        <aside
                            aria-labelledby="calendar-conflicts-title"
                            className="calendar-conflicts"
                        >
                            <h3 id="calendar-conflicts-title">时间冲突</h3>
                            <ul className="fact-list conflict-list">
                                {agenda.warnings.map(warning => (
                                    <li
                                        data-item-id={
                                            `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
                                        }
                                        key={
                                            `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
                                        }
                                    >
                                        <span className="status-label">时间冲突</span>
                                        <p>{warning.first.courseCode} 与 {warning.second.courseCode}</p>
                                        <time dateTime={warning.overlap.startInstant}>
                                            {warning.overlap.startInstant}
                                        </time>
                                        {' – '}
                                        <time dateTime={warning.overlap.endInstant}>
                                            {warning.overlap.endInstant}
                                        </time>
                                    </li>
                                ))}
                            </ul>
                        </aside>
                    ) : null}
                </section>

                <section
                    aria-labelledby="calendar-tba-title"
                    className="content-card calendar-tba-card"
                >
                    <h2 id="calendar-tba-title">TBA</h2>
                    <p className="section-intro">尚无日期或时间的任务不会落入虚构日历位置。</p>
                    {tba.tasks.length === 0 ? (
                        <EmptyState
                            action={buttonAction('查看任务', () => props.onNavigate('tasks'))}
                            id="calendar-tba-empty"
                            reason="统一计划投影中的任务都已有日期或时间。"
                            title="没有 TBA 事项"
                        />
                    ) : (
                        <ul className="fact-list task-list task-list--tba">
                            {tba.tasks.map(task => (
                                <TaskItem
                                    key={taskItemId(task)}
                                    task={task}
                                />
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </>
    );
}

/**
 * Renders one Calendar timed or all-day PLAN item.
 *
 * @param {Object} props Calendar item projection.
 * @return {ReactElement} Calendar event row.
 */
export type CalendarTimedPlacement = Readonly<{
    date: string;
    startMinute: number;
    durationMinutes: number;
    continuation: boolean;
    item: PlanMeetingProjection | PlanTaskProjection;
    overlapLane: number;
    overlapLaneCount: number;
}>;

export type CalendarEventStyle = CSSProperties & Readonly<{
    '--calendar-event-top': string;
    '--calendar-event-height': string;
    '--calendar-event-left': string;
    '--calendar-event-min-height': string;
    '--calendar-event-width': string;
}>;

export const CALENDAR_MINUTE_HEIGHT = 0.55;

export const CALENDAR_EVENT_MIN_HEIGHT = 30;

export const CALENDAR_EVENT_MIN_DURATION = Math.ceil(
    CALENDAR_EVENT_MIN_HEIGHT / CALENDAR_MINUTE_HEIGHT,
);

/**
 * Renders one timed occurrence inside its exact date lane and vertical minute range.
 *
 * @param {Object} props Placement derived only from existing PLAN occurrence facts.
 * @return {ReactElement} One positioned Calendar event.
 */
export function CalendarTimedItem(props: Readonly<{
    placement: CalendarTimedPlacement;
}>): ReactElement {
    const { placement } = props;
    const item = placement.item;
    const style: CalendarEventStyle = {
        '--calendar-event-top': `${placement.startMinute * CALENDAR_MINUTE_HEIGHT}px`,
        '--calendar-event-height': `${placement.durationMinutes * CALENDAR_MINUTE_HEIGHT}px`,
        '--calendar-event-left': `${placement.overlapLane / placement.overlapLaneCount * 100}%`,
        '--calendar-event-min-height': `${CALENDAR_EVENT_MIN_HEIGHT}px`,
        '--calendar-event-width': `${100 / placement.overlapLaneCount}%`,
    };
    const label = item.kind === 'meeting'
        ? `${item.courseCode} · ${item.occurrence.type}`
        : item.occurrence.title;
    const detail = item.kind === 'meeting'
        ? `${item.occurrence.localStart}–${item.occurrence.localEnd}`
        : `${item.courseCode} · ${placement.date} ${minuteLabel(placement.startMinute)}`;

    return (
        <li
            data-item-id={planItemId(item)}
            data-calendar-date={placement.date}
            data-start-minute={placement.startMinute}
            data-duration-minutes={placement.durationMinutes}
            data-continuation={placement.continuation ? 'true' : undefined}
            data-overlap-lane={placement.overlapLane}
            data-overlap-lane-count={placement.overlapLaneCount}
            style={style}
        >
            <span className="status-label">
                {item.kind === 'meeting'
                    ? meetingClassificationNames[item.classification]
                    : taskClassificationNames[item.classification]}
            </span>
            <strong>{label}</strong>
            <span>{detail}</span>
        </li>
    );
}

/**
 * Renders one date-only Task in its existing Calendar date column.
 *
 * @param {Object} props Date-only PLAN task and the visible shared columns.
 * @return {ReactElement} One all-day Task card.
 */
export function CalendarAllDayTaskItem(props: Readonly<{
    task: PlanTaskProjection;
    dates: readonly string[];
}>): ReactElement {
    const deadline = props.task.occurrence.deadline;
    const date = deadline.kind === 'date-only' ? deadline.date : '';
    const column = props.dates.indexOf(date) + 1;

    return (
        <li
            className="calendar-all-day-item"
            data-item-id={taskItemId(props.task)}
            data-calendar-date={date}
            style={{ gridColumn: `${column} / ${column + 1}` }}
        >
            <span className="status-label">全天 · {taskClassificationNames[props.task.classification]}</span>
            <strong>{props.task.occurrence.title}</strong>
            <span>{props.task.courseCode}</span>
        </li>
    );
}

/**
 * Renders one continuous Holiday segment in the visible Calendar week.
 *
 * @param {Object} props Holiday segment projection.
 * @return {ReactElement} Holiday lane row.
 */
export function CalendarHolidayItem(props: Readonly<{
    holiday: CalendarHolidaySegmentProjection;
    dates: readonly string[];
}>): ReactElement {
    const { holiday } = props;
    const startColumn = props.dates.indexOf(holiday.visibleStartDate) + 1;
    const endColumn = props.dates.indexOf(holiday.visibleEndDate) + 2;

    return (
        <li
            className="calendar-holiday-item"
            data-item-id={calendarHolidayItemId(holiday)}
            data-start-column={startColumn}
            data-end-column={endColumn}
            style={{ gridColumn: `${startColumn} / ${endColumn}` }}
        >
            <span className="status-label">假期</span>
            <strong>{holiday.holidayRange.name}</strong>
            <span>{holiday.visibleStartDate} – {holiday.visibleEndDate}</span>
        </li>
    );
}

/**
 * Renders one Agenda item while preserving its existing PLAN kind.
 *
 * @param {Object} props Agenda item projection.
 * @return {ReactElement} Agenda row.
 */
export function AgendaItem(props: Readonly<{ item: AgendaItemProjection }>): ReactElement {
    if (props.item.kind === 'meeting') {
        return <MeetingItem meeting={props.item} />;
    }
    if (props.item.kind === 'task') {
        return <TaskItem task={props.item} />;
    }

    return (
        <li data-item-id={props.item.holidayRange.holidayRangeId}>
            <span className="status-label">假期</span>
            <strong>{props.item.holidayRange.name}</strong>
            <span>{props.item.holidayRange.startDate} – {props.item.holidayRange.endDate}</span>
        </li>
    );
}

export type AgendaDateGroup = Readonly<{
    date: string | null;
    items: readonly AgendaItemProjection[];
}>;

/**
 * Groups existing Agenda facts under their real local date without changing item kinds.
 * @param {readonly AgendaItemProjection[]} items PLAN-owned Agenda order.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @param {string} windowStart First visible LocalDate in the requested window.
 * @return {readonly AgendaDateGroup[]} Chronological local-date groups.
 */
export function groupAgendaItems(
    items: readonly AgendaItemProjection[],
    termZone: string,
    windowStart: string,
): readonly AgendaDateGroup[] {
    const groups = new Map<string | null, AgendaItemProjection[]>();
    for (const item of items) {
        const date = agendaItemDate(item, termZone, windowStart);
        const group = groups.get(date) ?? [];
        group.push(item);
        groups.set(date, group);
    }

    return [...groups.entries()].toSorted(([first], [second]) => {
        if (first === null) {
            return 1;
        }
        if (second === null) {
            return -1;
        }
        return first.localeCompare(second);
    }).map(([date, groupItems]) => ({ date, items: groupItems }));
}

/**
 * Reads one Agenda fact's local date from its existing occurrence or range.
 * @param {AgendaItemProjection} item PLAN-owned Agenda fact.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @param {string} windowStart First visible LocalDate in the requested window.
 * @return {string | null} LocalDate, or null only for an unexpected TBA Agenda item.
 */
export function agendaItemDate(
    item: AgendaItemProjection,
    termZone: string,
    windowStart: string,
): string | null {
    if (item.kind === 'meeting') {
        return item.occurrence.date;
    }
    if (item.kind === 'holiday-range') {
        return item.holidayRange.startDate > windowStart
            ? item.holidayRange.startDate
            : windowStart;
    }
    if (item.occurrence.deadline.kind === 'date-only') {
        return item.occurrence.deadline.date;
    }
    if (item.occurrence.deadline.kind === 'timed') {
        return localInstantParts(item.occurrence.deadline.instant, termZone).date;
    }
    return null;
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

export type CalendarTimedPlacementSource = Omit<
    CalendarTimedPlacement,
    'overlapLane' | 'overlapLaneCount'
>;

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
 * Builds the stable labels for the full 24-hour vertical Calendar grid.
 *
 * @return {readonly string[]} One label per hour.
 */
export function calendarHourLabels(): readonly string[] {
    return Array.from({ length: 24 }, (_value, hour) => `${String(hour).padStart(2, '0')}:00`);
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
