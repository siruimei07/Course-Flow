import {
  isBootstrapOutcome,
  makeBootstrapProblem,
  type BootstrapOutcome,
  type BootstrapRequest,
  type WorkspaceProbeRequest,
} from '../shared/bootstrap-contract';

const responseTimeoutMilliseconds = 5_000;
const unavailableMessage = 'Workspace is unavailable. Please try again.';

type PendingQuery = {
  resolve: (outcome: BootstrapOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type WorkspaceUtilityProcess = {
  postMessage(message: unknown): void;
  kill(): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'error', listener: (...args: unknown[]) => void): unknown;
  on(event: 'exit', listener: () => void): unknown;
  off(event: 'message', listener: (message: unknown) => void): unknown;
  off(event: 'error', listener: (...args: unknown[]) => void): unknown;
  off(event: 'exit', listener: () => void): unknown;
};

export class WorkspaceSupervisor {
  private readonly pending = new Map<string, PendingQuery>();
  private disposed = false;
  private unavailable = false;

  constructor(
    private readonly appBuildId: string,
    private readonly child: WorkspaceUtilityProcess,
  ) {
    child.on('message', this.handleMessage);
    child.on('error', this.handleError);
    child.on('exit', this.handleExit);
  }

  query(request: BootstrapRequest, dataRootClass: WorkspaceProbeRequest['dataRootClass']): Promise<BootstrapOutcome> {
    if (this.unavailable) {
      return Promise.resolve(this.unavailableOutcome(request.requestId));
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => this.settle(request.requestId, this.unavailableOutcome(request.requestId)), responseTimeoutMilliseconds);
      this.pending.set(request.requestId, { resolve, timeout });

      try {
        this.child.postMessage({ ...request, dataRootClass } satisfies WorkspaceProbeRequest);
      } catch {
        this.settle(request.requestId, this.unavailableOutcome(request.requestId));
      }
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.unavailable = true;
    this.settleAll();
    this.child.off('message', this.handleMessage);
    this.child.off('error', this.handleError);
    this.child.off('exit', this.handleExit);
    this.child.kill();
  }

  private readonly handleMessage = (message: unknown): void => {
    const requestId = this.requestIdFrom(message);

    if (!requestId) {
      this.settleAll();
      return;
    }

    if (isBootstrapOutcome(message, this.appBuildId, requestId)) {
      this.settle(requestId, message);
      return;
    }

    this.settle(requestId, this.unavailableOutcome(requestId));
  };

  private readonly handleExit = (): void => {
    this.unavailable = true;
    this.settleAll();
  };

  private readonly handleError = (): void => {
    this.handleExit();
  };

  private requestIdFrom(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    const outcome = value as { value?: { requestId?: unknown }; problem?: { requestId?: unknown } };
    const requestId = outcome.value?.requestId ?? outcome.problem?.requestId;
    return typeof requestId === 'string' ? requestId : undefined;
  }

  private unavailableOutcome(requestId: string): BootstrapOutcome {
    return makeBootstrapProblem('workspace-unavailable', unavailableMessage, this.appBuildId, requestId);
  }

  private settle(requestId: string, outcome: BootstrapOutcome): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(outcome);
  }

  private settleAll(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.resolve(this.unavailableOutcome(requestId));
    }
    this.pending.clear();
  }
}
