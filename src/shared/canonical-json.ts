export type CanonicalValue =
    | null
    | boolean
    | string
    | number
    | readonly CanonicalValue[]
    | Readonly<{ [key: string]: CanonicalValue }>;

function reject(message: string): never {
    throw new TypeError(message);
}

function assertCanonicalString(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
                reject('Lone surrogate is not canonical');
            }
            index += 1;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            reject('Lone surrogate is not canonical');
        }
    }
}

function isPlainObject(value: object): boolean {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalize(value: unknown, active: WeakSet<object>): CanonicalValue {
    if (value === null) {
        return null;
    }

    switch (typeof value) {
        case 'boolean':
            return value;

        case 'string':
            assertCanonicalString(value);
            return value;

        case 'number':
            if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
                reject('Only safe integers other than -0 are canonical');
            }
            return value;

        case 'object':
            break;

        default:
            reject('Value is not canonical');
    }

    if (active.has(value)) {
        reject('Cycles are not canonical');
    }
    active.add(value);

    try {
        if (Array.isArray(value)) {
            const descriptors = Object.getOwnPropertyDescriptors(value);
            for (const key of Reflect.ownKeys(descriptors)) {
                if (typeof key === 'symbol') {
                    reject('Symbols are not canonical');
                }

                const descriptor = descriptors[key];
                if (key === 'length') {
                    if ('get' in descriptor || 'set' in descriptor || descriptor.enumerable) {
                        reject('Array length descriptor is not canonical');
                    }
                    continue;
                }

                if (!('value' in descriptor) || !descriptor.enumerable) {
                    reject('Array property descriptor is not canonical');
                }
            }

            const result: CanonicalValue[] = [];
            for (let index = 0; index < value.length; index += 1) {
                if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
                    reject('Sparse arrays are not canonical');
                }
                result.push(normalize(value[index], active));
            }

            if (Object.keys(value).length !== value.length) {
                reject('Array properties are not canonical');
            }
            return result;
        }

        if (!isPlainObject(value)) {
            reject('Only plain objects are canonical');
        }

        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        if (keys.some((key) => typeof key === 'symbol')) {
            reject('Symbols are not canonical');
        }

        const sortedKeys = (keys as string[]).sort();
        const result: { [key: string]: CanonicalValue } = Object.create(null) as {
            [key: string]: CanonicalValue;
        };
        for (const key of sortedKeys) {
            const descriptor = descriptors[key];
            if (!('value' in descriptor) || !descriptor.enumerable) {
                reject('Object property descriptor is not canonical');
            }
            assertCanonicalString(key);
            result[key] = normalize(descriptor.value, active);
        }
        return result;
    } finally {
        active.delete(value);
    }
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value, new WeakSet<object>()));
}
