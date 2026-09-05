/**
 * @file Resolves Meeting local times through explicit TermZone rules.
 */

import { isCanonicalLocalDate } from './workspace-term-contract';

export type MeetingEndDayOffset = 0 | 1;

export type MeetingTimeInput = Readonly<{
    termZone: string;
    date: string;
    localStart: string;
    localEnd: string;
    endDayOffset: MeetingEndDayOffset;
}>;

export type MeetingInstantWindow = Readonly<{
    startInstant: string;
    endInstant: string;
}>;

export interface ZoneRules {
    resolveInstant(termZone: string, localDate: string, localTime: string): string;
}

const LOCAL_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const OFFSET_SAMPLE_HOURS = [-36, -12, 0, 12, 36] as const;

/**
 * Validates one canonical millisecond-precision UTC Instant.
 * @param {unknown} value - Candidate Instant.
 * @return {boolean} Whether the value round-trips through UTC exactly.
 */
export function isCanonicalInstant(value: unknown): value is string {
    if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
        return false;
    }
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

/**
 * Builds a UTC arithmetic coordinate without applying a system time zone.
 * @param {number} year - ISO calendar year.
 * @param {number} month - One-based ISO calendar month.
 * @param {number} day - One-based ISO calendar day.
 * @param {number} hour - Local hour.
 * @param {number} minute - Local minute.
 * @param {number} second - Local second.
 * @return {number} UTC coordinate used only for local-field comparison.
 */
function utcCoordinate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
): number {
    const date = new Date(0);
    date.setUTCHours(hour, minute, second, 0);
    date.setUTCFullYear(year, month - 1, day);
    return date.getTime();
}

/**
 * Parses a canonical local date and time into a zone-free coordinate.
 * @param {string} localDate - Canonical LocalDate.
 * @param {string} localTime - Canonical minute-precision LocalTime.
 * @return {number} Zone-free local coordinate.
 */
function localCoordinate(localDate: string, localTime: string): number {
    const year = Number(localDate.slice(0, 4));
    const month = Number(localDate.slice(5, 7));
    const day = Number(localDate.slice(8, 10));
    const hour = Number(localTime.slice(0, 2));
    const minute = Number(localTime.slice(3, 5));
    return utcCoordinate(year, month, day, hour, minute, 0);
}

/**
 * ponytail: Bound pure results to 512 entries in one zone; eviction only repeats locked-tzdb work.
 * @const
 * @type {number}
 */
const MAX_RECENT_ZONE_INSTANTS = 512;

/** Keeps only the most recent explicit zone and its recomputable Instant results. */
let recentZoneFormatter: {
    input: string;
    canonicalZone: string;
    formatter: Intl.DateTimeFormat;
    instants: Map<string, string>;
} | null = null;

/**
 * Reuses the validated explicit-zone formatter used to inspect one tzdb rule set.
 * @param {string} termZone - Candidate IANA zone identity.
 * @return {Object} Validated explicit-zone formatter and bounded resolved Instants.
 */
function localZoneFormatting(termZone: string): NonNullable<typeof recentZoneFormatter> {
    if (typeof termZone !== 'string' || termZone.length === 0) {
        throw new TypeError('Meeting time has an invalid TermZone');
    }
    if (recentZoneFormatter !== null
        && (termZone === recentZoneFormatter.input || termZone === recentZoneFormatter.canonicalZone)) {
        return recentZoneFormatter;
    }

    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            calendar: 'gregory',
            numberingSystem: 'latn',
            timeZone: termZone,
            year: 'numeric',
            era: 'short',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        recentZoneFormatter = {
            input: termZone,
            canonicalZone: formatter.resolvedOptions().timeZone,
            formatter,
            instants: new Map(),
        };
        return recentZoneFormatter;
    }
    catch {
        throw new TypeError('Meeting time has an invalid TermZone');
    }
}

/**
 * Reads an Instant as a local coordinate in one explicit zone.
 * @param {Intl.DateTimeFormat} formatter - Explicit-zone formatter.
 * @param {number} instant - Epoch milliseconds.
 * @return {number} Zone-free coordinate of the formatted local fields.
 */
function formattedLocalCoordinate(formatter: Intl.DateTimeFormat, instant: number): number {
    const values = Object.fromEntries(
        formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]),
    );
    const displayedYear = Number(values.year);
    const isoYear = values.era === 'BC' ? 1 - displayedYear : displayedYear;
    return utcCoordinate(
        isoYear,
        Number(values.month),
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
    );
}

/**
 * Computes compatible DST disambiguation for validated local fields.
 * @param {Intl.DateTimeFormat} formatter - Validated explicit-zone formatter.
 * @param {string} localDate - Canonical LocalDate.
 * @param {string} localTime - Canonical LocalTime.
 * @return {string} Canonical Instant from the runtime's locked tzdb.
 */
