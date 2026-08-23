const minimumVersion = [3n, 37n, 0n] as const;
const versionPattern = /^\d+\.\d+\.\d+$/;

export function isSupportedSqliteVersion(version: string): boolean {
  if (!versionPattern.test(version)) {
    return false;
  }

  const segments = version.split('.').map((segment) => BigInt(segment));
  for (let index = 0; index < minimumVersion.length; index += 1) {
    const segment = segments[index]!;
    const minimum = minimumVersion[index]!;
    if (segment !== minimum) {
      return segment > minimum;
    }
  }

  return true;
}
