import type { BootstrapOutcome } from '../shared/bootstrap-contract';

declare global {
  interface Window {
    courseFlow: Readonly<{
      query(): Promise<BootstrapOutcome>;
    }>;
  }
}

export {};
