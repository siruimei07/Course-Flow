import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json';
import {
    createCourseWithMeetingDigestProjection,
    type CreateCourseWithMeetingCommand,
} from '../shared/workspace-course-contract';
import {
    recordSetupDecisionDigestProjection,
    type RecordSetupDecisionCommand,
} from '../shared/workspace-data-contract';
import {
    createTermDigestProjection,
    type CreateTermCommand,
} from '../shared/workspace-term-contract';

export function digestRecordSetupDecision(command: RecordSetupDecisionCommand): Uint8Array {
    const canonicalText = canonicalJson(recordSetupDecisionDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCreateTerm(command: CreateTermCommand): Uint8Array {
    const canonicalText = canonicalJson(createTermDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}

export function digestCreateCourseWithMeeting(command: CreateCourseWithMeetingCommand): Uint8Array {
    const canonicalText = canonicalJson(createCourseWithMeetingDigestProjection(command));
    return createHash('sha256').update(canonicalText, 'utf8').digest();
}
