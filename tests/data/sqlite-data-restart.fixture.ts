import { openWorkspaceData, type CommitFailpoint } from '../../src/data/sqlite-data-store';
import { normalizeRecordSetupDecisionCommand } from '../../src/shared/workspace-data-contract';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOLLOW_UP_ID = '22222222-2222-4222-8222-222222222222';

const dataSlotsRoot = process.argv[2];
const targetFailpoint = process.argv[3] as CommitFailpoint;
if (!dataSlotsRoot || !targetFailpoint || process.argv.length !== 4) {
    process.exit(64);
}

const command = normalizeRecordSetupDecisionCommand({
    commandId: COMMAND_ID,
    workspaceId: WORKSPACE_ID,
    intent: {
        kind: 'workspace.record-setup-decision',
        intentSchemaVersion: 1,
        payload: { decision: 'later' },
    },
    followUpId: FOLLOW_UP_ID,
    expectedRevision: '0',
    expectedSetupVersion: '0',
});

async function main(): Promise<void> {
    const opened = openWorkspaceData(dataSlotsRoot);
    if (opened.kind !== 'ready') {
        process.exit(65);
    }

    await opened.store.commit(command, {
        failpoint(point) {
            if (point === targetFailpoint) {
                process.exit(73);
            }
        },
    });
}

void main();
