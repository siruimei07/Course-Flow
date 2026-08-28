/**
 * @file Term-zone local-date arithmetic shared by meeting and task occurrence rules.
 */

import type { MeetingWeekday } from '../shared/workspace-course-contract';

export const MILLISECONDS_PER_DAY = 86_400_000;

export const MEETING_WEEKDAY_NUMBERS: Readonly<Record<MeetingWeekday, number>> = Object.freeze({
    SUN: 0,
    MON: 1,
    TUE: 2,
    WED: 3,
    THU: 4,
    FRI: 5,
    SAT: 6,
});

/**
 * Converts a canonical LocalDate to a UTC arithmetic coordinate.
 * @param {string} value - Canonical LocalDate.
 * @return {number} UTC midnight milliseconds used only for date arithmetic.
 */
export function localDateMilliseconds(value: string): number {
    return Date.parse(`${value}T00:00:00.000Z`);
}

/**
 * Adds an in-range number of calendar days to a canonical LocalDate.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset known to remain representable.
 * @return {string} Shifted canonical LocalDate.
 */
export function addLocalDateDays(value: string, days: number): string {
    return new Date(localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY)
        .toISOString()
        .slice(0, 10);
}

/**
 * Adds days while clamping to the supported LocalDate endpoints.
 * @param {string} value - Canonical LocalDate.
 * @param {number} days - Signed day offset.
 * @return {string} Shifted or endpoint-clamped canonical LocalDate.
 */
export function addClampedLocalDateDays(value: string, days: number): string {
    const shifted = localDateMilliseconds(value) + days * MILLISECONDS_PER_DAY;
    const minimum = localDateMilliseconds('0000-01-01');
    const maximum = localDateMilliseconds('9999-12-31');
    return new Date(Math.min(maximum, Math.max(minimum, shifted))).toISOString().slice(0, 10);
}
