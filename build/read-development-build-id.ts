import { execFileSync } from 'node:child_process';

function runGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function readDevelopmentBuildId(): string {
  const commit = runGit(['rev-parse', 'HEAD']);

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('git rev-parse HEAD did not return a 40-character lowercase commit hash.');
  }

  return `development:${commit}${runGit(['status', '--porcelain']) ? ':dirty' : ''}`;
}
