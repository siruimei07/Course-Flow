/**
 * @file Owns the bounded V1 snapshot manifest encoder and format ceilings.
 */

import { createHash } from 'node:crypto';

import { canonicalJson } from '../shared/canonical-json';
import { isCanonicalInstant } from '../shared/meeting-time';
import {
    isCanonicalUnsignedSqliteInteger,
    isCanonicalUuid,
} from '../shared/workspace-data-contract';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type SnapshotFormatLimitFacts = Readonly<{
    manifestBytes: bigint;
    libraryFileCount: bigint;
    memberCount: bigint;
    totalRawBytes: bigint;
    pathKeyComponents: bigint;
    pathKeyBytes: bigint;
    stringBytes: bigint;
}>;

export type SnapshotManifestV1Input = Readonly<{
    snapshotId: string;
    backupSetId: string;
    backupSequence: string;
    createdAt: string;
    workspaceId: string;
    database: Readonly<{
        applicationId: string;
        schemaLevel: string;
        actualRevision: string;
        memberPath: 'workspace.sqlite';
    }>;
    modules: readonly Readonly<{
        moduleId: string;
        formatVersion: string;
    }>[];
    library: Readonly<{ state: 'absent' }>;
    members: readonly Readonly<{
        path: 'workspace.sqlite';
        role: 'database';
        byteLength: string;
        sha256: string;
    }>[];
}>;

export type ValidatedSnapshotManifestV1 = Readonly<{
    input: SnapshotManifestV1Input;
    rootDigest: string;
}>;

/**
 * Reports that snapshot bytes are not an exact canonical V1 manifest.
 */
export class SnapshotValidationError extends Error {
    /**
     * Creates the deliberately opaque hostile-input validation failure.
     */
    public constructor() {
        super('Snapshot validation failed');
        this.name = 'SnapshotValidationError';
    }
}

/**
 * Reports which inclusive V1 trust boundary was exceeded.
 */
export class SnapshotFormatLimitError extends Error {
    /**
     * Creates a stable format-limit failure.
     *
     * @param {keyof SnapshotFormatLimitFacts} field - Rejected V1 limit field.
     */
    public constructor(public readonly field: keyof SnapshotFormatLimitFacts) {
        super(field);
        this.name = 'SnapshotFormatLimitError';
    }
}

/**
 * Enforces all inclusive SnapshotFormatLimitsV1 ceilings without numeric narrowing.
 *
 * @param {SnapshotFormatLimitFacts} facts - Independently observed format counts and sizes.
 * @return {void}
 */
export function assertSnapshotFormatLimitsV1(facts: SnapshotFormatLimitFacts): void {
    const limits: SnapshotFormatLimitFacts = {
        manifestBytes: 67_108_864n,
        libraryFileCount: 100_000n,
        memberCount: 100_002n,
        totalRawBytes: 1_099_511_627_776n,
        pathKeyComponents: 128n,
        pathKeyBytes: 32_768n,
        stringBytes: 32_768n,
    };
    for (const field of Object.keys(limits) as Array<keyof SnapshotFormatLimitFacts>) {
        if (typeof facts[field] !== 'bigint'
            || facts[field] < 0n
            || facts[field] > limits[field]) {
            throw new SnapshotFormatLimitError(field);
        }
    }
}

/**
 * Orders canonical identifiers by their UTF-8 bytes.
 * @param {string} first - Left identifier.
 * @param {string} second - Right identifier.
 * @return {number} Buffer comparison result.
 */
function compareUtf8(first: string, second: string): number {
    return Buffer.compare(Buffer.from(first, 'utf8'), Buffer.from(second, 'utf8'));
}

/**
 * Rejects noncanonical or internally inconsistent manifest inputs.
 * @param {SnapshotManifestV1Input} input - Candidate trusted-side manifest facts.
 * @return {void}
 */
function requireManifestInput(input: SnapshotManifestV1Input): void {
    if (!isCanonicalUuid(input.snapshotId)
        || !isCanonicalUuid(input.backupSetId)
        || !isCanonicalUuid(input.workspaceId)
        || !isCanonicalUnsignedSqliteInteger(input.backupSequence)
        || !isCanonicalInstant(input.createdAt)
        || !isCanonicalUnsignedSqliteInteger(input.database.applicationId)
        || !isCanonicalUnsignedSqliteInteger(input.database.schemaLevel)
        || !isCanonicalUnsignedSqliteInteger(input.database.actualRevision)
        || input.database.memberPath !== 'workspace.sqlite'
        || input.library.state !== 'absent'
        || input.members.length !== 1
        || input.members[0]?.path !== 'workspace.sqlite'
        || input.members[0].role !== 'database'
        || !isCanonicalUnsignedSqliteInteger(input.members[0].byteLength)
        || !SHA256_PATTERN.test(input.members[0].sha256)) {
        throw new TypeError('Snapshot manifest input is invalid');
    }
    const moduleIds = new Set<string>();
    for (const module of input.modules) {
        if (!/^MOD-[A-Z]+$/.test(module.moduleId)
            || !isCanonicalUnsignedSqliteInteger(module.formatVersion)
            || moduleIds.has(module.moduleId)) {
            throw new TypeError('Snapshot module declaration is invalid');
        }
        moduleIds.add(module.moduleId);
    }
}

