# WP-R6-05 Workspace Lifecycle Implementation Plan

> **历史计划适用性：** 本文保留 WP-R6-05 实施设计与当时步骤；当前状态和待办以 [BACKLOG.md](../../roadmap/BACKLOG.md) 为准，执行、skill 路由与包内并行遵循 [AGENTS.md](../../../AGENTS.md)。当时会话的 inline 选择不约束后续任务；已满足的工作不重做。

**Goal:** Complete `WP-R6-05` by making one Workspace-owned startup projection decide the workspace mode, capabilities, module health, durable work, and welcome/setup/today/maintenance/recovery route after a unified pre-DATA PROTECT inspection.

**Architecture:** `MOD-PROTECT` adds one read-only `inspectBeforeWorkspaceOpen(AppBuildId)` composition over the existing Restore and MigrationRollback inspectors. `MOD-WORKSPACE` remains the sole lifecycle owner: it opens DATA only after that result, restores path-free operation/follow-up state, performs the existing auditable Term lifecycle reconciliation, computes a versioned lifecycle DTO, and only then wakes backup work. Renderer consumes the route through the existing Shell → preload → Main → single Workspace utility process boundary. Physical Restore/MigrationRollback actions remain reachable only through existing explicit user commands.

**Tech Stack:** Existing pinned Electron, React, TypeScript, Node test runner, SQLite runtime, and platform adapters. No dependency changes.

**Approved sources:** `MODULE_CONTRACTS.md` §5.2, §8.1, §9.2–9.4, `FLOW-00`, `TEST-WORKSPACE-003/004/005`, `TEST-FLOW-00-LIFECYCLE`; ADR-02/04/08/09/10; `UF-A-01`, `UF-A-02`, `UF-A-08`, `UF-A-09`.

**Scope guard:** Modify only the shared Workspace startup DTO, PROTECT startup composition, Workspace orchestration, Renderer route consumption, packaged-smoke cleanup root cause, target tests, and roadmap evidence. Preserve path-free DTOs, one utility process, current dependencies, and all existing data/restore/rollback owners. Do not implement `WP-GA-01`, R7, R11, R12, Library watcher/file operations, release download/install, production diagnostics, or speculative compatibility layers.

---

### Task 1: Version and validate the closed lifecycle DTO

**Files:**

- Modify: `src/shared/bootstrap-contract.ts`
- Create: `src/shared/workspace-lifecycle-contract.ts`
- Modify: `tests/shared/bootstrap-contract.test.ts`
- Create: `tests/shared/workspace-lifecycle-contract.test.ts`
- Modify only protocol fixtures that represent the current valid protocol under `tests/`

- [x] Add RED contract tests for exact `WorkspaceLifecycleProjection` keys and values: `mode`, `route`, nullable canonical `workspaceRevision`, fixed capability/module-health maps, path-free operation handles, and pending `DurableFollowUp` projections.
- [x] Assert unknown fields, noncanonical IDs/revisions, invalid state combinations, class/accessor values, and path-shaped extra fields are rejected.
- [x] Extend `BootstrapReady` with `workspaceLifecycle` and bump the exact protocol from 2 to 3; prove a v2 request/result no longer handshakes as current.
- [x] Implement only the closed TypeScript unions and validators required by those tests. Use canonical decimal strings/UUIDs already owned by shared validators; do not add a generic schema framework.
- [x] Run `pnpm test:compile`, then the two compiled shared-contract tests and confirm GREEN.

### Task 2: Compose PROTECT inspection before DATA and aggregate FLOW-00

**Files:**

- Create: `src/protect/workspace-startup.ts`
- Create: `src/workspace-lifecycle.ts`
- Modify: `src/workspace-application.ts`
- Create: `tests/workspace-lifecycle.test.ts`
- Modify: `tests/workspace-restore.test.ts`
- Modify: `tests/workspace-migration.test.ts`
- Modify: `tests/workspace-term-lifecycle.test.ts`

