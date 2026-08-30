# WP-UI-01 切片 10 Forward Migration Repair Implementation Plan

> **Skill availability:** The `superpowers:executing-plans`, `stop-that-shit`, `ponytail` and `applying-baidu-fecs-standards` skills named by `AGENTS.md` are not present in this Cowork session. Their manual ladders are followed instead, and every FECS claim below is a manual check of the changed paths, not a skill report.

**Goal:** Repair the forward schema migration path so an existing workspace at `CURRENT_SCHEMA_LEVEL - 1` opens and migrates instead of routing to `recovery`, and make the recurrence structurally impossible rather than fixed once more by hand.

**Trigger:** After 切片 9 (`3122bb3`, schema level 16→17) the running dev app boots into `需要恢复本地工作区`. The local workspace at `%LOCALAPPDATA%\CourseFlow Dev\DataSlots\active\workspace.sqlite` is `user_version = 16` and intact; the build refuses to open it.

**Two root causes, both in the migration entry path:**

1. `openWorkspaceDataWithMigrations` (`src/data/store/open.ts`) gates accepted source levels with a hand-written chain ending at `identity.schemaLevel !== 15`, and selects the pre-migration source validator with a ladder whose final `else` assumes level 15. 切片 9 added the `16 → 17` step *inside* the migration loop but extended neither list, so a level-16 database is rejected before the loop and the original `openWorkspaceData` result (`integrity` / `schema-mismatch`) is returned. `WP-R6-01` hit the identical omission at 14→15 (`f7af771`); the hand-written ladders make it recur at every bump.
2. `migrationOpenOptions` (`src/workspace/host.ts`) only supplies `migrationSafetyCopy` when `options.migrationRollbackTarget` is set, and the real entry point `src/workspace.ts` opens with `{ activityControlRoot }` only. Nothing in `src/` ever sets a rollback target — only `tests/workspace-migration.test.ts` does. So even with (1) fixed, `open.ts` returns `migration-safety-unavailable`. **No build has ever been able to migrate an existing workspace forward.** It stayed invisible because every schema bump so far ended with the dev workspace being wiped, and because the schema tests always inject a test-only binding the application never passes.

**Approved decision (user, 2026-08-29):** the safety copy always exists; the bound rollback target becomes optional. `A-DATA-007`'s real data-protection guarantee is the closed, re-verifiable pre-migration copy. Binding it to *一个精确兼容的 CourseFlow 版本* is only possible when the running build knows a published predecessor — never true for a development build, and not true for a first release. When no target is known the copy is still created, verified, viewable and explicitly deletable, and explicit rollback is simply not offered. This keeps the exact-build rollback promise honest instead of binding the copy to a version nobody can install.

**Architecture:** `MOD-DATA` keeps sole ownership of forward migration and the single safety copy. `MOD-PROTECT` keeps the MigrationRollbackSession/ActivityControl handoff. The change is a widening of one metadata field plus the repair of one entry path; no module boundary, dependency direction or fact ownership moves.

**Tech Stack:** existing pinned Electron, React, TypeScript, Node test runner, SQLite runtime. No dependency changes.

**Approved sources:** `PRD.md` `A-DATA-007`; `ADR-10` §5、§12; `ADR-04` migration/compat protocol; `MODULE_CONTRACTS.md` migration safety copy and `ApplicationBuildStatus` sections; `TEST-DATA-007`.

**Scope guard:** modify only the migration entry path in `src/data/store/open.ts`, the safety-copy binding/metadata in `src/data/migration-safety-copy.ts`, the option composition in `src/workspace/host.ts`, the projections and Shell surfaces that display a rollback target, the owning docs, and the target tests plus the Backlog evidence row. Do not touch `WP-GA-01`, R7, R11, R12 packaging/manifest work, the 2026-08-28 task model, or any unrelated `WP-UI-01` visual work. Do not wipe or migrate the user's workspace outside an explicit verification step.

**Format version:** `MIGRATION_SAFETY_COPY_SCHEMA` stays `courseflow-migration-safety-copy-v1`. Making `rollbackTarget` nullable is a widening: every copy written by the current code still parses unchanged, so the format stays readable and no migration of the copy format is owed. `formats.migrationSafetyCopy` in `ApplicationBuildStatus` is declared and displayed but never compared, so it stays `'1'`.

**Registration:** recorded as `WP-UI-01` 切片 10, following the precedent of `WP-R6-01`'s `f7af771` schema-14 migration fix — the defect was introduced by this package's own 切片 9 and is repaired inside it. `A-DATA-007`'s 主所有权 stays with `WP-R12-03`; this slice claims no Requirement/TEST 主所有权. If a separate registered package is preferred, only the ledger row moves — the plan body is unchanged.

---

### Task 1: Docs first — the bound rollback target becomes optional

**Files:**

- Modify: `docs/product/PRD.md` (`A-DATA-007`)
- Modify: `docs/architecture/adr/ADR-10-packaging-signing-update.md` (§5, §12)
- Modify: `docs/architecture/MODULE_CONTRACTS.md` (migration safety copy metadata + projection, trace rows)

