import { SqliteDataStore } from '../../data/store/kernel';
import type { RestoreActivationFileOptions } from '../../platform/restore-activation-files';
import { RestoreSessionActionCommand } from '../../shared/workspace-protection-contract';
import type { RestoreSessionView } from '../../shared/workspace-protection-contract';
export const RESTORE_DIRECTORY_NAME = 'restore';

export const SESSION_DIRECTORY_NAME = 'session';

export const JOURNAL_DIRECTORY_NAME = 'journal';

export const PLAN_FILE_NAME = 'activation-plan-v1';

export const ACTIVE_SLOT_NAME = 'active';

export const PLAN_MAXIMUM_BYTES = 262_144;

export const RECORD_MAXIMUM_BYTES = 65_536;

export const TOTAL_RECORD_LIMIT = 256;

export const SESSION_SCHEMA = 'courseflow-restore-session-control-v1';

export const PLAN_SCHEMA = 'courseflow-activation-plan-v1';

export const JOURNAL_SCHEMA = 'courseflow-activation-journal-record-v1';

export const LIMITS_VERSION = 'activation-journal-limits-v1';

export const CANONICAL_ENCODING = 'courseflow-canonical-json-v1';

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const MAXIMUM_JSON_DEPTH = 16;

export const MAXIMUM_JSON_STRING_LENGTH = 32_767;

export const TEMPORARY_PUBLICATION_NAME = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const JOURNAL_KINDS = Object.freeze([
    'armed',
    'command-resume',
    'command-rollback',
    'intent-retire-old-data',
    'observed-retire-old-data',
    'intent-install-candidate-data',
    'observed-install-candidate-data',
    'candidate-installed',
    'reopened',
    'success-receipt',
    'committed',
    'intent-quarantine-candidate-data',
    'observed-quarantine-candidate-data',
    'intent-restore-old-data',
    'observed-restore-old-data',
    'rollback-reopened',
    'rollback-receipt',
    'rolled-back',
] as const);

export type JournalKind = typeof JOURNAL_KINDS[number];

export type SlotState =
    | Readonly<{kind: 'absent'}>
    | Readonly<{kind: 'present'; slotFingerprint: string}>;

export type DatabaseEvidence = Readonly<{
    active: SlotState;
    candidate: SlotState;
    rollback: SlotState;
    quarantine: SlotState;
}>;

export type ActivationPlanV1 = Readonly<{
    schema: typeof PLAN_SCHEMA;
    limitsVersion: typeof LIMITS_VERSION;
    operationId: string;
    restoreSessionId: string;
    sessionVersion: '2';
    preCheckpointSessionDigest: string;
    previousTerminal: RestoreTerminalEvidence | null;
    candidate: Readonly<{
        snapshotId: string;
        rootDigest: string;
        sourceSchemaLevel: string;
        postMigrationSchemaLevel: string;
        workspaceId: string;
        revision: string;
    }>;
    protection: Readonly<{
        kind: 'required';
        safetySetId: string;
        rootDigest: string;
    }>;
    database: Readonly<{
        old: Readonly<{
            kind: 'validated';
            workspaceId: string;
            revision: string;
            slotFingerprint: string;
        }>;
        candidate: Readonly<{
            kind: 'present';
            workspaceId: string;
            revision: string;
            slotFingerprint: string;
        }>;
        privateLocations: Readonly<{
            active: string;
            candidateSibling: string;
            rollbackSibling: string;
            quarantineSibling: string;
        }>;
    }>;
    library: Readonly<{kind: 'absent'}>;
    versions: Readonly<{
        canonicalEncoding: typeof CANONICAL_ENCODING;
        databaseFormat: 'sqlite-schema-16';
        markerFormat: 'not-applicable';
        pathKeyEncoding: 'not-applicable';
        operationFormats: 'a-only-v1';
        planVersion: '1';
        journalVersion: '1';
    }>;
    planDigest: string;
}>;

export type SessionControlRecord = Readonly<{
    schema: typeof SESSION_SCHEMA;
    operationId: string;
    restoreSessionId: string;
    sequence: string;
    previousRecordDigest: string | null;
    session: RestoreSessionView;
    createdAt: string;
    recordDigest: string;
}>;

export type ActivationJournalRecord = Readonly<{
    schema: typeof JOURNAL_SCHEMA;
    operationId: string;
    sequence: string;
    kind: JournalKind;
    previousRecordDigest: string | null;
    planDigest: string;
    expectedFingerprints: unknown;
    observedFingerprints: unknown;
    createdAt: string;
    recordDigest: string;
}>;

export type RestoreActivationFailpoint = (point: string) => void;

export type RestoreActivationOptions = Readonly<{
    clock?: Readonly<{now(): string}>;
    failpoint?: RestoreActivationFailpoint;
    files?: RestoreActivationFileOptions;
}>;

export type RestoreBootState = Readonly<{
    kind: 'clear' | 'pre-checkpoint-session' | 'recovery-required' | 'committed';
    session: RestoreSessionView | null;
    terminal: RestoreTerminalEvidence | null;
}>;

export type RestoreTerminalEvidence = Readonly<{
    operationId: string;
    outcome: 'succeeded' | 'rolled-back';
    terminalRecordDigest: string;
    receiptDigest: string;
}>;

export type RestoreActivationResult = Readonly<{
    session: RestoreSessionView;
    store: SqliteDataStore;
    terminal: RestoreTerminalEvidence;
}>;

export type BeginRestoreActivationInput = Readonly<{
    store: SqliteDataStore;
    activityControlRoot: string;
    dataSlotsRoot: string;
    preparedDatabasePath: string;
    session: RestoreSessionView;
    candidateRootDigest: string;
    candidateDatabaseDigest: string;
    safetyRootDigest: string;
    previousTerminal: RestoreTerminalEvidence | null;
    command: RestoreSessionActionCommand;
}>;

export class RestoreActivationError extends Error {
    public constructor(
        public readonly code:
            | 'staging-failed'
            | 'activation-pending'
            | 'rollback-required'
            | 'conflict',
        public readonly checkpointReached: boolean,
        cause?: unknown,
    ) {
        super(code, {cause});
        this.name = 'RestoreActivationError';
    }
}