function resolveLocalInstant(formatter: Intl.DateTimeFormat, localDate: string, localTime: string): string {
    const target = localCoordinate(localDate, localTime);
    const offsets = new Set(OFFSET_SAMPLE_HOURS.map(hours => {
        const sample = target + hours * 60 * MILLISECONDS_PER_MINUTE;
        return formattedLocalCoordinate(formatter, sample) - sample;
    }));
    const candidates = Array.from(offsets, offset => target - offset);
    const exact = candidates
        .filter(instant => formattedLocalCoordinate(formatter, instant) === target)
        .sort((first, second) => first - second);
    if (exact.length > 0) {
        return new Date(exact[0]!).toISOString();
    }

    const shifted = candidates
        .map(instant => ({ instant, local: formattedLocalCoordinate(formatter, instant) }))
        .filter(candidate => candidate.local > target)
        .sort((first, second) => first.local - second.local || first.instant - second.instant);
    if (shifted.length === 0) {
        throw new TypeError('Meeting local time cannot be resolved in its TermZone');
    }
    return new Date(shifted[0]!.instant).toISOString();
}

/**
 * Resolves a local date-time using compatible DST disambiguation.
 * @param {string} termZone - Explicit TermZone.
 * @param {string} localDate - Canonical LocalDate.
 * @param {string} localTime - Canonical LocalTime.
 * @return {string} Canonical Instant, choosing the earlier overlap and shifting a gap forward.
 */
function resolveIntlInstant(termZone: string, localDate: string, localTime: string): string {
    if (!isCanonicalLocalDate(localDate)
        || typeof localTime !== 'string'
        || !LOCAL_TIME_PATTERN.test(localTime)) {
        throw new TypeError('Meeting time has invalid local fields');
    }
    const zoneFormatting = localZoneFormatting(termZone);
    const key = `${localDate}T${localTime}`;
    const cachedInstant = zoneFormatting.instants.get(key);
    if (cachedInstant !== undefined) {
        return cachedInstant;
    }
    const instant = resolveLocalInstant(zoneFormatting.formatter, localDate, localTime);
    if (zoneFormatting.instants.size >= MAX_RECENT_ZONE_INSTANTS) {
        zoneFormatting.instants.clear();
    }
    zoneFormatting.instants.set(key, instant);
    return instant;
}

/**
 * Default ZoneRules backed by the runtime's explicit-zone Intl/tzdb implementation.
 * @const
 * @type {ZoneRules}
 */
export const INTL_ZONE_RULES: ZoneRules = Object.freeze({
    resolveInstant: resolveIntlInstant,
});

/**
 * Adds one calendar day without consulting a system time zone.
 * @param {string} localDate - Canonical LocalDate.
 * @param {MeetingEndDayOffset} dayOffset - Same-day or next-day offset.
 * @return {string} Shifted LocalDate.
 */
function addLocalDateOffset(localDate: string, dayOffset: MeetingEndDayOffset): string {
    const coordinate = Date.parse(`${localDate}T00:00:00.000Z`);
    const shifted = coordinate + dayOffset * MILLISECONDS_PER_DAY;
    const maximum = Date.parse('9999-12-31T00:00:00.000Z');
    if (shifted > maximum) {
        throw new TypeError('Meeting end date is outside the supported LocalDate range');
    }
    return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Resolves a Meeting occurrence to a positive Instant window.
 * @param {MeetingTimeInput} value - Explicit TermZone and local Meeting fields.
 * @param {ZoneRules} zoneRules - Injected explicit-zone rule resolver.
 * @return {MeetingInstantWindow} Canonical half-open Instant window.
 */
export function resolveMeetingOccurrenceTime(
    value: MeetingTimeInput,
    zoneRules: ZoneRules = INTL_ZONE_RULES,
): MeetingInstantWindow {
    if (!isCanonicalLocalDate(value.date)
        || !LOCAL_TIME_PATTERN.test(value.localStart)
        || !LOCAL_TIME_PATTERN.test(value.localEnd)
        || (value.endDayOffset !== 0 && value.endDayOffset !== 1)) {
        throw new TypeError('Meeting time has invalid fields');
    }
    const endDate = addLocalDateOffset(value.date, value.endDayOffset);
    const startInstant = zoneRules.resolveInstant(value.termZone, value.date, value.localStart);
    const endInstant = zoneRules.resolveInstant(value.termZone, endDate, value.localEnd);
    if (!isCanonicalInstant(startInstant)
        || !isCanonicalInstant(endInstant)
        || endInstant <= startInstant) {
        throw new TypeError('Meeting end Instant must be later than its start Instant');
    }
    return Object.freeze({ startInstant, endInstant });
}

/**
 * Finds the positive intersection of two half-open Meeting windows.
 * @param {MeetingInstantWindow} first - First canonical Instant window.
 * @param {MeetingInstantWindow} second - Second canonical Instant window.
 * @return {MeetingInstantWindow | null} Positive overlap, or null at an exact boundary.
 */
export function findMeetingTimeOverlap(
    first: MeetingInstantWindow,
    second: MeetingInstantWindow,
): MeetingInstantWindow | null {
    const startInstant = first.startInstant > second.startInstant
        ? first.startInstant
        : second.startInstant;
    const endInstant = first.endInstant < second.endInstant
        ? first.endInstant
        : second.endInstant;
    return startInstant < endInstant ? Object.freeze({ startInstant, endInstant }) : null;
}