/**
 * Encodes one Library-absent V1 snapshot manifest with its self-excluding root digest.
 *
 * @param {SnapshotManifestV1Input} input - Validated snapshot identity and measured member facts.
 * @return {Buffer} Canonical manifest bytes without BOM or whitespace.
 */
export function createSnapshotManifestV1(input: SnapshotManifestV1Input): Buffer {
    requireManifestInput(input);
    const members = Array.from(input.members).sort((first, second) => compareUtf8(first.path, second.path));
    const modules = Array.from(input.modules).sort(
        (first, second) => compareUtf8(first.moduleId, second.moduleId),
    );
    const totalRawBytes = members.reduce(
        (total, member) => total + BigInt(member.byteLength),
        0n,
    );
    const manifestWithoutDigestValue = {
        schema: 'courseflow-snapshot-manifest-v1',
        snapshotFormatVersion: '1',
        manifestFormatVersion: '1',
        manifestEncoding: 'courseflow-canonical-json-v1',
        limitsVersion: 'snapshot-format-limits-v1',
        snapshotId: input.snapshotId,
        backupSetId: input.backupSetId,
        backupSequence: input.backupSequence,
        createdAt: input.createdAt,
        workspaceId: input.workspaceId,
        database: input.database,
        modules,
        library: input.library,
        members,
        totals: {
            memberCount: members.length.toString(),
            libraryFileCount: '0',
            rawBytes: totalRawBytes.toString(),
        },
        digest: {
            algorithm: 'sha-256',
            encoding: 'lowercase-hex',
        },
    };
    const rootDigest = createHash('sha256')
        .update(canonicalJson(manifestWithoutDigestValue), 'utf8')
        .digest('hex');
    const bytes = Buffer.from(canonicalJson({
        ...manifestWithoutDigestValue,
        digest: {
            ...manifestWithoutDigestValue.digest,
            value: rootDigest,
        },
    }), 'utf8');
    assertSnapshotFormatLimitsV1({
        manifestBytes: BigInt(bytes.byteLength),
        libraryFileCount: 0n,
        memberCount: BigInt(members.length),
        totalRawBytes,
        pathKeyComponents: 0n,
        pathKeyBytes: 0n,
        stringBytes: BigInt(Math.max(...collectStringByteLengths(manifestWithoutDigestValue))),
    });
    return bytes;
}

/**
 * Collects UTF-8 byte lengths for every JSON string and property name.
 * @param {unknown} value - JSON-compatible manifest fragment.
 * @return {number[]} Observed byte lengths.
 */
function collectStringByteLengths(value: unknown): number[] {
    if (typeof value === 'string') {
        return [Buffer.byteLength(value, 'utf8')];
    }
    if (Array.isArray(value)) {
        return value.flatMap(collectStringByteLengths);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).flatMap(([key, item]) => [
            Buffer.byteLength(key, 'utf8'),
            ...collectStringByteLengths(item),
        ]);
    }
    return [0];
}

/**
 * Narrows one parsed JSON value to a non-array object.
 * @param {unknown} value - Parsed JSON value.
 * @return {boolean} Whether the value is a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks that a parsed object has exactly the allowed own enumerable keys.
 * @param {Record<string, unknown>} value - Candidate object.
 * @param {readonly string[]} keys - Required key set.
 * @return {boolean} Whether the key sets match.
 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Array.from(keys).sort());
}

/**
 * Parses exact V1 fields and regenerates their trusted canonical representation.
 * @param {unknown} value - Untrusted parsed manifest value.
 * @return {ValidatedSnapshotManifestV1} Validated manifest facts.
 */