- [ ] State in `A-DATA-007` that the closed, re-verifiable safety copy is created and verified before any schema write **unconditionally**, and that it binds an exact compatible CourseFlow version *only when the running build knows a published predecessor*. Without one the copy remains viewable and explicitly deletable and explicit rollback is not offered — it is never silently skipped, and no substitute version is invented.
- [ ] Mirror the same sentence in `ADR-10` §5 so the ADR and the requirement cannot drift, and confirm §12 still names the release manifest as the only source of a published rollback target.
- [ ] Make `rollbackTarget` nullable in the `MigrationSafetyCopyMetadataV1` and `MigrationSafetyCopyProjection` definitions in `MODULE_CONTRACTS.md`, and record that the rollback offer is gated on a non-null target.
- [ ] Check links, stable IDs, terminology, hierarchy and `git diff --check`. Leave no placeholder and no undecidable acceptance condition.

### Task 2: RED — the two regressions, and a guard against the next one

**Files:**

- Modify: `tests/data/schema.test.ts`
- Modify: `tests/architecture/module-dependency.test.ts` *(or a sibling architecture test — place by what the file already owns)*
- Modify: `tests/workspace-migration.test.ts`

- [ ] RED: build a `CURRENT_SCHEMA_LEVEL - 1` database from the repo's own DDL and migration chain, seed a term/course/task, then open it through `openWorkspaceDataWithMigrations` with **the option set the application actually passes** — `migrationOpenOptions(appBuildId, { activityControlRoot })` — and assert it opens `ready` at `CURRENT_SCHEMA_LEVEL` with the seeded rows and revision preserved, and exactly one registered safety copy whose `rollbackTarget` is `null`. This fails today on both defects and is the test that was missing.
- [ ] RED: an architecture test that derives the expected level set from `CURRENT_SCHEMA_LEVEL` and asserts the accepted-source-level guard and the source-validator ladder in `open.ts` cover every level from 1 to `CURRENT_SCHEMA_LEVEL - 1` with no fallthrough default. This is the actual fix for the recurrence — it must fail automatically at the next bump, before anyone opens the app.
- [ ] RED: a safety copy bound to a non-null target still projects a rollback offer; one bound to `null` projects the copy with no rollback action, and no invented target appears anywhere in the DTO.
- [ ] Keep the existing test-only `ROLLBACK_TARGET` fixtures for the non-null path; do not delete coverage of the bound case.

### Task 3: GREEN — repair the migration entry path so it cannot drift

**Files:**

- Modify: `src/data/store/open.ts`

- [ ] Replace the hand-written accepted-level chain with one bounded integer check against `CURRENT_SCHEMA_LEVEL`, so a newly added level is accepted by construction.
- [ ] Replace the source-validator `if/else` ladder with a frozen level→validator table and require an exact hit; an unmapped level must fail loudly rather than silently validating as the wrong level. Do the same for the migration step selection inside the loop, removing the trailing `else` that currently absorbs the newest level.
- [ ] Change nothing about ordering, transaction boundaries, foreign-key handling, failpoints or the post-migration validation.

### Task 4: GREEN — a nullable rollback target, end to end

**Files:**

- Modify: `src/data/migration-safety-copy.ts`
- Modify: `src/shared/workspace-migration-contract.ts`
- Modify: `src/workspace/projections.ts`
- Modify: `src/renderer/MigrationRollbackSurface.tsx`
- Modify: `src/renderer/SettingsDialog.tsx` *(only if it renders the rollback action)*

- [ ] Make `rollbackTarget` `MigrationRollbackTargetV1 | null` in the binding and the metadata; replace `requireRollbackTarget` at the write site with a validator that accepts `null` and still rejects a malformed target.
- [ ] Apply the `createdByAppBuildId === rollbackTarget.appBuildId` self-rollback guard only when the target is non-null.
- [ ] Keep `canonicalJson` comparison and the metadata digest working over the nullable field, and confirm `isSameMigration` still recognises a reusable copy in both cases.
- [ ] Gate the Shell's explicit-rollback affordance on a non-null target. The copy's size, creation time and delete action stay available either way; state plainly in the surface that no exact rollback version is bound rather than showing an empty or disabled mystery control.

### Task 5: GREEN — the application actually supplies a binding

**Files:**

- Modify: `src/workspace/host.ts`

- [ ] Have `migrationOpenOptions` always compose a `migrationSafetyCopy` binding, carrying `rollbackTarget: options.migrationRollbackTarget ?? null`. `readOnly`, failpoint and clock plumbing unchanged.
- [ ] Confirm no other caller depended on the binding being absent as a signal.

### Task 6: Verify, record evidence, and commit

- [ ] `tsc --noEmit` on the main config and `tsc -p tsconfig.test.json`.
- [ ] Chunked full `node --test` (architecture / renderer / shared / data / protect / main / platform / scripts / root), reported against the known environment-only failures rather than folded into them.
- [ ] `git diff --check`; manual FECS check of every changed TypeScript path (`@file`, 120 columns, tabs, trailing whitespace).
- [ ] **The check that matters:** relaunch the dev app on Windows against the real level-16 workspace and confirm it migrates to 17, opens with the existing terms/courses/tasks intact, registers one safety copy visible under 设置 → 数据与备份, and offers no rollback. A byte copy of the pre-migration database is already parked at `%LOCALAPPDATA%\CourseFlow Dev\level16-fixture-2026-08-29\` — verify it is untouched afterwards, then delete it once the migrated workspace is confirmed good.
- [ ] Record the Backlog evidence row: commands actually run, results, and the未验证项 — this slice does not run `pnpm test`/`pnpm typecheck`/`pnpm package`/`pnpm smoke:packaged` on Windows unless Sirui runs them, and claims no macOS evidence.
- [ ] Commit code and the evidence row together, unsigned, single author, no co-author trailer. Report the hash. No push, no amend.
