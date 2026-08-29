/**
 * @file Enforces the physical module dependency direction of src/ (WP-RF-01).
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, 'src');

/**
 * Allowed compile-time dependencies between physical areas of src/.
 * Rows are importers; each may also import from itself. The Shell (renderer)
 * reaches the Workspace only over IPC, so it never appears as an importer of
 * workspace, data, protect, platform, or main.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = Object.freeze({
    shared: [],
    plan: ['shared'],
    platform: ['shared'],
    data: ['plan', 'platform', 'shared'],
    protect: ['data', 'plan', 'platform', 'shared'],
    workspace: ['data', 'plan', 'platform', 'protect', 'shared'],
    main: ['shared'],
    preload: ['shared'],
    renderer: ['shared'],
    'vite-env.d': [],
});

function walkSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return walkSourceFiles(entryPath);
        }
        return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
    });
}

function areaOf(relativePath: string): string {
    const [head] = relativePath.split('/');
    return head.replace(/\.tsx?$/, '');
}

test('every relative import stays inside the allowed module dependency direction', () => {
    const violations: string[] = [];
    for (const sourcePath of walkSourceFiles(sourceRoot)) {
        const relative = path.relative(sourceRoot, sourcePath).replaceAll('\\', '/');
        const importerArea = areaOf(relative);
        assert.ok(importerArea in ALLOWED, `unknown src area for ${relative}`);
        const text = readFileSync(sourcePath, 'utf8');
        for (const match of text.matchAll(/from\s+'([^']+)'/gu)) {
            const specifier = match[1];
            if (!specifier.startsWith('.')) {
                continue;
            }
            const resolved = path
                .relative(sourceRoot, path.resolve(path.dirname(sourcePath), specifier))
                .replaceAll('\\', '/');
            const importedArea = areaOf(resolved);
            if (importedArea === importerArea) {
                continue;
            }
            if (!(ALLOWED[importerArea] as readonly string[]).includes(importedArea)) {
                violations.push(`${relative} -> ${resolved}`);
            }
        }
    }
    assert.deepEqual(violations, []);
});