function parseManifestInput(value: unknown): ValidatedSnapshotManifestV1 {
    if (!isRecord(value)
        || !hasExactKeys(value, [
            'schema',
            'snapshotFormatVersion',
            'manifestFormatVersion',
            'manifestEncoding',
            'limitsVersion',
            'snapshotId',
            'backupSetId',
            'backupSequence',
            'createdAt',
            'workspaceId',
            'database',
            'modules',
            'library',
            'members',
            'totals',
            'digest',
        ])
        || value.schema !== 'courseflow-snapshot-manifest-v1'
        || value.snapshotFormatVersion !== '1'
        || value.manifestFormatVersion !== '1'
        || value.manifestEncoding !== 'courseflow-canonical-json-v1'
        || value.limitsVersion !== 'snapshot-format-limits-v1'
        || typeof value.snapshotId !== 'string'
        || typeof value.backupSetId !== 'string'
        || typeof value.backupSequence !== 'string'
        || typeof value.createdAt !== 'string'
        || typeof value.workspaceId !== 'string'
        || !isRecord(value.database)
        || !hasExactKeys(value.database, [
            'applicationId',
            'schemaLevel',
            'actualRevision',
            'memberPath',
        ])
        || typeof value.database.applicationId !== 'string'
        || typeof value.database.schemaLevel !== 'string'
        || typeof value.database.actualRevision !== 'string'
        || value.database.memberPath !== 'workspace.sqlite'
        || !Array.isArray(value.modules)
        || !value.modules.every(module => isRecord(module)
            && hasExactKeys(module, ['moduleId', 'formatVersion'])
            && typeof module.moduleId === 'string'
            && typeof module.formatVersion === 'string')
        || !isRecord(value.library)
        || !hasExactKeys(value.library, ['state'])
        || value.library.state !== 'absent'
        || !Array.isArray(value.members)
        || value.members.length !== 1
        || !isRecord(value.members[0])
        || !hasExactKeys(value.members[0], ['path', 'role', 'byteLength', 'sha256'])
        || value.members[0].path !== 'workspace.sqlite'
        || value.members[0].role !== 'database'
        || typeof value.members[0].byteLength !== 'string'
        || typeof value.members[0].sha256 !== 'string'
        || !isRecord(value.totals)
        || !hasExactKeys(value.totals, ['memberCount', 'libraryFileCount', 'rawBytes'])
        || typeof value.totals.memberCount !== 'string'
        || typeof value.totals.libraryFileCount !== 'string'
        || typeof value.totals.rawBytes !== 'string'
        || !isRecord(value.digest)
        || !hasExactKeys(value.digest, ['algorithm', 'encoding', 'value'])
        || value.digest.algorithm !== 'sha-256'
        || value.digest.encoding !== 'lowercase-hex'
        || typeof value.digest.value !== 'string') {
        throw new SnapshotValidationError();
    }
    const input: SnapshotManifestV1Input = {
        snapshotId: value.snapshotId,
        backupSetId: value.backupSetId,
        backupSequence: value.backupSequence,
        createdAt: value.createdAt,
        workspaceId: value.workspaceId,
        database: {
            applicationId: value.database.applicationId,
            schemaLevel: value.database.schemaLevel,
            actualRevision: value.database.actualRevision,
            memberPath: value.database.memberPath,
        },
        modules: value.modules.map(module => ({
            moduleId: module.moduleId as string,
            formatVersion: module.formatVersion as string,
        })),
        library: {state: 'absent'},
        members: [{
            path: value.members[0].path,
            role: value.members[0].role,
            byteLength: value.members[0].byteLength,
            sha256: value.members[0].sha256,
        }],
    };
    let expected: Buffer;
    try {
        expected = createSnapshotManifestV1(input);
    }
    catch {
        throw new SnapshotValidationError();
    }
    if (value.totals.memberCount !== '1'
        || value.totals.libraryFileCount !== '0'
        || value.totals.rawBytes !== input.members[0].byteLength
        || value.digest.value !== JSON.parse(expected.toString('utf8')).digest.value) {
        throw new SnapshotValidationError();
    }
    return Object.freeze({input, rootDigest: value.digest.value});
}

/**
 * Validates exact canonical bytes, the self-excluding digest, and all V1 manifest limits.
 * @param {Buffer} bytes - Fresh bounded manifest bytes.
 * @return {ValidatedSnapshotManifestV1} Trusted manifest facts.
 */
export function validateSnapshotManifestV1(bytes: Buffer): ValidatedSnapshotManifestV1 {
    if (bytes.byteLength > 67_108_864) {
        throw new SnapshotValidationError();
    }
    try {
        const decoded = bytes.toString('utf8');
        const value = JSON.parse(decoded) as unknown;
        const validated = parseManifestInput(value);
        if (!Buffer.from(canonicalJson(value), 'utf8').equals(bytes)
            || !createSnapshotManifestV1(validated.input).equals(bytes)) {
            throw new SnapshotValidationError();
        }
        return validated;
    }
    catch (error) {
        if (error instanceof SnapshotValidationError) {
            throw error;
        }
        throw new SnapshotValidationError();
    }
}
