import { CSSProperties } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import type { WorkspaceNavigationId } from '../navigation';
import {
    CALENDAR_EVENT_MIN_HEIGHT,
    CalendarTimedPlacement,
    agendaItemId,
    calendarHolidayItemId,
    calendarHourLabels,
    calendarHourWindow,
    calendarMinutePixels,
    calendarTimedPlacements,
    conflictingMeetingIds,
    courseColorFor,
    localInstantParts,
    meetingClassificationNames,
    meetingItemId,
    minuteLabel,
    planItemId,
    sevenDayDates,
    shortWeekdayOf,
    taskClassificationNames,
    taskItemId,
    termContext,
} from './shared';
import { EmptyState, MeetingItem, PageHeader, PlanUnavailable, SetupIncompleteNotice, TaskItem, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
import { calendarDateFromKey, resolveCalendarSelectedDate } from '../workspace-view-state';
import type { CourseColor } from '../../shared/workspace-course-contract';
import {
    AgendaConflictWarning,
    AgendaItemProjection,
    CalendarHolidaySegmentProjection,
    PlanMeetingProjection,
    PlanTaskProjection,
} from '../../shared/workspace-plan-contract';
import type { PlanProjection } from '../../shared/workspace-plan-contract';
import type { SetupProjection } from '../../shared/workspace-term-contract';
/**
 * Renders the week grid, the selected day's detail, and the separate TBA group.
 *
 * @param {WorkspacePageContentProps} props Existing PLAN facts and executable handlers.
 * @return {ReactElement} Calendar page.
 */
export function CalendarPage(props: WorkspacePageContentProps): ReactElement {
    const { calendarWeek, plan, setup, setupIncomplete } = props;
    // The Calendar may show another week; Today, the week summary and TBA keep the
    // projection evaluated for today, so the two never disagree about "今天".
    const visiblePlan = calendarWeek?.plan ?? plan ?? null;
    const todayDate = plan?.evaluationContext.applicableDate ?? '';
    const dates = visiblePlan === null ? [] : sevenDayDates(visiblePlan.calendar.window.startDate);
    const selectedDate = visiblePlan === null
        ? ''
        : resolveCalendarSelectedDate(calendarWeek?.selectedDate ?? null, dates, todayDate);
    const onSelectDate = calendarWeek?.onSelectDate;
    const showConflict = (warning: AgendaConflictWarning): void => {
        const date = warning.first.occurrence.date;
        onSelectDate?.(date);
        document
            .querySelector(`.calendar-time-column[data-calendar-date="${date}"]`)
            ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    };

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
                facts={visiblePlan === null ? undefined : (
                    <CalendarWeekFacts
                        onShowConflict={showConflict}
                        plan={visiblePlan}
                    />
                )}
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
            {visiblePlan === null ? (
                <PlanUnavailable
                    {...props}
                    fallbackActionLabel="返回 Today"
                    fallbackPage="today"
                />
            ) : (
                <CalendarContent
                    dates={dates}
                    onNavigate={props.onNavigate}
                    onSelectDate={onSelectDate}
                    plan={visiblePlan}
                    selectedDate={selectedDate}
                    setup={setup}
                    todayDate={todayDate}
                />
            )}
        </article>
    );
}

/**
 * Renders the week navigation as one segmented control without inventing a date the projection lacks.
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
        <div className="calendar-week-controls">
            <div
                aria-label="日历周导航"
                className="segmented-control"
                role="group"
            >
                <button
                    className="segmented-action"
                    disabled={week.busy}
                    onClick={() => week.onShift(-1)}
                    type="button"
                >上一周</button>
                <button
                    className="segmented-action"
                    disabled={week.busy || week.offset === 0}
                    onClick={week.onReturnToCurrentWeek}
                    type="button"
                >回到本周</button>
                <button
                    className="segmented-action"
                    disabled={week.busy}
                    onClick={() => week.onShift(1)}
                    type="button"
                >下一周</button>
            </div>
            <span
                aria-live="polite"
                className="calendar-week-offset"
            >{week.busy ? '正在读取…' : offsetLabel}</span>
        </div>
    );
}

/**
 * Renders the header facts of the visible week: its range, its load, and any PLAN conflict.
 *
 * The two numbers are sums of the per-day counts PLAN already reported for this window; adding
 * seven numbers PLAN produced is presentation, not a second classification of the same items.
 *
 * @param {Object} props Unified PLAN projection for the visible week and the conflict handler.
 * @return {ReactElement} Week range, week load, and the conflict chip.
 */
