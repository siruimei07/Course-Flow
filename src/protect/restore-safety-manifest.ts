/**
 * @file Owns the canonical DATA-only RestoreSafetySet V1 manifest for the A-only slice.
 */

import {createHash} from 'node:crypto';

import {canonicalJson} from '../shared/canonical-json';
import {isCanonicalInstant} from '../shared/meeting-time';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_MANIFEST_BYTES = 67_108_864;

export type RestoreSafetyManifestV1Input = Readonly<{
    safetySetId: string;
    restoreSessionId: string;
    operationId: string;
    createdAt: string;
    workspaceId: string;
    protectedRevision: string;
    database: Readonly<{
        memberPath: 'workspace.sqlite';
        applicationId: string;
        schemaLevel: string;
        byteLength: string;
        sha256: string;
    }>;
    library: Readonly<{state: 'absent'}>;
}>;

export type ValidatedRestoreSafetyManifestV1 = Readonly<{
    input: RestoreSafetyManifestV1Input;
    rootDigest: string;
}>;

export class RestoreSafetyValidationError extends Error {
    public constructor() {
        super('Restore safety set validation failed');
        this.name = 'RestoreSafetyValidationError';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return JSON.stringify(Object.keys(value).sort())
        === JSON.stringify(Array.from(keys).sort());
}

function requireInput(input: RestoreSafetyManifestV1Input): void {
    if (!isCanonicalUuid(input.safetySetId)
        || !isCanonicalUuid(input.restoreSessionId)
        || !isCanonicalUuid(input.operationId)
        || !isCanonicalInstant(input.createdAt)
        || !isCanonicalUuid(input.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(input.protectedRevision)
        || input.database.memberPath !== 'workspace.sqlite'
        || !isCanonicalUnsignedSqliteInteger(input.database.applicationId)
        || !isCanonicalUnsignedSqliteInteger(input.database.schemaLevel)
        || input.database.schemaLevel === '0'
        || !isCanonicalUnsignedSqliteInteger(input.database.byteLength)
        || !SHA256_PATTERN.test(input.database.sha256)
        || input.library.state !== 'absent') {
        throw new TypeError('Restore safety manifest input is invalid');
    }
}

/**
 * Creates one self-excluding canonical safety-set manifest.
 * @param {RestoreSafetyManifestV1Input} input - Trusted measured safety facts.
 * @return {Buffer} Canonical UTF-8 bytes.
 */
export function createRestoreSafetyManifestV1(
    input: RestoreSafetyManifestV1Input,
): Buffer {
    requireInput(input);
    const withoutDigest = {
        schema: 'courseflow-restore-safety-set-v1',
        safetySetFormatVersion: '1',
        manifestFormatVersion: '1',
        manifestEncoding: 'courseflow-canonical-json-v1',
        limitsVersion: 'snapshot-format-limits-v1',
        safetySetId: input.safetySetId,
        restoreSessionId: input.restoreSessionId,
        operationId: input.operationId,
        createdAt: input.createdAt,
        workspace: {
            workspaceId: input.workspaceId,
            protectedRevision: input.protectedRevision,
        },
        database: {
            applicationId: input.database.applicationId,
            schemaLevel: input.database.schemaLevel,
        },
        library: input.library,
        members: [{
            path: input.database.memberPath,
            role: 'database',
            byteLength: input.database.byteLength,
            sha256: input.database.sha256,
        }],
        totals: {
            memberCount: '1',
            libraryFileCount: '0',
            rawBytes: input.database.byteLength,
        },
        digest: {
            algorithm: 'sha-256',
            encoding: 'lowercase-hex',
        },
    };
    const rootDigest = createHash('sha256')
        .update(canonicalJson(withoutDigest), 'utf8')
        .digest('hex');
    const bytes = Buffer.from(canonicalJson({
        ...withoutDigest,
        digest: {...withoutDigest.digest, value: rootDigest},
    }), 'utf8');
    if (bytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
        throw new TypeError('Restore safety manifest exceeds its format limit');
    }
    return bytes;
}

/**
 * Revalidates canonical bytes and returns the bound safety-set facts.
 * @param {Buffer} bytes - Fresh bounded manifest bytes.
 * @return {ValidatedRestoreSafetyManifestV1} Trusted manifest and root digest.
 */
export function validateRestoreSafetyManifestV1(
    bytes: Buffer,
): ValidatedRestoreSafetyManifestV1 {
    try {
        if (bytes.byteLength > MAXIMUM_MANIFEST_BYTES) {
            throw new RestoreSafetyValidationError();
        }
        const value = JSON.parse(bytes.toString('utf8')) as unknown;
        if (!isRecord(value)
            || !hasExactKeys(value, [
                'schema',
                'safetySetFormatVersion',
                'manifestFormatVersion',
                'manifestEncoding',
                'limitsVersion',
                'safetySetId',
                'restoreSessionId',
                'operationId',
                'createdAt',
                'workspace',
                'database',
                'library',
                'members',
                'totals',
                'digest',
            ])
            || value.schema !== 'courseflow-restore-safety-set-v1'
            || value.safetySetFormatVersion !== '1'
            || value.manifestFormatVersion !== '1'
            || value.manifestEncoding !== 'courseflow-canonical-json-v1'
            || value.limitsVersion !== 'snapshot-format-limits-v1'
            || typeof value.safetySetId !== 'string'
            || typeof value.restoreSessionId !== 'string'
            || typeof value.operationId !== 'string'
            || typeof value.createdAt !== 'string'
            || !isRecord(value.workspace)
            || !hasExactKeys(value.workspace, ['workspaceId', 'protectedRevision'])
            || typeof value.workspace.workspaceId !== 'string'
            || typeof value.workspace.protectedRevision !== 'string'
            || !isRecord(value.database)
            || !hasExactKeys(value.database, [
                'applicationId',
                'schemaLevel',
            ])
            || typeof value.database.applicationId !== 'string'
            || typeof value.database.schemaLevel !== 'string'
            || !isRecord(value.library)
            || !hasExactKeys(value.library, ['state'])
            || value.library.state !== 'absent'
            || !Array.isArray(value.members)
            || value.members.length !== 1
            || !isRecord(value.members[0])
            || !hasExactKeys(value.members[0], [
                'path',
                'role',
                'byteLength',
                'sha256',
            ])
            || value.members[0].path !== 'workspace.sqlite'
            || value.members[0].role !== 'database'
            || typeof value.members[0].byteLength !== 'string'
            || typeof value.members[0].sha256 !== 'string'
            || !isRecord(value.totals)
            || !hasExactKeys(value.totals, [
                'memberCount',
                'libraryFileCount',
                'rawBytes',
            ])
            || value.totals.memberCount !== '1'
            || value.totals.libraryFileCount !== '0'
            || value.totals.rawBytes !== value.members[0].byteLength
            || !isRecord(value.digest)
            || !hasExactKeys(value.digest, ['algorithm', 'encoding', 'value'])
            || value.digest.algorithm !== 'sha-256'
            || value.digest.encoding !== 'lowercase-hex'
            || typeof value.digest.value !== 'string') {
            throw new RestoreSafetyValidationError();
        }
        const input: RestoreSafetyManifestV1Input = {
            safetySetId: value.safetySetId,
            restoreSessionId: value.restoreSessionId,
            operationId: value.operationId,
            createdAt: value.createdAt,
            workspaceId: value.workspace.workspaceId,
            protectedRevision: value.workspace.protectedRevision,
            database: {
                memberPath: 'workspace.sqlite',
                applicationId: value.database.applicationId,
                schemaLevel: value.database.schemaLevel,
                byteLength: value.members[0].byteLength,
                sha256: value.members[0].sha256,
            },
            library: {state: 'absent'},
        };
        const expected = createRestoreSafetyManifestV1(input);
        const rootDigest = (JSON.parse(expected.toString('utf8')) as {
            digest: {value: string};
        }).digest.value;
        if (!expected.equals(bytes) || value.digest.value !== rootDigest) {
            throw new RestoreSafetyValidationError();
        }
        return Object.freeze({input, rootDigest});
    }
    catch (error) {
        if (error instanceof RestoreSafetyValidationError) {
            throw error;
        }
        throw new RestoreSafetyValidationError();
    }
}
