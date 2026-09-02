import type { CSSProperties, ReactElement } from 'react';
import { courseWeekdaySummary, sortedCourseMeetings, termContext } from './shared';
import { EmptyState, PageHeader, SetupIncompleteNotice, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
import type { CourseProjection, MeetingSeriesProjection } from '../../shared/workspace-course-contract';
import type { PlanCourseTaskSummary, PlanProjection } from '../../shared/workspace-plan-contract';
/** `canonicalCredits` keeps at most six fraction digits, so a total is exact at that scale. */
const COURSE_CREDITS_SCALE = 1_000_000;

export type CourseSlotEntry = Readonly<{
    /** Stable identity of the first rule on this line; never a key built from its dates or times. */
    meetingSeriesId: string;
    weekdays: string;
    time: string;
    range: string | null;
}>;

export type CourseSlotGroup = Readonly<{
    code: string;
    name: string;
    entries: readonly CourseSlotEntry[];
}>;

type CourseProgressStyle = CSSProperties & Readonly<{ '--done': string }>;

/**
 * Renders current setup Course facts and, when PLAN is readable, each Course's Task completion.
 *
 * @param {WorkspacePageContentProps} props Existing setup facts, PLAN summaries, and executable handlers.
 * @return {ReactElement} Course list page.
 */
export function CoursesPage(props: WorkspacePageContentProps): ReactElement {
    const { plan, setup, setupIncomplete } = props;
    const currentTermId = setup.currentTerm?.termId;
    const historicalMode = currentTermId === undefined
        && !setupIncomplete
        && setup.everReachedMinimum;
    const termCourses = currentTermId
        ? setup.courses.filter(course => course.termId === currentTermId)
        : [];
    const displayedCourses = historicalMode
        ? setup.courses
        : termCourses.filter(course => !course.archived);
    // Archiving is a state relative to the current Term, so history is not split a second time.
    const archivedCourses = historicalMode
        ? []
        : termCourses.filter(course => course.archived);
    const credits = totalCourseCredits(displayedCourses);

    return (
        <article
            aria-labelledby="courses-page-title"
            className="workspace-page workspace-page--courses"
        >
            <PageHeader
                actions={historicalMode ? undefined : (
                    <>
                        <button
                            className="primary-action"
                            onClick={() => props.onOpenManagement('course')}
                            type="button"
                        >添加课程</button>
                        <button
                            className="secondary-action"
                            onClick={() => props.onOpenManagement('meeting')}
                            type="button"
                        >添加课节</button>
                    </>
                )}
                context={termContext(setup)}
                facts={(
                    <CoursesHeadline
                        courseCount={displayedCourses.length}
                        credits={credits}
                    />
                )}
                headingId="courses-page-title"
                title="课程"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
            {plan || displayedCourses.length === 0 ? null : (
                <div className="status-banner courses-plan-banner">
                    <p role="status">这次没能读到计划，每门课的任务完成度暂时不显示；课程本身的事实照常显示。</p>
                    {props.onRetryPlan === undefined ? null : (
                        <button
                            className="secondary-action"
                            onClick={props.onRetryPlan}
                            type="button"
                        >重试</button>
                    )}
                </div>
            )}
            <section
                aria-labelledby="course-list-title"
                className="page-section"
            >
                <h2
                    className={historicalMode ? undefined : 'visually-hidden'}
                    id="course-list-title"
                >{historicalMode ? '历史课程' : '当前学期课程'}</h2>
                {displayedCourses.length === 0 ? (
                    <EmptyState
                        action={currentTermId
                            ? buttonAction('添加课程', () => props.onOpenManagement('course'))
                            : buttonAction('继续设置', props.onContinueSetup)}
                        id="courses-empty"
                        reason={historicalMode
                            ? '曾达到最低设置条件，但当前投影没有可显示的历史课程。'
                            : currentTermId
                            ? '最低设置条件还缺少当前学期课程，因此这里没有课程事实。'
                            : '尚无当前学期，无法确定要显示哪一组课程；历史课程不会冒充当前课程。'}
                        title={historicalMode
                            ? '没有可显示的历史课程'
                            : currentTermId
                                ? '当前学期还没有课程'
                                : '尚无当前学期'}
                    />
                ) : (
                    <ul className="workspace-grid workspace-grid--courses">
                        {displayedCourses.map(course => (
                            <CourseCard
                                course={course}
                                historical={historicalMode}
                                key={course.courseId}
                                onAddMeeting={() => props.onOpenManagement('meeting')}
                                onContinueSetup={props.onContinueSetup}
                                planned={Boolean(plan)}
                                summary={plan ? courseTaskSummary(plan, course.courseId) : undefined}
                            />
                        ))}
                    </ul>
                )}
            </section>
            {archivedCourses.length === 0 ? null : (
                <details className="course-archive">
                    <summary>
                        <span>已归档课程 {archivedCourses.length} 门</span>
                        <svg
                            aria-hidden="true"
                            className="course-chevron"
                            viewBox="0 0 16 16"
                        ><path d="M4 6l4 4 4-4" /></svg>
                    </summary>
                    <ul className="workspace-grid workspace-grid--courses">
                        {archivedCourses.map(course => (
                            <CourseCard
                                course={course}
                                key={course.courseId}
                                onAddMeeting={() => props.onOpenManagement('meeting')}
                                onContinueSetup={props.onContinueSetup}
                                planned={Boolean(plan)}
                                summary={plan ? courseTaskSummary(plan, course.courseId) : undefined}
                            />
                        ))}
                    </ul>
                </details>
            )}
        </article>
    );
}

/**
 * Renders the two page numbers: the visible Course count and, when every Course carries one,
 * their credit total.
 *
 * @param {Object} props Visible Course count and the all-or-nothing credit total.
 * @return {ReactElement} Header facts.
 */
export function CoursesHeadline(props: Readonly<{
    courseCount: number;
    credits: string | null;
}>): ReactElement {
    return (
        <dl className="page-headline-stats">
            <div className="page-headline-stat">
                <dt>课程</dt>
                <dd>{props.courseCount}</dd>
            </div>
            {props.credits === null ? null : (
                <div className="page-headline-stat">
                    <dt>学分</dt>
                    <dd>{props.credits}</dd>
                </div>
            )}
        </dl>
    );
}

/**
 * Renders one Course: its identity, its weekly Meeting rules, and its PLAN Task completion.
 *
 * @param {Object} props Course projection, its PLAN summary, and executable setup actions.
 * @return {ReactElement} Course card, one item of the roster list.
 */
export function CourseCard(props: Readonly<{
    course: CourseProjection;
    historical?: boolean;
    onAddMeeting: () => void;
    onContinueSetup: () => void;
    planned: boolean;
    summary?: PlanCourseTaskSummary;
}>): ReactElement {
    const { course } = props;
    const meta = [course.instructor, course.section].filter(value => value !== null);
    const groups = courseSlotGroups(course);

    return (
        <li
            className="content-card course-card"
            data-course-color={course.color ?? undefined}
            data-item-id={course.courseId}
        >
            <header className="course-card-header">
                <h3 className="course-card-heading">
                    <span className="course-card-identity">
                        <span
                            aria-hidden="true"
                            className="course-dot"
                        />
                        <span className="course-card-code">{course.code}</span>
                    </span>
                    <span className="course-card-name">{course.name}</span>
                </h3>
                {course.credits === null ? null : (
                    <p className="course-card-credits">{course.credits} 学分</p>
                )}
                {meta.length === 0 ? null : (
                    <p className="course-card-meta">{meta.join(' · ')}</p>
                )}
                {course.teachingRange.kind === 'explicit' ? (
                    <p className="course-card-range">
                        教学范围 {course.teachingRange.startDate} - {course.teachingRange.endDate}
                    </p>
                ) : null}
                {course.archived ? (
                    <p
                        className="status-label"
                        data-severity="neutral"
                    >已归档</p>
                ) : null}
            </header>
            {groups.length === 0 ? (
                <EmptyState
                    action={props.historical
                        ? buttonAction('创建新学期', props.onContinueSetup)
                        : buttonAction('添加课节', props.onAddMeeting)}
                    headingLevel="h4"
                    id={`course-${course.courseId}-meetings-empty`}
                    reason={props.historical
                        ? '这门历史课程没有保存课节规则；不会为它补造日程。'
                        : '这门课程已保存，但还没有真实课节规则。'}
                    title="尚未添加课节"
                />
            ) : (
                <div className="course-slots-block">
                    <p className="course-block-label">每周课节</p>
                    <dl className="course-slot-groups">
                        {groups.map(group => (
                            <div key={group.code}>
                                <dt>{group.name}</dt>
                                <dd>
                                    <ul className="course-slot-chips">
                                        {group.entries.map(entry => (
                                            <li key={entry.meetingSeriesId}>
                                                {entry.weekdays} {entry.time}
                                                {entry.range === null ? null : ` · ${entry.range}`}
                                            </li>
                                        ))}
                                    </ul>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
            <CourseProgress
                planned={props.planned}
                slotted={groups.length > 0}
                summary={props.summary}
            />
        </li>
    );
}

/**
 * Renders one Course's Task completion exactly as PLAN summarised it.
 *
 * The bar is the visual encoding only: the adjacent count and the two chips carry the same
 * facts as text, so nothing is announced twice and no state rests on colour alone.
 *
 * @param {Object} props Whether PLAN could be read at all, the PLAN row for this Course when it
 *     has one, and whether the card already shows the higher-priority "no Meeting rule yet" state.
 * @return {ReactElement | null} Completion block, one sentence, or nothing.
 */
export function CourseProgress(props: Readonly<{
    planned: boolean;
    slotted: boolean;
    summary?: PlanCourseTaskSummary;
}>): ReactElement | null {
    const { summary } = props;
    if (!props.planned) {
        return null;
    }
    // A Course PLAN never summarised has no occurrence at all; that is a real zero, not a gap.
    if (summary === undefined || summary.countable === 0) {
        // One card never stacks two empty states: the missing Meeting rule is the first thing to fix.
        if (!props.slotted) {
            return null;
        }
        // Skipped occurrences leave the denominator but not the record, so "nothing yet" would lie.
        const skipped = summary?.skipped ?? 0;
        return (
            <p className="course-progress-empty">{skipped === 0
                ? '还没有任务。'
                : `${skipped} 项任务已跳过，没有要做的任务。`}</p>
        );
    }
    const style: CourseProgressStyle = { '--done': `${summary.completed / summary.countable}` };

    return (
        <div className="course-progress">
            <p className="course-block-label">任务完成度</p>
            <p className="course-progress-count">已完成 {summary.completed} / {summary.countable} 项</p>
            {summary.overdue === 0 && summary.tba === 0 ? null : (
                <p className="course-progress-note">
                    {summary.overdue === 0 ? null : (
                        <span
                            className="status-label"
                            data-severity="critical"
                        >逾期 {summary.overdue}</span>
                    )}
                    {summary.tba === 0 ? null : <span className="status-label">TBA {summary.tba}</span>}
                </p>
            )}
            <div
                aria-hidden="true"
                className="term-tasks-bar course-progress-bar"
            ><span style={style} /></div>
        </div>
    );
}

/**
 * Reads the PLAN row that already summarised one Course's Task occurrences.
 *
 * @param {PlanProjection} plan Unified PLAN projection.
 * @param {string} courseId Stable Course identity.
 * @return {PlanCourseTaskSummary | undefined} PLAN row, absent when the Course has no occurrence.
 */
export function courseTaskSummary(
    plan: PlanProjection,
    courseId: string,
): PlanCourseTaskSummary | undefined {
    return plan.courses.find(row => row.courseId === courseId);
}

/**
 * Sums credits only when every visible Course carries one.
 *
 * Credits are optional, so the sum is one all-or-nothing decision: a total that silently treated a
 * blank credit as zero would be a made-up number. The stored value is already a canonical decimal
 * (`canonicalCredits`), so the only gap a Course can leave here is a missing one.
 *
 * @param {readonly CourseProjection[]} courses Courses shown in the main grid.
 * @return {string | null} Formatted total, or null when no honest total exists.
 */
export function totalCourseCredits(courses: readonly CourseProjection[]): string | null {
    if (courses.length === 0) {
        return null;
    }
    let total = 0;
    for (const course of courses) {
        if (course.credits === null) {
            return null;
        }
        total += Number(course.credits);
    }
    // Rounded at the contract's own fraction limit, which also drops binary-float noise.
    return String(Math.round(total * COURSE_CREDITS_SCALE) / COURSE_CREDITS_SCALE);
}

/**
 * Groups one Course's weekly Meeting rules by type, then merges the rules that repeat the same
 * clock, so a Monday/Wednesday/Friday lecture reads as one line instead of three.
 *
 * @param {CourseProjection} course Course projection and its Meeting series.
 * @return {readonly CourseSlotGroup[]} One group per Meeting type, in weekday order.
 */
export function courseSlotGroups(course: CourseProjection): readonly CourseSlotGroup[] {
    const groups = new Map<string, { name: string; entries: Map<string, MeetingSeriesProjection[]> }>();
    for (const meeting of sortedCourseMeetings(course.meetings)) {
        let group = groups.get(meeting.type.code);
        if (group === undefined) {
            group = { name: meeting.type.name, entries: new Map() };
            groups.set(meeting.type.code, group);
        }
        // Rules that repeat the same clock merge into one line. Every fact the line shows has to
        // be part of this key, or the merged line would speak for a rule it does not describe.
        const { effectiveRange } = meeting;
        const key = [
            meeting.localStart,
            meeting.localEnd,
            meeting.endDayOffset,
            effectiveRange.kind,
            effectiveRange.startDate,
            effectiveRange.endDate,
        ].join('|');
        const bucket = group.entries.get(key);
        if (bucket === undefined) {
            group.entries.set(key, [meeting]);
        } else {
            bucket.push(meeting);
        }
    }

    return [...groups.entries()].map(([code, group]) => ({
        code,
        name: group.name,
        entries: [...group.entries.values()].map(meetings => ({
            // The bucket key is display text, so the line takes the first rule's own identity.
            meetingSeriesId: meetings[0]!.meetingSeriesId,
            weekdays: courseWeekdaySummary(meetings),
            time: meetingSlotTime(meetings[0]!),
            range: meetingSlotRange(meetings[0]!, course),
        })),
    }));
}

/**
 * Writes one Meeting rule's clock, keeping a next-day end visible.
 *
 * @param {MeetingSeriesProjection} meeting Persisted Meeting rule.
 * @return {string} Local clock for the card.
 */
export function meetingSlotTime(meeting: MeetingSeriesProjection): string {
    return meeting.endDayOffset === 0
        ? `${meeting.localStart}-${meeting.localEnd}`
        : `${meeting.localStart}-次日 ${meeting.localEnd}`;
}

/**
 * Names a Meeting rule's own effective range only where it differs from the Course range.
 *
 * @param {MeetingSeriesProjection} meeting Persisted Meeting rule.
 * @param {CourseProjection} course Owning Course and its teaching range.
 * @return {string | null} Shortened range, or null when the rule follows the Course.
 */
export function meetingSlotRange(
    meeting: MeetingSeriesProjection,
    course: CourseProjection,
): string | null {
    const range = meeting.effectiveRange;
    if (range.kind !== 'explicit') {
        return null;
    }
    const sameStart = range.startDate === course.teachingRange.startDate;
    const sameEnd = range.endDate === course.teachingRange.endDate;
    if (sameStart && sameEnd) {
        return null;
    }
    if (sameStart) {
        return `至 ${range.endDate}`;
    }
    if (sameEnd) {
        return `${range.startDate} 起`;
    }
    return `${range.startDate} - ${range.endDate}`;
}
