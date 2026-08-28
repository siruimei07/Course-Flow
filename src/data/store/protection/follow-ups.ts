import { DatabaseSync } from 'node:sqlite';
import { readReceiptOutcome } from '../context';
import type { StoreContext } from '../context';
import type { CommandReceiptOutcome, DurableFollowUp } from '../types';
export function receipt(ctx: StoreContext, commandId: string): CommandReceiptOutcome | null {
    ctx.requireOpen();
    return readReceiptOutcome(ctx.database, commandId);
}

export function readPendingFollowUps(ctx: StoreContext): readonly DurableFollowUp[] {
    ctx.requireOpen();
    const statement = ctx.database.prepare(`
            SELECT
                follow_up_id,
                originating_command_id,
                prerequisite_revision,
                follow_up_version
            FROM durable_followups
            WHERE state = 'pending'
            ORDER BY prerequisite_revision, follow_up_id
        `);
    statement.setReadBigInts(true);
    const rows = statement.all() as Array<{
        follow_up_id: string;
        originating_command_id: string;
        prerequisite_revision: bigint;
        follow_up_version: bigint;
    }>;
    return Object.freeze(rows.map(row => Object.freeze({
        followUpId: row.follow_up_id,
        originatingCommandId: row.originating_command_id,
        owner: 'protect' as const,
        kind: 'backup-needed-through' as const,
        prerequisiteRevision: row.prerequisite_revision.toString(),
        state: 'pending' as const,
        version: row.follow_up_version.toString() as '0',
    })));
}

export function readProtectionWatermark(ctx: StoreContext): string {
    return readProtectionWatermarks(ctx, ).neededThrough;
}

/**
 * Reads both durable backup watermarks from their singleton DATA owner.
 * @return {{neededThrough: string; succeededThrough: string}} Current watermark pair.
 */
export function readProtectionWatermarks(ctx: StoreContext): Readonly<{
    neededThrough: string;
    succeededThrough: string;
}> {
    ctx.requireOpen();
    const statement = ctx.database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
    statement.setReadBigInts(true);
    const row = statement.get() as {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    };
    return Object.freeze({
        neededThrough: row.backup_needed_through.toString(),
        succeededThrough: row.backup_succeeded_through.toString(),
    });
}

/**
 * Reads both protection watermarks inside the caller-owned DATA transaction.
 * @return {object} Authoritative needed and succeeded revisions.
 */
export function readProtectionWatermarksInsideTransaction(database: DatabaseSync): {
    backup_needed_through: bigint;
    backup_succeeded_through: bigint;
} {
    const statement = database.prepare(`
            SELECT backup_needed_through, backup_succeeded_through
            FROM protection_watermarks
            WHERE singleton = 1
        `);
    statement.setReadBigInts(true);
    return statement.get() as {
        backup_needed_through: bigint;
        backup_succeeded_through: bigint;
    };
}
