import type { RestoreActivationFileOptions, RestoreDataSlotFingerprint } from '../../platform/restore-activation-files';
export const MIGRATION_ROLLBACK_DIRECTORY_NAME = 'migration-rollback';

export const JOURNAL_DIRECTORY_NAME = 'journal';

export const ACTIVE_SLOT_NAME = 'active';

export const RECORD_MAXIMUM_BYTES = 65_536;

export const TOTAL_RECORD_LIMIT = 256;

export const RECORD_SCHEMA = 'courseflow-migration-rollback-handoff-v1';

export const LIMITS_VERSION = 'migration-rollback-handoff-limits-v1';

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const TEMPORARY_PUBLICATION_NAME = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const MAXIMUM_JSON_DEPTH = 12;

export const MAXIMUM_JSON_STRING_LENGTH = 1_024;

export const RECORD_KINDS = Object.freeze([
    'planned',
    'intent-stage-safety',
    'observed-stage-safety',
    'prepared',
    'command-confirm',
    'intent-retire-current',
    'observed-retire-current',
    'armed',
    'intent-install-safety',
    'observed-install-safety',
    'awaiting-target-build',
    'command-continue',
    'completing',
    'succeeded',
    'command-cancel',
    'intent-quarantine-safety',
    'observed-quarantine-safety',
    'intent-restore-current',
    'observed-restore-current',
    'cancelling',
    'cancelled',
] as const);

export type RecordKind = typeof RECORD_KINDS[number];

export type BuildClassification = 'source' | 'target' | 'other';

export type AllowedAction = 'cancel-as-source' | 'continue-as-target';

export type NonterminalPhase =
    | 'planned'
    | 'prepared'
    | 'armed'
    | 'awaiting-target-build'
    | 'completing'
    | 'cancelling';

export type TerminalPhase = 'succeeded' | 'cancelled';

export type MigrationRollbackDataIdentity = Readonly<{
    workspaceId: string;
    schemaLevel: string;
    revision: string;
}>;

export type MigrationRollbackHandoffFacts = Readonly<{
    migrationRollbackSessionId: string;
    operationId: string;
    sourceAppBuildId: string;
    currentAppBuildId: string;
    targetAppBuildId: string;
    sourceReleaseVersion: string;
    currentReleaseVersion: string;
    targetReleaseVersion: string;
    previewDigest: string;
    confirmationDigest: string;
    safetyCopy: Readonly<{
        migrationSafetyCopyId: string;
        workspaceId: string;
        schemaLevel: string;
        revision: string;
        byteLength: string;
        digest: string;
    }>;
    currentData: Readonly<{
        workspaceId: string;
        schemaLevel: string;
        revision: string;
        byteLength: string;
        digest: string;
        slotFingerprint: string;
    }>;
}>;

export type MigrationRollbackCommand = Readonly<{
    action: 'confirm' | 'continue-as-target' | 'cancel-as-source';
    commandId: string;
    migrationRollbackSessionId: string;
    expectedSessionVersion: string;
    currentAppBuildId: string;
}>;

export type MigrationRollbackBaseCompletionCallbacks = Readonly<{
    reopen(expected: MigrationRollbackDataIdentity): Promise<void>;
    libraryReconcile(): Promise<void>;
    flow00(): Promise<void>;
}>;

export type MigrationRollbackTargetCompletionCallbacks =
    MigrationRollbackBaseCompletionCallbacks & Readonly<{
        consumeSafetyCopy(input: Readonly<{
            migrationSafetyCopyId: string;
            operationId: string;
        }>): Promise<void>;
    }>;

export type MigrationRollbackSafetyStagingPort = (
    input: Readonly<{
        migrationSafetyCopyId: string;
        candidateSlotName: string;
    }>,
) => RestoreDataSlotFingerprint;

export type MigrationRollbackHandoffOptions = Readonly<{
    failpoint?: (point: string) => void;
    files?: RestoreActivationFileOptions;
}>;

export type MigrationRollbackStatus = Readonly<{
    kind: 'maintenance' | 'recovery-required' | 'succeeded' | 'cancelled';
    migrationRollbackSessionId: string | null;
    operationId: string | null;
    sessionVersion: string | null;
    phase: NonterminalPhase | TerminalPhase | 'recovery-required' | null;
    currentBuild: BuildClassification | null;
    requiredBuilds: Readonly<{
        sourceAppBuildId: string;
        sourceReleaseVersion: string;
        targetAppBuildId: string;
        targetReleaseVersion: string;
    }> | null;
    allowedActions: readonly AllowedAction[];
    retryCommand: Readonly<{
        action: 'continue-as-target' | 'cancel-as-source';
        commandId: string;
        expectedSessionVersion: string;
    }> | null;
    outcome: TerminalPhase | null;
}>;

export type MigrationRollbackBootState = MigrationRollbackStatus | Readonly<{
    kind: 'clear';
    migrationRollbackSessionId: null;
    operationId: null;
    sessionVersion: null;
    phase: null;
    currentBuild: null;
    requiredBuilds: null;
    allowedActions: readonly [];
    retryCommand: null;
    outcome: null;
}>;

export type NonterminalMigrationRollbackInspection = Readonly<{
    kind: 'clear' | 'nonterminal' | 'recovery-required';
    migrationRollbackSessionId: string | null;
    operationId: string | null;
}>;

export class MigrationRollbackHandoffError extends Error {
    public constructor(
        public readonly code:
            | 'activation-pending'
            | 'completion-pending'
            | 'command-conflict'
            | 'build-mismatch'
            | 'recovery-required',
        cause?: unknown,
    ) {
        super(code, {cause});
        this.name = 'MigrationRollbackHandoffError';
    }
}

export type SlotState = Readonly<{
    kind: 'absent' | 'present';
    slotFingerprint: string | null;
}>;

export type PhysicalEvidence = Readonly<{
    active: SlotState;
    candidate: SlotState;
    rollback: SlotState;
    quarantine: SlotState;
}>;

export type CommandEvidence = Readonly<{
    action: MigrationRollbackCommand['action'];
    commandId: string;
    commandDigest: string;
    currentAppBuildId: string;
    expectedSessionVersion: string;
}>;

export type HandoffRecord = Readonly<{
    schema: typeof RECORD_SCHEMA;
    limitsVersion: typeof LIMITS_VERSION;
    handoff: MigrationRollbackHandoffFacts;
    sequence: string;
    kind: RecordKind;
    phase: NonterminalPhase | TerminalPhase;
    allowedActorAppBuildIds: readonly string[];
    previousRecordDigest: string | null;
    before: PhysicalEvidence | null;
    after: PhysicalEvidence | null;
    command: CommandEvidence | null;
    receiptDigest: string | null;
    recordDigest: string;
}>;