export function CalendarWeekFacts(props: Readonly<{
    plan: PlanProjection;
    onShowConflict: (warning: AgendaConflictWarning) => void;
}>): ReactElement {
    const { agenda, calendar, week } = props.plan;
    const meetings = week.days.reduce((total, day) => total + day.meetingCount, 0);
    const tasks = week.days.reduce((total, day) => total + day.taskCount, 0);
    const conflict = agenda.warnings[0];

    return (
        <div className="calendar-week-facts">
            <p className="calendar-week-range">
                <time dateTime={calendar.window.startDate}>{calendar.window.startDate}</time>
                {' - '}
                <time dateTime={calendar.window.endDate}>{calendar.window.endDate}</time>
            </p>
            <p className="calendar-week-load">{meetings} 节课 · {tasks} 项任务</p>
            {conflict === undefined ? null : (
                <button
                    className="status-label calendar-conflict-chip"
                    data-severity="warning"
                    onClick={() => props.onShowConflict(conflict)}
                    type="button"
                >{agenda.warnings.length} 组时间冲突</button>
            )}
        </div>
    );
}

/**
 * Renders the week grid, the selected day's detail, and TBA from one PLAN projection.
 *
 * @param {Object} props Unified PLAN, Course colours, the selected day, and handlers.
 * @return {ReactElement} Seven-day grid over the selected-day detail and TBA group.
 */
