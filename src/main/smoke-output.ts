import { writeFileSync } from 'node:fs';

type SmokeWriter = (chunk: string) => void;

export function writeSmokeLine(chunk: string): void {
  writeFileSync(1, chunk, 'utf8');
}

export function createSmokeOutput(writer: SmokeWriter, onWritten: (code: number) => void) {
  let emitted = false;

  return (result: Readonly<Record<string, unknown>>, code: number): void => {
    if (emitted) {
      return;
    }

    emitted = true;
    try {
      writer(`${JSON.stringify(result)}\n`);
      onWritten(code);
    } catch {
      onWritten(1);
    }
  };
}