- [x] Add RED tests for `inspectBeforeWorkspaceOpen`: ordinary Restore preview/waiting-decision remains queryable, confirmed Restore and MigrationRollback produce maintenance, activation/evidence uncertainty produces recovery, and simultaneous/non-unique Restore + rollback evidence produces recovery with no invented action.
- [x] Add RED integration tests proving PROTECT classification precedes DATA open, startup never performs physical resume/rollback/cancel, and maintenance/recovery reject ordinary Workspace requests.
- [x] Add RED lifecycle tests for absent DATA → welcome; incomplete setup/restart → setup; `everReachedMinimum` → today; ended Term auto-archives via the existing formal Intent and stays today with history after restart; read-only remains readable, rejects writes, and does not auto-archive.
- [x] Add RED module-driver tests for healthy, degraded, unavailable, and recovering peripheral combinations. Assert only the affected capabilities change, disabled ATTEND does not create limited mode, cleanup-pending/recovering PROTECT is visible, and PLAN remains available.
- [x] Add RED restart assertions for the current DATA operation, pending follow-ups, RestoreSession, and MigrationRollbackSession using stable IDs without paths.
- [x] Implement the unified PROTECT function by composing the existing two inspectors exactly once before `openWorkspaceDataWithMigrations`. It may retain proof-only observation/completion behavior already owned by those inspectors, but must not call any physical action function.
- [x] Implement one pure Workspace lifecycle projection from current DATA status, setup projection, module-driver status, operation handles, and pending follow-ups. Apply mode precedence `recovery → maintenance → read-only → limited → ready` and route precedence `recovery/maintenance → welcome → setup/today`.
- [x] Move startup backup wake after lifecycle recovery, Term reconciliation, and route projection. Keep post-commit wake behavior unchanged. A configured backup failure affects PROTECT health/capability and never rolls back local success.
- [x] Keep the existing setup query reconciliation for a long-running app, but make startup bootstrap perform it first and return the resulting revision/route. Do not create a second lifecycle fact owner.
- [x] Run the compiled lifecycle, restore, migration, setup, and Term lifecycle tests until GREEN.

### Task 3: Route Renderer from Workspace without implicit DATA creation

**Files:**

- Modify: `src/renderer/App.tsx`
- Modify: `tests/renderer/workspace-shell.test.ts`

- [x] Replace the existing absent-DATA auto-initialize expectation with a RED test that `loadWorkspace` returns `welcome` after one bootstrap query and performs no initialize/setup/PLAN query.
- [x] Add RED cases for lifecycle-directed setup, today, maintenance, recovery, read-only, and limited routes. MigrationRollback continues to use its dedicated maintenance surface.
- [x] Add a server-rendered welcome assertion for an explicit keyboard-operable “start local workspace” button; initialization occurs only from its click handler, after which the app reloads the Workspace projection.
- [x] Render a distinct recovery/maintenance startup surface instead of translating those routes into an ordinary empty/error workspace. Do not infer allowed physical actions in Renderer.
- [x] Run the compiled Renderer shell tests and related preload/architecture boundary tests until GREEN.

### Task 4: Fix packaged-smoke cleanup at the causal boundary

**Files:**

- Modify: `tests/scripts/run-packaged-smoke.test.ts`
- Modify: `scripts/run-packaged-smoke.mjs`

- [x] Preserve the baseline RED evidence: under full test load, exited-root cleanup starts synchronous PowerShell discovery only at the timeout and consumes the 1,000/1,200 ms cleanup grace; descendants remain even though real package/smoke happy paths pass.
- [x] Add a deterministic Windows RED fixture whose descendant-discovery process starts slowly. Assert discovery is started when the root exits, before the process deadline, and the exact descendant is still killed within the unchanged grace contract.
- [x] Replace synchronous discovery/kill/polling on the timeout callback with asynchronous child-process operations and condition-based liveness polling. Cache exited-root discovery started by the root `exit` event, await it during timeout cleanup, verify exact PID creation time, and retain the final no-residue postcondition.
- [x] Keep `timeoutMilliseconds = 20_000`, `terminationGraceMilliseconds = 1_000`, and all test-provided timeout/grace values unchanged. Do not weaken residue assertions or hide cleanup failures.
- [x] Run the compiled packaged-smoke test alone, then with the full suite, and confirm the original two full-load failures are GREEN.

### Task 5: Verify, record evidence, and commit

**Files:**

- Modify: `docs/roadmap/BACKLOG.md`
- Modify: `docs/roadmap/ROADMAP.md`

- [x] Run targeted compiled tests for shared contracts, lifecycle, restore, migration, Renderer, architecture/preload boundaries, and packaged-smoke cleanup.
- [x] Run fresh `pnpm test` and `pnpm typecheck` with the bundled Node/pnpm runtime.
- [x] Run applicable FECS checks for every changed TypeScript/TSX/JavaScript/HTML-bearing path, documenting project overrides for historical AMD/default-export rules; run `git diff --check` and review the final diff/status.
- [x] Commit implementation and tests using only task files. From that clean source, run `pnpm package` and `pnpm smoke:packaged` without changing timeout constants.
- [x] Update the Backlog evidence ledger and Roadmap pointer with exact commands, counts, Windows packaged identity, root-cause evidence, FECS result, and honest unverified platform/physical-failure items. Mark only `WP-R6-05` `Done`; leave `WP-GA-01`, R7, R11, and R12 unentered.
- [x] Commit the evidence update, confirm a clean worktree, and report both the implementation source hash and final evidence commit hash.
