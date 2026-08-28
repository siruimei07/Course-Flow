import type { DatabaseSync } from 'node:sqlite';
import type { CurrentVersions } from './guards';
import { committedOutcome, committedPairOutcome } from './results';
import type { CommandReceiptOutcome, ReceiptEffect, StoredRestoreCommandReceipt } from './types';

/**
 * Mutable-state port the store kernel hands to extracted read/commit units.
 */
export type StoreContext = Readonly<{
    database: DatabaseSync;
    workspaceId: string;
    revision(): bigint;
    setRevision(next: bigint): void;
    isReadOnly(): boolean;
    markReadOnly(): void;
    terminalError(): Error | undefined;
    enterTerminalState(error?: Error): Error;
    rollbackOrRequireReopen(): void;
}>;

export function currentVersions(database: DatabaseSync): CurrentVersions {
    const statement = database.prepare(`
            SELECT
                workspace_state.revision,
                setup_state.setup_decision_version,
                plan_state.plan_entity_version,
                backup_configuration.configuration_version
            FROM workspace_state
            JOIN setup_state ON setup_state.singleton = workspace_state.singleton
            JOIN plan_state ON plan_state.singleton = workspace_state.singleton
            JOIN backup_configuration ON backup_configuration.singleton = workspace_state.singleton
            WHERE workspace_state.singleton = 1
        `);
    statement.setReadBigInts(true);
    const row = statement.get() as {
        revision: bigint;
        setup_decision_version: bigint;
        plan_entity_version: bigint;
        configuration_version: bigint;
    };
    return {
        revision: row.revision,
        setupVersion: row.setup_decision_version,
        planVersion: row.plan_entity_version,
        protectionVersion: row.configuration_version,
    };
}

export function readReceiptOutcome(database: DatabaseSync, commandId: string): CommandReceiptOutcome | null {
    const receipt = database.prepare(`
            SELECT committed_revision
            FROM command_receipts
            WHERE command_id = ?
        `);
    receipt.setReadBigInts(true);
    const receiptRow = receipt.get(commandId) as { committed_revision: bigint } | undefined;
    if (!receiptRow) {
        return null;
    }

    const effects = database.prepare(`
            SELECT effect_code, entity_kind, entity_id, entity_version
            FROM receipt_effects
            WHERE command_id = ?
            ORDER BY effect_order
        `);
    effects.setReadBigInts(true);
    const effectRows = effects.all(commandId) as Array<{
        effect_code: ReceiptEffect['code'];
        entity_kind: ReceiptEffect['entity']['kind'];
        entity_id: string;
        entity_version: bigint;
    }>;
    const followUp = database.prepare(`
            SELECT follow_up_id
            FROM durable_followups
            WHERE originating_command_id = ?
            ORDER BY follow_up_id
        `).get(commandId) as { follow_up_id: string };
    const materializedEffects = effectRows.map((row) => Object.freeze({
        code: row.effect_code,
        entity: Object.freeze({
            kind: row.entity_kind,
            id: row.entity_id,
            version: row.entity_version.toString(),
        }),
    }));
    const undoRow = database.prepare(`
            SELECT undo_token, task_series_id, original_logical_anchor
            FROM task_state_history
            WHERE originating_command_id = ?
        `).get(commandId) as {
        undo_token: string;
        task_series_id: string;
        original_logical_anchor: string;
    } | undefined;
    const attachUndoCapability = (outcome: CommandReceiptOutcome): CommandReceiptOutcome => {
        if (!undoRow) {
            return outcome;
        }
        const taskEffect = materializedEffects.find(effect => (
            effect.entity.kind === 'task-series' && effect.entity.id === undoRow.task_series_id
        ));
        if (!taskEffect) {
            throw new Error('Stored Task Undo capability has no matching receipt effect');
        }
        return Object.freeze({
            ...outcome,
            undoCapability: Object.freeze({
                token: undoRow.undo_token,
                taskSeriesId: undoRow.task_series_id,
                originalLogicalAnchor: undoRow.original_logical_anchor,
                committedRevision: receiptRow.committed_revision.toString(),
                validThroughTaskSeriesVersion: taskEffect.entity.version,
            }),
        });
    };
    if (materializedEffects.length === 1) {
        const [effect] = materializedEffects;
        return attachUndoCapability(committedOutcome(
            receiptRow.committed_revision,
            effect!.code,
            effect!.entity.kind,
            effect!.entity.id,
            BigInt(effect!.entity.version),
            followUp.follow_up_id,
        ));
    }
    if (materializedEffects.length === 2) {
        return attachUndoCapability(committedPairOutcome(
            receiptRow.committed_revision,
            materializedEffects[0]!,
            materializedEffects[1]!,
            followUp.follow_up_id,
        ));
    }
    throw new Error('Stored receipt outcome has an invalid effect count');
}

/**
 * Advances the one-way setup milestone from current formal PLAN facts.
 * @return {void}
 */
export function advanceSetupMinimumMilestone(database: DatabaseSync): void {
    database.exec(`
            UPDATE setup_state
            SET ever_reached_minimum = 1
            WHERE singleton = 1
                AND ever_reached_minimum = 0
                AND EXISTS (
                    SELECT 1
                    FROM plan_state
                    JOIN courses ON courses.term_id = plan_state.current_term_id
                        AND courses.archived = 0
                    WHERE plan_state.singleton = 1
                        AND (
                            EXISTS (
                                SELECT 1
                                FROM meeting_series
                                WHERE meeting_series.course_id = courses.course_id
                                    AND meeting_series.retired = 0
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM task_series
                                WHERE task_series.course_id = courses.course_id
                                    AND task_series.retired = 0
                            )
                        )
                )
        `);
}

export function insertRestoreCommandReceipt(database: DatabaseSync, receipt: StoredRestoreCommandReceipt): void {
    database.prepare(`
            INSERT INTO restore_command_receipts (
                command_id,
                command_kind,
                payload_digest,
                restore_session_id,
                result_session_version
            ) VALUES (?, ?, ?, ?, ?)
        `).run(
        receipt.commandId,
        receipt.commandKind,
        Buffer.from(receipt.payloadDigest, 'hex'),
        receipt.restoreSessionId,
        BigInt(receipt.resultSessionVersion),
    );
}
