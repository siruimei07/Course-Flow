/**
 * @file WP-RF-02: proves the per-surface split of styles.css is still, byte for byte, the single
 * stylesheet that shipped before it.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
    readRendererStyleFiles,
    readRendererStyles,
    rendererStyleImports,
    rendererStylesDirectory,
    rendererStylesEntryPath,
} from './renderer-styles.fixture';

/**
 * The baseline is a frozen copy rather than `git show <commit>:src/renderer/styles.css`. The
 * repository is checked out with core.autocrlf, so the blob is LF while both this fixture and the
 * split files arrive CRLF, and a blob read would compare two different encodings of the same text.
 * A committed file also keeps the suite hermetic: no child process, no git binary, no pinned hash
 * that a later rebase invalidates.
 */
const BASELINE = 'tests/fixtures/styles-before-split.css';

/**
 * The partition, not just the concatenated stream. Byte equality alone cannot see a rule drifting
 * from the tail of one file into the head of the next, which is the drift the split exists to stop.
 */
const PARTITION: ReadonlyArray<readonly [string, number]> = [
    ['./styles/tokens.css', 155],
    ['./styles/shell.css', 394],
    ['./styles/today.css', 1058],
    ['./styles/tasks.css', 270],
    ['./styles/term-ended.css', 17],
    ['./styles/components.css', 240],
    ['./styles/courses.css', 191],
    ['./styles/dialog-facts.css', 33],
    ['./styles/calendar.css', 297],
    ['./styles/files.css', 11],
    ['./styles/startup.css', 35],
    ['./styles/setup.css', 482],
    ['./styles/settings.css', 131],
    ['./styles/management.css', 95],
    ['./styles/calendar-controls.css', 89],
    ['./styles/settings-lists.css', 10],
    ['./styles/focus.css', 33],
    ['./styles/motion.css', 66],
    ['./styles/migration.css', 282],
    ['./styles/media.css', 566],
];

test('WP-RF-02 styles.css is nothing but the ordered import list', () => {
    const entry = readFileSync(rendererStylesEntryPath(), 'utf8');
    assert.doesNotMatch(entry, /[{}]/);
    assert.deepEqual(
        rendererStyleImports(),
        PARTITION.map(([importPath]) => importPath),
    );
});

test('WP-RF-02 every stylesheet under styles/ is imported exactly once and imports nothing', () => {
    const onDisk = readdirSync(rendererStylesDirectory()).sort();
    const imported = rendererStyleImports().map((importPath) => path.basename(importPath));
    assert.deepEqual(onDisk, [...imported].sort());
    assert.equal(new Set(imported).size, imported.length);
    // A nested import would be hoisted above every rule, which no boundary in the partition expects.
    for (const file of readRendererStyleFiles()) {
        assert.doesNotMatch(file.payload, /@import/, `${file.importPath} imports another file`);
    }
});

test('WP-RF-02 every split file opens with a comment naming its scope', () => {
    for (const file of readRendererStyleFiles()) {
        assert.match(file.header, /^\/\*[\s\S]+\*\/\r?\n$/, file.importPath);
        assert.ok(file.header.length > 40, `${file.importPath} says too little about its scope`);
    }
});

test('WP-RF-02 the split keeps the boundaries it was cut on', () => {
    const measured = readRendererStyleFiles().map((file) => {
        const lines = file.payload.split('\r\n');
        assert.equal(lines.pop(), '', `${file.importPath} does not end with a line break`);
        return [file.importPath, lines.length] as const;
    });
    assert.deepEqual(measured, PARTITION);
});

test('WP-RF-02 concatenating the imports reproduces the pre-split stylesheet byte for byte', () => {
    const rebuilt = Buffer.from(readRendererStyles(), 'utf8');
    const baseline = readFileSync(path.join(process.cwd(), BASELINE));
    if (Buffer.compare(rebuilt, baseline) !== 0) {
        const at = rebuilt.findIndex((byte, index) => byte !== baseline[index]);
        assert.fail(
            `the imported files no longer rebuild ${BASELINE}: `
                + `${rebuilt.length} bytes against ${baseline.length}, first difference at ${at}`,
        );
    }
});
