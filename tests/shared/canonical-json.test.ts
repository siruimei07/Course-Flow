import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJson } from '../../src/shared/canonical-json';

test('canonicalJson sorts object keys while preserving arrays and null presence', () => {
    const cases: Array<{ value: unknown; expected: string }> = [
        { value: { z: 1, a: 2 }, expected: '{"a":2,"z":1}' },
        { value: { '\uE000': 'private', '\uD834\uDD1E': 'musical' }, expected: '{"𝄞":"musical","":"private"}' },
        { value: [2, 1, { b: true, a: false }], expected: '[2,1,{"a":false,"b":true}]' },
        { value: { absent: {}, present: null }, expected: '{"absent":{},"present":null}' },
    ];

    for (const { value, expected } of cases) {
        assert.equal(canonicalJson(value), expected);
    }
});

test('canonicalJson rejects values outside the canonical value domain', () => {
    class Example {
        value = 1;
    }

    const accessor = {} as { value: number };
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    const rejected: unknown[] = [
        undefined,
        [, 1],
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
        '\uD800',
        { '\uD800': 1 },
        new Date('2020-01-01T00:00:00.000Z'),
        new Map([['key', 'value']]),
        new Example(),
        accessor,
        cyclic,
        { value: Symbol('value') },
    ];

    for (const value of rejected) {
        assert.throws(() => canonicalJson(value), TypeError);
    }
});
