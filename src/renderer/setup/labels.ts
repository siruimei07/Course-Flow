import { CourseColor } from '../../shared/workspace-course-contract';
import type { MeetingWeekday } from '../../shared/workspace-course-contract';
export const COURSE_COLOR_NAMES: Readonly<Record<CourseColor, string>> = {
    red: '红色',
    orange: '橙色',
    yellow: '黄色',
    green: '绿色',
    blue: '蓝色',
    purple: '紫色',
    gray: '灰色',
};

export const WEEKDAY_NAMES: Readonly<Record<MeetingWeekday, string>> = {
    MON: '星期一',
    TUE: '星期二',
    WED: '星期三',
    THU: '星期四',
    FRI: '星期五',
    SAT: '星期六',
    SUN: '星期日',
};
