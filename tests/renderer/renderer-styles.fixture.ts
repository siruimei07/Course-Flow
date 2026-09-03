/**
 * @file Reads the Renderer stylesheet the way the browser does. Since WP-RF-02 styles.css is only an
 * ordered import list, so a test that asserts on CSS text has to concatenate the imported files in
 * that order: the import order is the cascade order.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ENTRY = 'src/renderer/styles.css';
const IMPORT_STATEMENT = /^@import '(\.\/styles\/[a-z-]+\.css)';$/;
const COMMENT = /\/\*[\s\S]*?\*\//g;

export interface RendererStyleFile {
    /** The specifier as written in `styles.css`, which is also the cascade position. */
    readonly importPath: string;
    /** The scope comment the file opens with, up to and including its line break. */
    readonly header: string;
    /** Everything after the scope comment: the slice of the stylesheet this file owns. */
    readonly payload: string;
}

export function rendererStylesEntryPath(): string {
    return path.join(process.cwd(), ENTRY);
}

export function rendererStylesDirectory(): string {
    return path.join(process.cwd(), 'src/renderer/styles');
}

/**
 * Reading the entry also proves its one precondition: it carries nothing but comments and imports.
 * A rule left behind here would take a cascade position no split file could account for.
 */
export function rendererStyleImports(): string[] {
    const entry = readFileSync(rendererStylesEntryPath(), 'utf8');
    const imports: string[] = [];
    for (const line of entry.replace(COMMENT, '').split(/\r?\n/)) {
        if (line.trim() === '') {
            continue;
        }
        const match = IMPORT_STATEMENT.exec(line);
        if (match === null) {
            throw new Error(`${ENTRY} holds something other than an import: ${line}`);
        }
        imports.push(match[1]);
    }
    return imports;
}

export function readRendererStyleFiles(): RendererStyleFile[] {
    const directory = path.dirname(rendererStylesEntryPath());
    return rendererStyleImports().map((importPath) => {
        const content = readFileSync(path.join(directory, importPath), 'utf8');
        if (!content.startsWith('/*')) {
            throw new Error(`${importPath} does not open with a comment naming its scope`);
        }
        const closed = content.indexOf('*/');
        const lineEnd = content.indexOf('\n', closed);
        if (closed < 0 || lineEnd < 0) {
            throw new Error(`${importPath} does not close its scope comment on a line of its own`);
        }
        if (content.slice(closed + 2, lineEnd).trim() !== '') {
            throw new Error(`${importPath} puts CSS after its scope comment, on the same line`);
        }
        return {
            importPath,
            header: content.slice(0, lineEnd + 1),
            payload: content.slice(lineEnd + 1),
        };
    });
}

/** The whole Renderer stylesheet, in cascade order, with every scope comment removed. */
export function readRendererStyles(): string {
    return readRendererStyleFiles()
        .map((file) => file.payload)
        .join('');
}
