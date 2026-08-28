import type { ReactElement } from 'react';
import { courseColorNames, meetingLocationLabel, termContext, weekdayNames } from './shared';
import { EmptyState, PageHeader, SetupIncompleteNotice, buttonAction } from './widgets';
import type { WorkspacePageContentProps } from '../workspace-pages';
import { MeetingSeriesProjection } from '../../shared/workspace-course-contract';
import type { CourseProjection } from '../../shared/workspace-course-contract';
/**
 * Renders current setup Course facts without synthesizing missing meetings.
 *
 * @param {WorkspacePageContentProps} props Existing setup facts and executable handlers.
 * @return {ReactElement} Course list page.
 */
export function CoursesPage(props: WorkspacePageContentProps): ReactElement {
    const { setup, setupIncomplete } = props;
    const currentTermId = setup.currentTerm?.termId;
    const historicalMode = currentTermId === undefined
        && !setupIncomplete
        && setup.everReachedMinimum;
    const currentCourses = currentTermId
        ? setup.courses.filter(course => course.termId === currentTermId && !course.archived)
        : [];
    const displayedCourses = historicalMode ? setup.courses : currentCourses;

    return (
        <article
            aria-labelledby="courses-page-title"
            className="workspace-page workspace-page--courses"
        >
            <PageHeader
                context={historicalMode
                    ? `${displayedCourses.length} 门历史课程`
                    : `${termContext(setup)} · ${displayedCourses.length} 门课程`}
                eyebrow="Courses"
                headingId="courses-page-title"
                title="课程"
            />
            {setupIncomplete ? <SetupIncompleteNotice onContinueSetup={props.onContinueSetup} /> : null}
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
                        action={buttonAction('继续设置', props.onContinueSetup)}
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
                    <div className="workspace-grid workspace-grid--courses">
                        {displayedCourses.map(course => (
                            <CourseCard
                                course={course}
                                historical={historicalMode}
                                key={course.courseId}
                                onContinueSetup={props.onContinueSetup}
                            />
                        ))}
                    </div>
                )}
            </section>
        </article>
    );
}

/**
 * Renders one Course and its persisted meeting rules.
 *
 * @param {Object} props Course projection and executable setup action.
 * @return {ReactElement} Course card.
 */
export function CourseCard(props: Readonly<{
    course: CourseProjection;
    historical?: boolean;
    onContinueSetup: () => void;
}>): ReactElement {
    const { course } = props;
    const colorName = course.color ? courseColorNames[course.color] : '未设置';
    const colorClass = course.color ?? 'neutral';

    return (
        <article
            className={`content-card course-card course-card--${colorClass}`}
            data-item-id={course.courseId}
        >
            <header className="course-card-header">
                <p className="status-label">
                    {course.archived ? '已归档' : props.historical ? '历史' : '当前'}
                </p>
                <h2>{course.code}</h2>
                <p>{course.name}</p>
            </header>
            <dl className="course-facts">
                <div>
                    <dt>教学范围</dt>
                    <dd>{course.teachingRange.startDate} – {course.teachingRange.endDate}</dd>
                </div>
                <div>
                    <dt>Section</dt>
                    <dd>{course.section ?? '未设置'}</dd>
                </div>
                <div>
                    <dt>教授</dt>
                    <dd>{course.instructor ?? '未设置'}</dd>
                </div>
                <div>
                    <dt>课程色</dt>
                    <dd>{colorName}</dd>
                </div>
                <div>
                    <dt>学分</dt>
                    <dd>{course.credits ?? '未设置'}</dd>
                </div>
            </dl>
            <section
                aria-labelledby={`course-${course.courseId}-meetings-title`}
                className="course-meetings"
            >
                <h3 id={`course-${course.courseId}-meetings-title`}>课节规则</h3>
                {course.meetings.length === 0 ? (
                    <EmptyState
                        action={buttonAction(
                            props.historical ? '创建新学期' : '继续设置',
                            props.onContinueSetup,
                        )}
                        headingLevel="h4"
                        id={`course-${course.courseId}-meetings-empty`}
                        reason={props.historical
                            ? '这门历史课程没有保存课节规则；不会为它补造日程。'
                            : '这门课程已保存，但还没有真实课节规则。'}
                        title="尚未添加课节"
                    />
                ) : (
                    <ul className="fact-list meeting-rule-list">
                        {course.meetings.map(meeting => (
                            <MeetingRuleItem
                                key={meeting.meetingSeriesId}
                                meeting={meeting}
                            />
                        ))}
                    </ul>
                )}
            </section>
        </article>
    );
}

/**
 * Renders one stable meeting rule from a Course projection.
 *
 * @param {Object} props Meeting-series projection.
 * @return {ReactElement} Meeting rule row.
 */
export function MeetingRuleItem(props: Readonly<{ meeting: MeetingSeriesProjection }>): ReactElement {
    const { meeting } = props;

    return (
        <li data-item-id={meeting.meetingSeriesId}>
            <strong>{meeting.type.code} · {meeting.type.name}</strong>
            <span>{weekdayNames[meeting.weekday]} {meeting.localStart}–{meeting.localEnd}</span>
            <span>{meetingLocationLabel(meeting.location)}</span>
            <small>{meeting.effectiveRange.startDate} – {meeting.effectiveRange.endDate}</small>
        </li>
    );
}