export function CalendarContent(props: Readonly<{
    plan: PlanProjection;
    setup: SetupProjection;
    dates: readonly string[];
    selectedDate: string;
    todayDate: string;
    onSelectDate?: (date: string) => void;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const { dates, onSelectDate, plan, selectedDate, setup, todayDate } = props;
    const { calendar, tba } = plan;
    const timedPlacements = calendarTimedPlacements(
        calendar.timedItems,
        plan.evaluationContext.termZone,
    );
    const conflicting = conflictingMeetingIds(plan);
    const hourWindow = calendarHourWindow(timedPlacements);
    const gridStyle: CalendarGridStyle = {
        '--calendar-hour-count': `${hourWindow.endHour - hourWindow.startHour}`,
    };
    const hasAllDayLane = calendar.allDayItems.length > 0 || calendar.holidaySegments.length > 0;
    const hasCalendarFacts = calendar.timedItems.length > 0 || hasAllDayLane;
    const moveSelection = (event: KeyboardEvent<HTMLDivElement>): void => {
        const next = calendarDateFromKey(selectedDate, event.key, dates);
        if (next === null || onSelectDate === undefined) {
            return;
        }
        event.preventDefault();
        event.currentTarget.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
        onSelectDate(next);
    };

    return (
        <>
            <section
                aria-labelledby="calendar-week-title"
                className="content-card calendar-card"
            >
                <h2 id="calendar-week-title">七日课表</h2>
                <div
                    aria-label="可横向滚动的七日课表"
                    className="calendar-scroll-region"
                    tabIndex={0}
                >
                    <div
                        className="calendar-grid-shell"
                        style={gridStyle}
                    >
                        <div
                            aria-hidden="true"
                            className="calendar-grid-corner"
                        >日期</div>
                        <div
                            aria-label="选择要查看的日期"
                            className="calendar-day-grid"
                            onKeyDown={onSelectDate === undefined ? undefined : moveSelection}
                            role="tablist"
                        >
                            {dates.map(date => (
                                <CalendarDayTab
                                    date={date}
                                    key={date}
                                    onSelect={onSelectDate}
                                    selected={date === selectedDate}
                                    today={date === todayDate}
                                />
                            ))}
                        </div>
                        {!hasAllDayLane ? null : (
                            <>
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
                            </>
                        )}
                        <ol
                            aria-hidden="true"
                            className="calendar-time-labels"
                        >
                            {calendarHourLabels(
                                hourWindow.startHour,
                                hourWindow.endHour,
                            ).map(label => (
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
                                data-selected={date === selectedDate ? 'true' : undefined}
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
                                                color={courseColorFor(setup, placement.item.courseId)}
                                                conflict={conflicting.has(planItemId(placement.item))}
                                                key={`${planItemId(placement.item)}:${placement.date}`}
                                                placement={placement}
                                                startHour={hourWindow.startHour}
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
                <CalendarDayDetail
                    date={selectedDate}
                    onNavigate={props.onNavigate}
                    onSelectDate={onSelectDate}
                    plan={plan}
                    todayDate={todayDate}
                />

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
 * Renders one day's column head, which is also the control that selects that day.
 *
 * Today wears the accent capsule and keeps its 今天 word, so the current day never depends on
 * colour alone and never moves to whichever day happens to be selected.
 *
 * @param {Object} props One visible LocalDate and its two states.
 * @return {ReactElement} One tab in the day tablist.
 */
export function CalendarDayTab(props: Readonly<{
    date: string;
    selected: boolean;
    today: boolean;
    onSelect?: (date: string) => void;
}>): ReactElement {
    const { date, onSelect, selected, today } = props;

    return (
        <button
            aria-controls="calendar-day-detail"
            aria-current={today ? 'date' : undefined}
            aria-selected={selected}
            className="calendar-day-column"
            data-current={today ? 'true' : undefined}
            data-day={date}
            data-selected={selected ? 'true' : undefined}
            onClick={onSelect === undefined ? undefined : () => onSelect(date)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
        >
            <span className="calendar-day-weekday">{shortWeekdayOf(date)}</span>
            <time dateTime={date}>{date.slice(5)}</time>
            {today ? (
                <span className="calendar-current-label">今天</span>
            ) : null}
        </button>
    );
}

/**
 * Renders the selected day: its own Meetings, Tasks and Holidays, and the conflicts PLAN
 * reported on it.
 *
 * Membership, order and conflict all come from the Agenda PLAN already built for this window;
 * the panel only picks the day the reader asked for.
 *
 * @param {Object} props Unified PLAN, the selected day, today, and handlers.
 * @return {ReactElement} Selected-day panel.
 */
export function CalendarDayDetail(props: Readonly<{
    plan: PlanProjection;
    date: string;
    todayDate: string;
    onSelectDate?: (date: string) => void;
    onNavigate: (page: WorkspaceNavigationId) => void;
}>): ReactElement {
    const { date, onSelectDate, plan, todayDate } = props;
    const { agenda, calendar, tba, week } = plan;
    const { termZone } = plan.evaluationContext;
    const items = agendaItemsOnDate(agenda.items, termZone, date);
    const warnings = agenda.warnings.filter(warning => warning.first.occurrence.date === date);
    const day = week.days.find(row => row.date === date);
    const meetings = week.days.reduce((total, row) => total + row.meetingCount, 0);
    const tasks = week.days.reduce((total, row) => total + row.taskCount, 0);
    const todayInWeek = week.days.some(row => row.date === todayDate);

    return (
        <section
            aria-labelledby="calendar-day-title"
            className="content-card calendar-day-card"
            data-agenda-date={date}
            id="calendar-day-detail"
            role="tabpanel"
            tabIndex={0}
        >
            <div className="card-heading">
                <h2 id="calendar-day-title">
                    {shortWeekdayOf(date)} <time dateTime={date}>{date.slice(5)}</time>
                    {date === todayDate ? (
                        <span className="calendar-day-today">今天</span>
                    ) : null}
                </h2>
                {day === undefined ? null : (
                    <p className="page-context">{day.meetingCount} 节课 · {day.taskCount} 项任务</p>
                )}
            </div>
            {items.length > 0 ? (
                <ul className="fact-list agenda-list">
                    {items.map(item => (
                        <AgendaItem
                            item={item}
                            key={agendaItemId(item)}
                            termZone={termZone}
                        />
                    ))}
                </ul>
            ) : agenda.items.length === 0 ? (
                <EmptyState
                    action={tba.tasks.length > 0
                        ? buttonAction('查看任务页', () => props.onNavigate('tasks'))
                        : buttonAction('查看课程', () => props.onNavigate('courses'))}
                    id="calendar-day-empty"
                    reason={tba.tasks.length > 0
                        ? '当前范围没有已排期事项；尚未确定日期的任务仍保留在 TBA 分组。'
                        : '统一计划投影确认当前范围没有课节、任务或假期。'}
                    title="当前范围没有已排期事项"
                />
            ) : (
                <EmptyState
                    action={todayInWeek && date !== todayDate && onSelectDate !== undefined
                        ? buttonAction('看今天', () => onSelectDate(todayDate))
                        : buttonAction('查看任务页', () => props.onNavigate('tasks'))}
                    id="calendar-day-empty"
                    reason={`这一周还有 ${meetings} 节课和 ${tasks} 项任务，选另一天就能看到。`}
                    title="这一天没有已排期事项"
                />
            )}
            {warnings.length > 0 ? (
                <aside
                    aria-labelledby="calendar-conflicts-title"
                    className="calendar-conflicts"
                >
                    <h3 id="calendar-conflicts-title">时间冲突</h3>
                    <ul className="fact-list conflict-list">
                        {warnings.map(warning => (
                            <CalendarConflictItem
                                key={
                                    `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
                                }
                                termZone={termZone}
                                warning={warning}
                            />
                        ))}
                    </ul>
                </aside>
            ) : null}
        </section>
    );
}

/**
 * Renders one PLAN conflict warning with its overlap read in the Workspace TermZone.
 *
 * @param {Object} props One Agenda conflict warning and the Calendar zone.
 * @return {ReactElement} Conflict row.
 */
export function CalendarConflictItem(props: Readonly<{
    warning: AgendaConflictWarning;
    termZone: string;
}>): ReactElement {
    const { termZone, warning } = props;
    const start = localInstantParts(warning.overlap.startInstant, termZone);
    const end = localInstantParts(warning.overlap.endInstant, termZone);

    return (
        <li
            data-item-id={
                `${meetingItemId(warning.first)}:${meetingItemId(warning.second)}`
            }
        >
            <span
                className="status-label"
                data-severity="warning"
            >时间冲突</span>
            <p>{warning.first.courseCode} 与 {warning.second.courseCode}</p>
            <span>
                <time dateTime={warning.overlap.startInstant}>{minuteLabel(start.minute)}</time>
                {' - '}
                <time dateTime={warning.overlap.endInstant}>{minuteLabel(end.minute)}</time>
            </span>
        </li>
    );
}

export type CalendarGridStyle = CSSProperties & Readonly<{
    '--calendar-hour-count': string;
}>;

export type CalendarEventStyle = CSSProperties & Readonly<{
    '--calendar-event-top': string;
    '--calendar-event-height': string;
    '--calendar-event-left': string;
    '--calendar-event-min-height': string;
    '--calendar-event-width': string;
}>;

/**
 * Renders one timed occurrence inside its exact date lane and vertical minute range.
 *
 * @param {Object} props Placement derived only from existing PLAN occurrence facts.
 * @return {ReactElement} One positioned Calendar event.
 */
export function CalendarTimedItem(props: Readonly<{
    placement: CalendarTimedPlacement;
    startHour?: number;
    color?: CourseColor | null;
    conflict?: boolean;
}>): ReactElement {
    const { placement } = props;
    const item = placement.item;
    const startHour = props.startHour ?? 0;
    const style: CalendarEventStyle = {
        '--calendar-event-top':
            `${calendarMinutePixels(placement.startMinute - startHour * 60)}px`,
        '--calendar-event-height': `${calendarMinutePixels(placement.durationMinutes)}px`,
        '--calendar-event-left': `${placement.overlapLane / placement.overlapLaneCount * 100}%`,
        '--calendar-event-min-height': `${CALENDAR_EVENT_MIN_HEIGHT}px`,
        '--calendar-event-width': `${100 / placement.overlapLaneCount}%`,
    };
    // A 60-minute block is 33px tall, which holds exactly two lines of text: the title and one
    // meta line. Everything the block must say in words therefore shares that second line, and the
    // column already carries the date, so the meta line never repeats it.
    const label = item.kind === 'meeting'
        ? `${item.courseCode} · ${item.occurrence.type}`
        : item.occurrence.title;
    const parts = item.kind === 'meeting'
        ? [`${item.occurrence.localStart}-${item.occurrence.localEnd}`, meetingClassificationNames[item.classification]]
        : [item.courseCode, minuteLabel(placement.startMinute), taskClassificationNames[item.classification]];
    if (props.conflict === true) {
        // The overlap is a PLAN fact, so the block says it in words as well as in its background.
        // It leads the meta line because overlapping blocks share a column and ellipsize first.
        parts.unshift('冲突');
    }

    return (
        <li
            data-item-id={planItemId(item)}
            data-calendar-date={placement.date}
            data-start-minute={placement.startMinute}
            data-duration-minutes={placement.durationMinutes}
            data-continuation={placement.continuation ? 'true' : undefined}
            data-overlap-lane={placement.overlapLane}
            data-overlap-lane-count={placement.overlapLaneCount}
            data-conflict={props.conflict ? 'true' : undefined}
            data-course-color={props.color ?? undefined}
            style={style}
        >
            <strong>{label}</strong>
            <span>{parts.join(' · ')}</span>
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
            <span>{holiday.visibleStartDate} - {holiday.visibleEndDate}</span>
        </li>
    );
}

/**
 * Renders one Agenda item while preserving its existing PLAN kind.
 *
 * @param {Object} props Agenda item projection.
 * @return {ReactElement} Agenda row.
 */
export function AgendaItem(props: Readonly<{
    item: AgendaItemProjection;
    termZone?: string;
}>): ReactElement {
    if (props.item.kind === 'meeting') {
        return <MeetingItem meeting={props.item} />;
    }
    if (props.item.kind === 'task') {
        return (
            <TaskItem
                task={props.item}
                termZone={props.termZone}
            />
        );
    }

    return (
        <li data-item-id={props.item.holidayRange.holidayRangeId}>
            <span className="status-label">假期</span>
            <strong>{props.item.holidayRange.name}</strong>
            <span>{props.item.holidayRange.startDate} - {props.item.holidayRange.endDate}</span>
        </li>
    );
}

/**
 * Selects the Agenda facts that fall on one visible local date, in PLAN's own order.
 *
 * A named range covers every day between its own start and end, so a Reading Week reads the
 * same on Thursday as on Monday instead of only heading the day it began.
 *
 * @param {readonly AgendaItemProjection[]} items PLAN-owned Agenda order.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @param {string} date Selected LocalDate.
 * @return {readonly AgendaItemProjection[]} That day's Agenda facts.
 */
export function agendaItemsOnDate(
    items: readonly AgendaItemProjection[],
    termZone: string,
    date: string,
): readonly AgendaItemProjection[] {
    return items.filter(item => (item.kind === 'holiday-range'
        ? item.holidayRange.startDate <= date && date <= item.holidayRange.endDate
        : agendaItemDate(item, termZone) === date));
}

/**
 * Reads one dated Agenda fact's local date from its existing occurrence.
 * @param {PlanMeetingProjection | PlanTaskProjection} item PLAN-owned Agenda fact.
 * @param {string} termZone Workspace-owned Calendar zone.
 * @return {string | null} LocalDate, or null only for an unexpected TBA Agenda item.
 */
export function agendaItemDate(
    item: PlanMeetingProjection | PlanTaskProjection,
    termZone: string,
): string | null {
    if (item.kind === 'meeting') {
        return item.occurrence.date;
    }
    if (item.occurrence.deadline.kind === 'date-only') {
        return item.occurrence.deadline.date;
    }
    if (item.occurrence.deadline.kind === 'timed') {
        return localInstantParts(item.occurrence.deadline.instant, termZone).date;
    }
    return null;
}
