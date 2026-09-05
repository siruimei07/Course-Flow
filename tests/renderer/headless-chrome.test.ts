/**
 * @file Exercises port-file sharing errors through the real browser launcher.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {evaluateAtWidths, skipWithoutBrowser} from './headless-chrome.fixture';

for (const code of ['EBUSY', 'EACCES']) {
    test(`the browser launcher retries only a transient EBUSY port read (${code})`, {
        skip: skipWithoutBrowser,
    }, async context => {
        const read = fs.readFileSync;
        const failure = Object.assign(new Error(`port-file read failed: ${code}`), {code});
        let portReads = 0;
        context.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
            if (String(args[0]).endsWith('DevToolsActivePort')) {
                portReads += 1;
                if (portReads === 1) {
                    throw failure;
                }
            }
            return read(...args);
        });

        const measuring = evaluateAtWidths<number>('<!doctype html><title>port read</title>', [800], 'innerWidth');
        if (code === 'EBUSY') {
            assert.equal((await measuring).get(800), 800);
            assert.ok(portReads >= 2, 'retry the locked file and still measure the real page');
        } else {
            await assert.rejects(measuring, error => error === failure);
            assert.equal(portReads, 1, 'other file errors must fail immediately');
        }
    });
}
