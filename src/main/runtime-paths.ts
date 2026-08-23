import path from 'node:path';

export type DevelopmentRoots = Readonly<{
  activityControlRoot: string;
  dataSlotsRoot: string;
  chromiumRoot: string;
  dataRootClass: 'verified-local';
}>;

export type DevelopmentRootInput = Readonly<{
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  appData: string;
}>;

export function resolveDevelopmentRoots(input: DevelopmentRootInput): DevelopmentRoots {
  if (input.platform === 'win32') {
    if (
      !input.localAppData
      || !path.win32.isAbsolute(input.localAppData)
      || input.localAppData.startsWith('\\\\')
      || !/^[A-Za-z]:[\\/]$/.test(path.win32.parse(input.localAppData).root)
    ) {
      throw new Error('LOCALAPPDATA must be an absolute local path.');
    }

    return rootsFrom(path.win32, input.localAppData);
  }

  if (input.platform === 'darwin') {
    if (!path.posix.isAbsolute(input.appData)) {
      throw new Error('appData must be an absolute macOS path.');
    }

    return rootsFrom(path.posix, input.appData);
  }

  throw new Error(`Unsupported platform: ${input.platform}`);
}

function rootsFrom(platformPath: typeof path.win32, base: string): DevelopmentRoots {
  const developmentRoot = platformPath.join(base, 'CourseFlow Dev');
  return {
    activityControlRoot: platformPath.join(developmentRoot, 'ActivityControl'),
    dataSlotsRoot: platformPath.join(developmentRoot, 'DataSlots'),
    chromiumRoot: platformPath.join(developmentRoot, 'Chromium'),
    dataRootClass: 'verified-local',
  };
}
