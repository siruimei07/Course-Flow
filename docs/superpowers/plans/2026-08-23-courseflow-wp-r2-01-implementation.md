# CourseFlow WP-R2-01 Implementation Plan

> **历史计划适用性：** 本文保留 WP-R2-01 实施设计与当时步骤；当前状态和待办以 [BACKLOG.md](../../roadmap/BACKLOG.md) 为准，执行与 skill 路由遵循 [AGENTS.md](../../../AGENTS.md)。旧路径、版本、复验与提交步骤仅在当前授权及实际改动仍适用时使用；已满足的工作不因旧复选框重做。

**Goal:** 建立 CourseFlow 第一个可持久化、可重启重开的 MOD-DATA 纵向切片：受版本约束的本地 SQLite schema、原子 commit、终身 CommandReceipt、canonical digest、一致 ReadSnapshot，以及 read-only/recovery 打开分类。

**Architecture:** Electron Main 继续只拥有单实例、平台根和 Workspace utility 生命周期，并把已验证的 DataSlotsRoot 作为 utility 启动参数传入；只有 Workspace utility 内的一个具体 SqliteDataStore 打开活动数据库。DATA 使用一个长期 DatabaseSync、直接 prepared SQL、同步事务体和有界 FIFO；共享 DTO 只传 plain discriminated unions、canonical UUID/十进制字符串和 schema level，不传真实路径、SQLite/Buffer/Error 类型。

**Tech Stack:** 仓库已锁定的 pnpm 11.19.0、Electron 43.4.1、Node 24.19.0、SQLite 3.53.1、TypeScript 7.0.2、Node 内置 test runner、node:sqlite、node:crypto 与 node:fs；不增加依赖。

**Spec:** [PRD A-DATA-001](../../product/PRD.md#35-本地数据与备份)；[Architecture MOD-DATA/FLOW-01/Q](../../architecture/ARCHITECTURE.md)；[Module Contracts](../../architecture/MODULE_CONTRACTS.md)；[ADR-03](../../architecture/adr/ADR-03-sqlite-active-data-transactions.md)；[ADR-04](../../architecture/adr/ADR-04-schema-migration-compatibility.md)；[Backlog WP-R2-01](../../roadmap/BACKLOG.md#r2--首次真实保存)。

## Global Constraints

- 每个 Task 开始先读取根 AGENTS.md、运行 git status --short --branch，并保留用户或并行工作的无关改动。
- 开始修改相应路径前调用 applying-baidu-fecs-standards；TypeScript 使用 JavaScript + ESNext 草案分支，TSX 再加 HTML + React 草案分支，新增 src/data 目录先复核“项目目录 1.1”。项目既有 docs/ 路径优先于 FECS 历史复数目录禁令。
- Ponytail 保持 full：复用 node:sqlite、node:crypto、node:fs 和现有测试脚本；只建立一个具体 adapter，不建立 ORM、query builder、repository/driver interface、factory、connection pool（连接池）、第二实现或运行时 fallback。
- 工作包只关闭 A-DATA-001、IF-DATA-READ、IF-DATA-COMMIT、IF-DATA-RECEIPT、FLOW-01 中 DATA 拥有的部分，以及 TEST-DATA-001/002/003/005。不得把尚未实现的备份、恢复、迁移回退或完整 FLOW-00/FLOW-01 UI 闭环登记为完成。
- 不创建 C1/C2、GRADE、ATTEND、LIBRARY、PROTECT runtime、未来 module registry、feature flag、空路由或预留 schema。
- 所有不可信命令/DTO 在边界验证一次；事务内只重查 receipt、expected Revision/EntityVersion 和会竞争的前提。事务体不得 await、发 IPC、访问文件系统、运行 backup 或发送通知。
- 测试只覆盖目标 TEST 的语义等价类：一组 canonical golden/rejection vectors、一组语义 failpoint、一个 stale EntityVersion/并发 snapshot 场景，以及 absent/current/read-only/future/corrupt 打开分类。不增加 fuzz、属性测试、负载测试、穷举 bit-flip 或 SQLite 每个 extended result code 的矩阵。
- 每个 Task 先加入会失败的最小测试，确认失败原因，再写最小实现；运行该 Task 的目标命令，审阅 diff，只暂存本 Task 文件并创建列出的本地 commit。不 push、不 amend。
- WP-R1-05 的真实 macOS arm64 证据依赖保持开放；Windows 结果不得推断 macOS 通过，也不得阻止不依赖该主机的 WP-R2-01 代码切片。

## First-Principles Boundary

用户结果是“正式数据一旦越过本地 commit 边界，utility 或应用重启后仍能判定同一结果”；不是“先搭一个通用数据平台”。因此本计划固定以下边界：

1. 真相边界：SQLite COMMIT 前全部 unchanged；COMMIT 后 facts、Revision、receipt、effects、follow-up 和 backup-needed watermark 全部成立。
2. 信任边界：Main 只提供已经由现有开发根逻辑判定为 verified-local 的 DataSlotsRoot；路径只走 Main → utility 启动参数，不进入 Renderer/Main IPC DTO 或 smoke JSON。
3. 兼容边界：application_id = 0x43464C57；CURRENT_SCHEMA_LEVEL = 1。该 level 是 R11 前可修正的未公开开发 schema，不是已经冻结的公开 v1 承诺。
4. 重启边界：SQLite COMMIT 前进程退出，重开只能看到旧 Revision 且没有 receipt；COMMIT 后、响应前退出，重开必须通过同一 CommandId receipt 收敛为原 committed outcome。
5. 完成边界：四个目标 TEST 可定位并通过，Windows packaged smoke 仍不泄露路径，Backlog 有真实命令/结果/未验证项，且最终提交后工作树干净。

## File Map

### Create

| File | Single responsibility |
|---|---|
| src/shared/canonical-json.ts | courseflow-canonical-json-v1 的受限纯编码器；无 Node/Electron import |
| src/shared/workspace-data-contract.ts | 当前 Workspace-owned setup ChangeSet、canonical ID/64-bit DTO 与 DATA outcome 的封闭类型/验证 |
| src/data/command-digest.ts | 从已验证命令构造 digest projection，并用 Node core SHA-256 返回 32 bytes |
| src/data/schema.ts | application/schema 常量、level 0→1 初始化 DDL、level 1 精确 manifest 校验 |
| src/data/sqlite-data-store.ts | DataSlot 定位、单连接生命周期、IF-DATA-READ、IF-DATA-COMMIT、IF-DATA-RECEIPT、FIFO、failpoint 与错误分类 |
| tests/shared/canonical-json.test.ts | canonical text 与拒绝值的单一 table-driven 测试 |
| tests/data/command-digest.test.ts | TEST-DATA-002 digest golden vector 与 CommandId 排除证明 |
| tests/data/schema.test.ts | level 1 共同 schema、staged initialization、current reopen 与无未来表证明 |
| tests/data/sqlite-data-store.test.ts | TEST-DATA-001/002/003/005 的模块集成断言 |
| tests/data/sqlite-data-restart.fixture.ts | 子进程在精确 failpoint 退出，供真实重启/WAL recovery 测试 |

### Modify

| File | Change |
|---|---|
| docs/roadmap/BACKLOG.md | Task 1 领取 WP；Task 7 记录验证并关闭 WP |
| tsconfig.test.json | 明确把 src/data/**/*.ts 纳入测试编译 |
| src/shared/bootstrap-contract.ts | protocol 2、workspaceEpoch 和无路径 WorkspaceDataStatus |
| src/main.ts | 把 verified DataSlotsRoot 作为唯一 utility 启动参数传入；smoke 拒绝 recovery/read-only |
| src/workspace.ts | 移除内存 DB owner，启动时创建一个 SqliteDataStore/absent 状态并复用 |
| src/renderer/main.tsx | 对 absent、ready、read-only、recovery 使用不同文字状态，避免伪成功 |
| tests/shared/bootstrap-contract.test.ts | 新 DTO 的 exact-key、canonical string、mode/problem 验证 |
| tests/architecture/workspace-entry-boundary.test.ts | 根只经启动参数进入 utility；workspace entry 不直接拥有 fs/path/SQLite |
| tests/architecture/runtime-boundaries.test.ts | node:sqlite 只允许 MOD-DATA 的 src/data/schema.ts 与 src/data/sqlite-data-store.ts 导入；依赖白名单保持不变 |

### Explicitly unchanged

- src/preload.ts 仍只暴露零参数 courseFlow.query。
- src/main/workspace-supervisor.ts 仍只关联 requestId、验证 shared outcome、处理 timeout/exit；它不知道数据库路径、schema 或 SQLite。
- package.json、pnpm-lock.yaml、pnpm-workspace.yaml 和 forge.config.ts 不增加依赖或第二个 utility entry。

## Current Common Schema and Deferred Scope

CURRENT_SCHEMA_LEVEL = 1 只建立下列六张 STRICT 表：

| Table | Current columns/semantics |
|---|---|
| workspace_state | singleton=1、canonical WorkspaceId、非负 Revision；初始化为 Revision 0 |
| setup_state | singleton FK、last_decision = null/later/skip、setup_decision_version、ever_reached_minimum；这是 ADR-04 已批准的当前 MOD-WORKSPACE 共同 aggregate，不代表完成 WP-R2-02 |
| command_receipts | CommandId、intent kind/schema version、canonical encoding、digest algorithm、32-byte digest、committed Revision、committed result discriminator |
| receipt_effects | receipt FK、稳定顺序、effect code、typed workspace-setup EntityRef、EntityVersion |
| durable_followups | FollowUpId、originating CommandId、owner=protect、kind=backup-needed-through、prerequisite Revision、当前仅 pending state、own version 0 |
| protection_watermarks | singleton、backupNeededThrough、backupSucceededThrough，且 succeeded ≤ needed |

约束全部由 NOT NULL/CHECK/UNIQUE/FK/RESTRICT 表达；不使用 trigger、cascade、deferred FK、generated column、REAL、JSON payload、EAV、通用 entity/version registry、schema_migrations 或通用审计列。level 1 的唯一 code-owned migration 是显式新 staging 数据库的 0→1 初始化；任何既有非空 level 0、future level 或 manifest 不匹配都停止，不被“收养”或重建。

本工作包明确延后：

- operations、draft_checkpoints、backup_configurations/backup_state、restore/migration detail 表；
- durable follow-up 的 retry/terminal 转换、attempt/terminal detail 与执行 worker；这些在交付 MOD-PROTECT 时通过真实 migration 增加，WP-R2-01 只证明 pending 义务与主 commit 同事务存活；
- plan_state、terms、courses、meeting/task/holiday/occurrence 表；
- ATTEND、LIBRARY、GRADE/C1/C2 与任何未来模块表；
- supported-old active DB migration、安全副本、逐级公开 migration fixture、DataSlot candidate/rollback/quarantine、Online Backup、snapshot、restore 和 migration rollback；
- choice 形式的 RecordSetupDecision，直到拥有该 choice 字段语义的工作包定义封闭 payload；
- exact decimal parser、时间/Zone DTO 和领域表索引，直到当前工作包出现实际字段；
- Renderer/Main 的业务 command channel；WP-R2-01 只扩展 bootstrap 状态，不暴露写入口。

R11 冻结第一个公开 schema level 前可以通过显式开发迁移或重建已证明可丢弃的测试数据修正 level 1；任何已经承载用户数据或无法证明可丢弃的数据仍不得静默 reset。

## DTO, Digest, Failpoint, and Restart Contract

canonicalizer 的输入类型只表达获准值：

~~~ts
export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalValue[]
  | Readonly<{ [key: string]: CanonicalValue }>;
~~~

公共 bootstrap DTO 升为 protocolVersion 2，并增加：

~~~ts
export type DataOpenProblem =
  | Readonly<{
      code: 'permission';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'read-only' }>;
    }>
  | Readonly<{
      code: 'incompatible-version';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ actualSchemaLevel: number; requiredSchemaLevel: 1 }>;
    }>
  | Readonly<{
      code: 'integrity';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{
        reason: 'wrong-application-id' | 'nonempty-level-zero' | 'schema-mismatch' | 'database-corrupt';
      }>;
    }>
  | Readonly<{
      code: 'recovery-required';
      scope: 'workspace';
      dataEffect: 'unchanged';
      affectedCapabilities: readonly ['workspace.read', 'workspace.write'];
      allowedActions: readonly [];
      context: Readonly<Record<never, never>>;
      details: Readonly<{ reason: 'database-unreadable' }>;
    }>;

export type WorkspaceDataStatus =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
      kind: 'ready';
      workspaceId: string;
      schemaLevel: 1;
      revision: string;
    }>
  | Readonly<{
      kind: 'read-only';
      workspaceId: string;
      schemaLevel: 1;
      revision: string;
      problem: DataOpenProblem;
    }>
  | Readonly<{
      kind: 'recovery';
      problem: DataOpenProblem;
    }>;

export type BootstrapReady = Readonly<{
  protocolVersion: 2;
  appBuildId: string;
  requestId: string;
  workspaceEpoch: string;
  workspaceProcess: 'ready';
  sqliteVersion: string;
  dataRootClass: 'verified-local';
  workspaceData: WorkspaceDataStatus;
}>;
~~~

DATA owner 内部的打开结果不跨 IPC，并固定为：

~~~ts
export type DataOpenResult =
  | Readonly<{ kind: 'absent'; sqliteVersion: string }>
  | Readonly<{ kind: 'ready'; sqliteVersion: string; store: SqliteDataStore }>
  | Readonly<{ kind: 'read-only'; sqliteVersion: string; store: SqliteDataStore }>
  | Readonly<{ kind: 'recovery'; sqliteVersion: string; problem: DataOpenProblem }>;
~~~

当前 commit/receipt outcome 也使用封闭 plain DTO：

~~~ts
export type CommandReceiptOutcome = Readonly<{
  kind: 'committed';
  revision: string;
  effects: readonly [Readonly<{
    code: 'workspace.setup-decision-recorded';
    entity: Readonly<{
      kind: 'workspace-setup';
      id: string;
      version: string;
    }>;
  }>];
  pendingFollowUps: readonly [string];
}>;

export type DataCommitResult =
  | Readonly<{ ok: true; value: CommandReceiptOutcome }>
  | Readonly<{
      ok: false;
      problem:
        | Readonly<{
            code: 'conflict';
            scope: 'operation';
            dataEffect: 'unchanged';
            affectedCapabilities: readonly ['workspace.write'];
            allowedActions: readonly ['requery'];
            context: Readonly<{
              revision: string;
              entityVersions: readonly [Readonly<{ kind: 'workspace-setup'; id: string; version: string }>];
            }>;
            details: Readonly<{
              reason: 'command-id-reused' | 'expected-revision' | 'expected-entity-version';
            }>;
          }>
        | Readonly<{
            code: 'permission';
            scope: 'workspace';
            dataEffect: 'unchanged';
            affectedCapabilities: readonly ['workspace.write'];
            allowedActions: readonly [];
            context: Readonly<{ revision: string }>;
            details: Readonly<{ reason: 'read-only' }>;
          }>
        | Readonly<{
            code: 'operation-in-progress';
            scope: 'operation';
            dataEffect: 'unchanged';
            affectedCapabilities: readonly ['workspace.write'];
            allowedActions: readonly ['retry'];
            context: Readonly<{ revision: string }>;
            details: Readonly<{ reason: 'writer-busy' }>;
          }>;
    }>;
~~~

DataCommitResult 只在 DATA 能证明 committed 或 unchanged 时返回。COMMIT 附近的 I/O/进程失败若无法判定结果，当前调用不返回“成功”或“失败”：关闭/终止该 owner，Main 观察 utility 退出；新 workspaceEpoch 重开后以原 CommandId 查询 IF-DATA-RECEIPT，匹配 receipt 才重放 committed，数据库仍不可判定时才进入 recovery-required。

Revision/EntityVersion 使用 0 或无前导零的 canonical unsigned decimal string，并在写入 SQLite 前检查不超过 9223372036854775807；WorkspaceId、CommandId、FollowUpId、workspaceEpoch 使用 lowercase canonical UUID。DTO 拒绝 unknown key、BigInt、Buffer/typed array、Date、Error、Map/Set、class、accessor 和 cycle。真实路径、SQL、SQLite code/message 不进入 DTO。

当前唯一正式 ChangeSet：

~~~ts
export type RecordSetupDecisionCommand = Readonly<{
  commandId: string;
  workspaceId: string;
  intent: Readonly<{
    kind: 'workspace.record-setup-decision';
    intentSchemaVersion: 1;
    payload: Readonly<{ decision: 'later' | 'skip' }>;
  }>;
  expectedRevision: string;
  expectedSetupVersion: string;
  followUpId: string;
}>;

export type DurableFollowUp = Readonly<{
  followUpId: string;
  originatingCommandId: string;
  owner: 'protect';
  kind: 'backup-needed-through';
  prerequisiteRevision: string;
  state: 'pending';
  version: '0';
}>;

export type WorkspaceSetupSnapshot = Readonly<{
  revision: string;
  setup: Readonly<{
    workspaceId: string;
    lastDecision: 'later' | 'skip' | null;
    entityVersion: string;
  }>;
}>;

export type ReadSnapshotOptions = Readonly<{
  failpoint?: (point: 'read.after-revision') => void;
}>;
~~~

digest projection 固定包含 encoding、intent kind/schema/payload、expected Revision、workspace-setup expected EntityVersion 和 durable follow-up；排除 CommandId、requestId、protocolVersion、workspaceEpoch、timeout 和观测字段。golden preimage 与 SHA-256：

~~~text
{"durableFollowUps":[{"followUpId":"22222222-2222-4222-8222-222222222222","kind":"backup-needed-through","owner":"protect"}],"encoding":"courseflow-canonical-json-v1","expectedEntityVersions":[{"entityId":"11111111-1111-4111-8111-111111111111","entityKind":"workspace-setup","version":"0"}],"expectedRevision":"0","intent":{"intentSchemaVersion":1,"kind":"workspace.record-setup-decision","payload":{"decision":"later"}}}
556616ce11b365703b18bc6e3d7802a0e399a42c345df879016e6c02f5ddc90c
~~~

测试 failpoint 是 closed string union，仅由测试注入；production Workspace 不从 argv/env/IPC 开启 failpoint：

~~~ts
export type DataFailpoint =
  | 'initialize.after-schema'
  | 'initialize.after-bootstrap'
  | 'initialize.after-user-version'
  | 'initialize.after-validation'
  | 'commit.after-begin'
  | 'commit.after-receipt-read'
  | 'commit.after-expected-versions'
  | 'commit.after-facts'
  | 'commit.after-revision'
  | 'commit.after-receipt'
  | 'commit.after-followup'
  | 'commit.after-watermark'
  | 'commit.before-sqlite-commit'
  | 'commit.after-sqlite-commit'
  | 'read.after-revision';
~~~

重启判定固定为：

| Last reached point | Reopen truth |
|---|---|
| initialize.after-validation 之前退出 | canonical active slot 不存在；未激活 staging 不是正式 Workspace |
| initialization directory rename 完成后退出 | active/workspace.sqlite 必须完整验证并保持同一 WorkspaceId |
| commit.before-sqlite-commit 或更早退出 | setup fact/version、Revision、receipt、effect、follow-up、watermark 全部保持旧值 |
| commit.after-sqlite-commit、response 前退出 | 上述六项全部为新值；同 CommandId receipt 重放原 outcome |
| read.after-revision 时排入 writer | 当前 snapshot 继续返回旧 Revision 的完整事实；writer 随后提交新 Revision |

---

### Task 1: 固定 canonical DTO 与 digest — TEST-DATA-002

**Files:**

- Modify: docs/roadmap/BACKLOG.md
- Create: src/shared/canonical-json.ts
- Create: src/shared/workspace-data-contract.ts
- Create: src/data/command-digest.ts
- Create: tests/shared/canonical-json.test.ts
- Create: tests/data/command-digest.test.ts
- Modify: tsconfig.test.json

**Interfaces:**

- Produces: canonicalJson(value: unknown): string
- Produces: normalizeRecordSetupDecisionCommand(value: unknown): RecordSetupDecisionCommand
- Produces: recordSetupDecisionDigestProjection(command): CanonicalValue
- Produces: digestRecordSetupDecision(command: RecordSetupDecisionCommand): Uint8Array
- Produces: canonical UUID、unsigned SQLite integer string 和 exact-key validators

**首先失败的测试（TEST-DATA-002）：** tests/shared/canonical-json.test.ts 与 tests/data/command-digest.test.ts 在 test:compile 阶段因三个目标模块尚不存在而失败；失败范围不得扩散到现有测试。

**最小生产实现：** 一个无 Node import 的受限 canonical JSON 编码器、一个封闭的 RecordSetupDecisionCommand validator/projection，以及一个直接调用 node:crypto SHA-256 的 digest 函数。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、两个新测试文件的 `node --test`、`pnpm typecheck`。

**本地 commit：** `feat: define data command encoding`

- [ ] **Step 1: 领取 WP 并写第一个失败测试**

  将 BACKLOG 中 WP-R2-01 从 Ready 改为 In Progress，并追加“canonical digest golden vector 待实现”的领取证据。新增测试：

  ~~~ts
  const GOLDEN_CANONICAL_TEXT = '{"durableFollowUps":[{"followUpId":"22222222-2222-4222-8222-222222222222","kind":"backup-needed-through","owner":"protect"}],"encoding":"courseflow-canonical-json-v1","expectedEntityVersions":[{"entityId":"11111111-1111-4111-8111-111111111111","entityKind":"workspace-setup","version":"0"}],"expectedRevision":"0","intent":{"intentSchemaVersion":1,"kind":"workspace.record-setup-decision","payload":{"decision":"later"}}}';
  const GOLDEN_SHA256 = '556616ce11b365703b18bc6e3d7802a0e399a42c345df879016e6c02f5ddc90c';

  test('TEST-DATA-002: canonical command digest matches the v1 golden vector', () => {
    const command = normalizeRecordSetupDecisionCommand({
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      intent: {
        kind: 'workspace.record-setup-decision',
        intentSchemaVersion: 1,
        payload: { decision: 'later' },
      },
      followUpId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: '0',
      expectedSetupVersion: '0',
    });

    assert.equal(canonicalJson(recordSetupDecisionDigestProjection(command)), GOLDEN_CANONICAL_TEXT);
    assert.equal(Buffer.from(digestRecordSetupDecision(command)).toString('hex'), GOLDEN_SHA256);
  });
  ~~~

  同一文件用一个 table-driven case 证明 key 顺序、Unicode、array 顺序和 absent/null；一个最小 64-bit DTO table 证明 `0` 与 `9223372036854775807` 被接受、`01` 与 `9223372036854775808` 被拒绝；另一个 case 表证明 undefined、sparse array、float、NaN/Infinity、-0、lone surrogate、Date、Map、class、accessor 和 cycle 被拒绝。当前 intent 没有 decimal/confirmation 字段，因此不为未来字段制造 vectors。

  Run:

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  ~~~

  Expected: FAIL，TS2307 只报告缺少三个新模块；不得先出现无关类型错误。

- [ ] **Step 2: 实现受限 canonicalizer 和当前命令 validator**

  canonicalJson 只接受 null/boolean/string/safe integer/dense array/plain data object；使用 Object.getOwnPropertyDescriptors 拒绝 accessor/symbol/non-enumerable surprise，WeakSet 拒绝 cycle，默认 UTF-16 code-unit key order 递归排序，JSON.stringify 产生无 BOM/空白文本。命令 validator 使用封闭 exact-key 检查并把 expectedSetupVersion 投影为：

  ~~~ts
  {
    encoding: 'courseflow-canonical-json-v1',
    intent: command.intent,
    expectedRevision: command.expectedRevision,
    expectedEntityVersions: [{
      entityKind: 'workspace-setup',
      entityId: command.workspaceId,
      version: command.expectedSetupVersion,
    }],
    durableFollowUps: [{
      followUpId: command.followUpId,
      owner: 'protect',
      kind: 'backup-needed-through',
    }],
  }
  ~~~

  commandId 不进入 projection。command-digest.ts 只调用 createHash('sha256').update(canonicalText, 'utf8').digest()，返回 32-byte Uint8Array；不提供未版本化 hex API，不引入 hash/canonicalization dependency。

- [ ] **Step 3: 验证 TEST-DATA-002 的纯协议层**

  Run:

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test ".test-dist/tests/shared/canonical-json.test.js" ".test-dist/tests/data/command-digest.test.js"
  pnpm typecheck
  ~~~

  Expected: 两个测试文件 PASS；digest 精确为 556616ce…dc90c；reordered keys/不同 CommandId 相同 digest，decision/expected version/followUpId 任一变化得到不同 digest。

- [ ] **Step 4: 审阅并提交**

  Run git diff --check，确认 package.json/pnpm-lock.yaml 未变，随后：

  ~~~powershell
  git add docs/roadmap/BACKLOG.md tsconfig.test.json src/shared/canonical-json.ts src/shared/workspace-data-contract.ts src/data/command-digest.ts tests/shared/canonical-json.test.ts tests/data/command-digest.test.ts
  git commit -m "feat: define data command encoding"
  ~~~

### Task 2: 建立 level 1 共同 schema 与 staged initialization — TEST-DATA-001/005

**Files:**

- Create: src/data/schema.ts
- Create: src/data/sqlite-data-store.ts
- Create: tests/data/schema.test.ts

**Interfaces:**

- Consumes: canonical WorkspaceId/Revision validators from Task 1
- Produces: COURSEFLOW_APPLICATION_ID = 0x43464C57
- Produces: CURRENT_SCHEMA_LEVEL = 1
- Produces: initializeWorkspaceData(dataSlotsRoot, workspaceId, options?): SqliteDataStore
- Produces: openWorkspaceData(dataSlotsRoot, options?): DataOpenResult
- Produces: close(): Promise<void>

**首先失败的测试（TEST-DATA-001/005）：** tests/data/schema.test.ts 在 test:compile 阶段因 schema/store 模块尚不存在而失败；随后它固定六张 level 1 表、staged activation、当前版本重开和初始化 failpoint。

**最小生产实现：** 仅实现 application_id、CURRENT_SCHEMA_LEVEL=1、精确 0→1 DDL/manifest validator、DataSlots/active 定位、staged initialization 与一个长期 DatabaseSync。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、`node --test ".test-dist/tests/data/schema.test.js"`、`pnpm typecheck`。

**本地 commit：** `feat: initialize versioned workspace data`

- [ ] **Step 1: 写 schema RED**

  新测试在 mkdtempSync 创建的唯一 temp root 下显式初始化，关闭后用只读 DatabaseSync 检查：

  ~~~ts
  const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

  test('TEST-DATA-001/005: level 1 initializes only the current common schema and reopens', async (t) => {
    const dataSlotsRoot = createTempDataSlots(t);
    const store = initializeWorkspaceData(dataSlotsRoot, WORKSPACE_ID);
    assert.deepEqual(store.status(), {
      kind: 'ready',
      workspaceId: WORKSPACE_ID,
      schemaLevel: 1,
      revision: '0',
    });
    await store.close();

    assert.deepEqual(readSchemaFacts(dataSlotsRoot), {
      applicationId: 0x43464c57,
      userVersion: 1,
      tables: [
        'command_receipts',
        'durable_followups',
        'protection_watermarks',
        'receipt_effects',
        'setup_state',
        'workspace_state',
      ],
      allStrict: true,
      revision: 0n,
    });
    const reopened = openWorkspaceData(dataSlotsRoot);
    assert.equal(reopened.kind, 'ready');
    if (reopened.kind === 'ready') {
      await reopened.store.close();
    }
  });
  ~~~

  在同一测试文件定义两个窄 helper：createTempDataSlots 使用 mkdtempSync(path.join(tmpdir(), 'courseflow-data-'))，并以 t.after 删除该已知 temp root；readSchemaFacts 只读打开 active/workspace.sqlite，查询 application_id、user_version、PRAGMA table_list 和 workspace revision 后立即关闭，不复用 production manifest validator。

  再用一个四项 table-driven transaction 分别触发代表性的 CHECK（非法 enum）、STRICT（错误 storage class）、FK（不存在 receipt）和 UNIQUE/PK（重复 singleton）拒绝；每次 rollback 后重新读取并断言 Revision 0、receipt/follow-up 仍为空。它证明约束类别及失败原子性，不枚举每个列值组合。

  同一文件再用一个 table-driven test 遍历 initialize.after-schema、initialize.after-bootstrap、initialize.after-user-version、initialize.after-validation。failpoint 抛出后 openWorkspaceData 必须返回 absent，canonical active 目录不存在；随后在同一 DataSlotsRoot 重新初始化必须得到一个完整 level 1，而不是接纳失败 staging。

  Run test:compile；Expected: FAIL，只因 schema/store module 不存在。

- [ ] **Step 2: 写精确 0→1 DDL 与 manifest validator**

  schema.ts 使用一个显式 migrateLevel0To1 函数，不建立 migration interface/registry/ledger。DDL 的列和 CHECK 必须与“Current Common Schema”表一致，核心形态为：

  ~~~sql
  CREATE TABLE workspace_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    workspace_id TEXT NOT NULL CHECK (
      length(workspace_id) = 36
      AND workspace_id = lower(workspace_id)
      AND substr(workspace_id, 9, 1) = '-'
      AND substr(workspace_id, 14, 1) = '-'
      AND substr(workspace_id, 19, 1) = '-'
      AND substr(workspace_id, 24, 1) = '-'
      AND workspace_id NOT GLOB '*[^0-9a-f-]*'
    ),
    revision INTEGER NOT NULL CHECK (revision >= 0)
  ) STRICT;

  CREATE TABLE setup_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_decision TEXT CHECK (last_decision IS NULL OR last_decision IN ('later', 'skip')),
    setup_decision_version INTEGER NOT NULL CHECK (setup_decision_version >= 0),
    ever_reached_minimum INTEGER NOT NULL CHECK (ever_reached_minimum IN (0, 1)),
    FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE command_receipts (
    command_id TEXT PRIMARY KEY,
    intent_kind TEXT NOT NULL CHECK (intent_kind = 'workspace.record-setup-decision'),
    intent_schema_version INTEGER NOT NULL CHECK (intent_schema_version = 1),
    canonical_encoding TEXT NOT NULL CHECK (canonical_encoding = 'courseflow-canonical-json-v1'),
    digest_algorithm TEXT NOT NULL CHECK (digest_algorithm = 'sha256'),
    payload_digest BLOB NOT NULL CHECK (length(payload_digest) = 32),
    committed_revision INTEGER NOT NULL CHECK (committed_revision > 0),
    result_kind TEXT NOT NULL CHECK (result_kind = 'committed')
  ) STRICT;

  CREATE TABLE receipt_effects (
    command_id TEXT NOT NULL,
    effect_order INTEGER NOT NULL CHECK (effect_order >= 0),
    effect_code TEXT NOT NULL CHECK (effect_code = 'workspace.setup-decision-recorded'),
    entity_kind TEXT NOT NULL CHECK (entity_kind = 'workspace-setup'),
    entity_id TEXT NOT NULL,
    entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
    PRIMARY KEY (command_id, effect_order),
    FOREIGN KEY (command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE TABLE durable_followups (
    follow_up_id TEXT PRIMARY KEY,
    originating_command_id TEXT NOT NULL,
    owner TEXT NOT NULL CHECK (owner = 'protect'),
    kind TEXT NOT NULL CHECK (kind = 'backup-needed-through'),
    prerequisite_revision INTEGER NOT NULL CHECK (prerequisite_revision > 0),
    state TEXT NOT NULL CHECK (state = 'pending'),
    follow_up_version INTEGER NOT NULL CHECK (follow_up_version = 0),
    FOREIGN KEY (originating_command_id) REFERENCES command_receipts(command_id) ON DELETE RESTRICT
  ) STRICT;

  CREATE INDEX durable_followups_by_command
    ON durable_followups(originating_command_id);

  CREATE TABLE protection_watermarks (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    backup_needed_through INTEGER NOT NULL CHECK (backup_needed_through >= 0),
    backup_succeeded_through INTEGER NOT NULL CHECK (
      backup_succeeded_through >= 0
      AND backup_succeeded_through <= backup_needed_through
    ),
    FOREIGN KEY (singleton) REFERENCES workspace_state(singleton) ON DELETE RESTRICT
  ) STRICT;
  ~~~

  对 command/follow-up/entity ID 使用与 workspace_id 相同的 UUID CHECK；上面为避免重复只展示一次完整表达式，实现不得省略。validateSchemaLevel1 必须检查 application_id、user_version、六张表、STRICT、精确 column/type/PK/FK/index、无 user trigger/view、singleton/bootstrap 值、integrity_check 与 foreign_key_check。

- [ ] **Step 3: 实现 staged initialization 和单连接配置**

  DataSlotsRoot 下固定内部布局为 active/workspace.sqlite。首次显式初始化在同父唯一 .initialize-UUID/workspace.sqlite 中完成：

  ~~~text
  create staging directory
  open DatabaseSync with ADR-03 options
  set/read back WAL, FULL, foreign_keys=ON, trusted_schema=OFF
  BEGIN IMMEDIATE
    set application_id
    create six STRICT tables and required index
    seed workspace/setup/watermark singleton rows at Revision 0
    set user_version=1
  COMMIT
  close
  reopen read-only and validate exact level 1
  close
  rename staging directory to active
  reopen active as the sole long-lived read-write connection
  ~~~

  使用 DatabaseSync options：enableForeignKeyConstraints=true、enableDoubleQuotedStringLiterals=false、allowExtension=false、allowUnknownNamedParameters=false、defensive=true、bounded non-zero timeout。所有 Revision/EntityVersion statement 调用 setReadBigInts(true)；不得转为 Number。

  若 active 已存在，initialize 返回 stable conflict，不覆盖。已知失败在 activation 前只清理本次调用创建且仍非 active 的 staging；进程崩溃遗留 staging 不自动晋升、不自动删除。普通 open 不创建数据库；active 缺失返回 absent。

- [ ] **Step 4: 验证 schema 与重开**

  Run:

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test ".test-dist/tests/data/schema.test.js"
  pnpm typecheck
  ~~~

  Expected: PASS；四个初始化 failpoint 都没有产生半初始化 active；active 只有一个 workspace.sqlite；不存在 operations/draft/PLAN/ATTEND/LIBRARY/GRADE 表；关闭重开保持 WorkspaceId、level 1、Revision 0。

- [ ] **Step 5: 审阅并提交**

  ~~~powershell
  git add src/data/schema.ts src/data/sqlite-data-store.ts tests/data/schema.test.ts
  git commit -m "feat: initialize versioned workspace data"
  ~~~

### Task 3: 原子 commit、receipt、follow-up 与响应丢失收敛 — TEST-DATA-001/002

**Files:**

- Modify: src/data/sqlite-data-store.ts
- Create: tests/data/sqlite-data-store.test.ts
- Create: tests/data/sqlite-data-restart.fixture.ts

**Interfaces:**

- Consumes: RecordSetupDecisionCommand 和 32-byte digest
- Produces: commit(command): Promise<DataCommitResult>
- Produces: receipt(commandId): CommandReceiptOutcome | null
- Produces: readPendingFollowUps(): readonly DurableFollowUp[]
- Produces: readProtectionWatermark(): string
- Produces: pending follow-up + backup-needed-through 的原子持久化

**首先失败的测试（TEST-DATA-001/002）：** tests/data/sqlite-data-store.test.ts 与 sqlite-data-restart.fixture.ts 首先因 commit/receipt/failpoint API 不存在而失败；它们随后固定 pre-COMMIT 全无、post-COMMIT 全有和同 CommandId 重放/冲突。

**最小生产实现：** 在唯一长期连接上加入一个有界 FIFO、同步 BEGIN IMMEDIATE 事务、receipt/effect/follow-up/watermark 原子写入、digest 重放判定和可 drain 的 close；不增加 worker、第二连接或 connection pool。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、带 `TEST-DATA-001|TEST-DATA-002` pattern 的 sqlite-data-store `node --test`、`pnpm typecheck`。

**本地 commit：** `feat: persist atomic data commits`

- [ ] **Step 1: 写 commit/failpoint RED**

  一个 table-driven 子进程测试覆盖所有 commit.before-sqlite-commit 之前的语义点；fixture 在目标点调用 process.exit(73)。每次退出后由新 store 重开并断言：

  fixture 的唯一 CLI 为 node sqlite-data-restart.fixture.js DATA_SLOTS_ROOT DATA_FAILPOINT。父测试用 spawnSync(process.execPath, [fixturePath, dataSlotsRoot, point]) 启动；fixture 使用本计划的固定 WorkspaceId/CommandId/FollowUpId，打开已有 active、提交 decision later，并且只有到达精确 point 才 exit 73。exit 0 表示 failpoint 未命中，父测试必须立即失败。

  ~~~ts
  assert.deepEqual(reopen.readWorkspaceSetupSnapshot(), {
    revision: '0',
    setup: {
      workspaceId: WORKSPACE_ID,
      lastDecision: null,
      entityVersion: '0',
    },
  });
  assert.equal(reopen.receipt(COMMAND_ID), null);
  assert.deepEqual(reopen.readPendingFollowUps(), []);
  assert.equal(reopen.readProtectionWatermark(), '0');
  ~~~

  对 commit.after-sqlite-commit 使用同一 fixture，Expected exit 73，但重开必须得到 Revision 1、decision later、EntityVersion 1、matching receipt/effect/follow-up/watermark。

  同文件增加 TEST-DATA-002：post-COMMIT fixture 退出后先用新 store 重开，再以相同 CommandId + 同命令返回 deepEqual receipt outcome 且 Revision 保持 1；同一 store 上同时排入两个相同 CommandId/同 digest 的 commit，也只能得到一个 Revision 推进和两个语义相同 outcome；相同 ID 把 decision 改为 skip 返回 conflict/dataEffect unchanged，数据库仍为 Revision 1。

  Run compile/test；Expected: FAIL，因为 commit/receipt/failpoint 尚不存在。

- [ ] **Step 2: 实现唯一同步事务顺序**

  commit 的 queued work body 必须保持完全同步：

  ~~~text
  BEGIN IMMEDIATE
    read receipt by CommandId
      same digest -> materialize prior outcome; ROLLBACK read-only transaction body; no Revision change
      different digest -> conflict; ROLLBACK; dataEffect unchanged
    read workspace Revision and setup decision version as bigint
    compare expectedRevision and expectedSetupVersion
    update setup_state decision and version +1
    update workspace_state Revision +1
    insert command_receipts
    insert ordered receipt_effects
    insert durable_followups in pending state
    update protection_watermarks.backup_needed_through to new Revision
  COMMIT
  fire commit.after-sqlite-commit
  return committed outcome
  ~~~

  每个 SQL 使用固定代码内 statement 与绑定参数。constraint/expected-version/BUSY-before-commit 统一 rollback；rollback 自身不能掩盖“COMMIT 是否已执行”的判定。PostCommitChange 不在本工作包伪造；持久 follow-up/watermark 已是恢复真相。

- [ ] **Step 3: 实现 bounded FIFO 与 close/drain**

  SqliteDataStore 只保留一个队列和一个 running flag；enqueue 使用 queueMicrotask 启动 drain，每个 work item 同步执行到完成后再处理下一个。固定内部上限 64，只作为当前单用户背压边界，不暴露配置；满队列返回 operation-in-progress/dataEffect unchanged。close 停止接收、等待已接受 work 完成、清空 statement 引用后关闭唯一连接。

  不创建 worker、mutex dependency、第二 writer 或 reader pool。

- [ ] **Step 4: 验证原子性、重放和真实进程退出**

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test --test-name-pattern="TEST-DATA-001|TEST-DATA-002" ".test-dist/tests/data/sqlite-data-store.test.js"
  pnpm typecheck
  ~~~

  Expected: 全部 semantic failpoint PASS；pre-COMMIT 全无、post-COMMIT 全有；相同 digest 重放原 outcome，不同 payload/expected version/followUpId 复用 CommandId 均拒绝且不推进 Revision。

- [ ] **Step 5: 审阅并提交**

  ~~~powershell
  git add src/data/sqlite-data-store.ts tests/data/sqlite-data-store.test.ts tests/data/sqlite-data-restart.fixture.ts
  git commit -m "feat: persist atomic data commits"
  ~~~

### Task 4: 一致 ReadSnapshot 与 EntityVersion 冲突 — TEST-DATA-003

**Files:**

- Modify: src/data/sqlite-data-store.ts
- Modify: tests/data/sqlite-data-store.test.ts

**Interfaces:**

- Produces: readWorkspaceSetupSnapshot(options?: ReadSnapshotOptions): WorkspaceSetupSnapshot
- Guarantees: snapshot 全部字段来自一个 Revision；queued writer 不能穿过同步 read transaction
- Guarantees: stale expectedSetupVersion 不写 receipt/fact/revision/follow-up/watermark

**首先失败的测试（TEST-DATA-003）：** tests/data/sqlite-data-store.test.ts 的 stale EntityVersion 与 queued-writer snapshot 两个 case 因 ReadSnapshot API/transaction 尚未实现而失败。

**最小生产实现：** 在同一连接上实现一个同步短 read transaction，完整 materialize 当前 setup snapshot 后再把 bigint 版本转为 canonical decimal string；不实现历史 Revision 或 time-travel。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、带 `TEST-DATA-003` pattern 的 sqlite-data-store `node --test`、`pnpm typecheck`。

**本地 commit：** `feat: add consistent data snapshots`

- [ ] **Step 1: 写 stale-version 与并发 snapshot RED**

  第一条测试先提交 decision later，再用新 CommandId、expectedRevision=1、stale expectedSetupVersion=0 尝试 skip，断言 conflict、Revision 1、decision later、无第二 receipt。

  第二条在 read.after-revision failpoint 排入一个合法 writer：

  ~~~ts
  const SKIP_COMMAND_AT_VERSION_1 = normalizeRecordSetupDecisionCommand({
    commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    intent: {
      kind: 'workspace.record-setup-decision',
      intentSchemaVersion: 1,
      payload: { decision: 'skip' },
    },
    expectedRevision: '1',
    expectedSetupVersion: '1',
    followUpId: '33333333-3333-4333-8333-333333333333',
  });
  let queuedCommit: Promise<DataCommitResult> | undefined;
  const snapshot = store.readWorkspaceSetupSnapshot({
    failpoint(point) {
      if (point === 'read.after-revision') {
        queuedCommit = store.commit(SKIP_COMMAND_AT_VERSION_1);
      }
    },
  });

  assert.equal(snapshot.revision, '1');
  assert.equal(snapshot.setup.lastDecision, 'later');
  assert.equal(snapshot.setup.entityVersion, '1');
  assert.ok(queuedCommit);
  assert.equal((await queuedCommit).ok, true);
  assert.equal(store.readWorkspaceSetupSnapshot().revision, '2');
  ~~~

  Run targeted test；Expected: FAIL，因为 snapshot API/transaction 未实现。

- [ ] **Step 2: 实现短 read transaction**

  ~~~text
  BEGIN
    read workspace_state.revision as bigint
    trigger test-only read.after-revision callback
    read and fully materialize setup_state
  COMMIT
  convert bigint to canonical decimal strings
  Object.freeze the returned plain snapshot
  ~~~

  不返回 iterator/statement/DatabaseSync，不跨 await，不提供历史 Revision/time-travel。queued commit 只能在同步 read 完成后运行。

- [ ] **Step 3: 验证 TEST-DATA-003**

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test --test-name-pattern="TEST-DATA-003" ".test-dist/tests/data/sqlite-data-store.test.js"
  pnpm typecheck
  ~~~

  Expected: stale EntityVersion unchanged；并发调用得到完整 Revision 1 snapshot，随后 writer 得到 Revision 2；所有版本 DTO 都是 string，内部断言为 bigint。

- [ ] **Step 4: 审阅并提交**

  ~~~powershell
  git add src/data/sqlite-data-store.ts tests/data/sqlite-data-store.test.ts
  git commit -m "feat: add consistent data snapshots"
  ~~~

### Task 5: 打开分类、read-only 与不自动 reset — TEST-DATA-005/Q-EVOLVE-01

**Files:**

- Modify: src/data/schema.ts
- Modify: src/data/sqlite-data-store.ts
- Modify: tests/data/sqlite-data-store.test.ts

**Interfaces:**

- Produces: absent | ready | read-only | recovery 的封闭 DataOpenResult
- Produces: stable permission/incompatible-version/integrity/recovery-required problem；不携带 path/SQL/raw error

**首先失败的测试（TEST-DATA-005）：** tests/data/sqlite-data-store.test.ts 的 absent/current-read-only/future/corrupt/nonempty-level-0 table 首先失败，因为 open 只有 absent/ready 分类。

**最小生产实现：** 对 existing active 先只读验证 identity/version/manifest/integrity，再尝试长期读写连接；只有纯 writability 失败降为 read-only，其余无法证明安全的状态返回 recovery，绝不 reset 原文件。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、带 `TEST-DATA-005` pattern 的 sqlite-data-store `node --test`、`pnpm typecheck`。

**本地 commit：** `feat: classify workspace data opens`

- [ ] **Step 1: 写最小打开分类 RED**

  使用一个 table-driven test 覆盖 TEST-DATA-005 明确要求的最小等价类：

  1. active 不存在 → absent，磁盘不创建 DB；
  2. current level 1 以 readOnly=true 打开 → read-only，snapshot 可读，commit 返回 permission/unchanged；
  3. valid DB 的 user_version 改为 2 → recovery/incompatible-version，原 bytes 在失败 open 前后相等；
  4. application_id 改错 → recovery/integrity/wrong-application-id；
  5. 删除一个 required index 作为 missing-manifest 代表 → recovery/integrity/schema-mismatch；
  6. 关闭 FK 后制造一个 orphan 作为 foreign-key/integrity 代表 → recovery/integrity；
  7. workspace.sqlite 写入非 SQLite bytes → recovery/integrity/database-corrupt，文件不删除、不截断、不重建；
  8. existing nonempty level 0 → recovery/integrity/nonempty-level-zero，不执行 0→1。

  另用一个小表驱动 owner error mapper：SQLITE_BUSY → retryable unchanged，SQLITE_READONLY/permission → read-only，SQLITE_FULL/IOERR 在明确 COMMIT 前 → unchanged，在 COMMIT 边界无法证明结果 → 不返回 DataCommitResult、要求新 epoch 重开/receipt 收敛，重开仍不可判定才是 recovery-required。SQLite STRICT/CHECK 由 Task 2 的真实 DDL 写入拒绝证明，不再人为篡改 sqlite_schema；该 mapper 只验证稳定 primary-code + operation-stage 分类，不穷举 extended codes。

  Run targeted test；Expected: FAIL，当前 open 只有 absent/ready。

- [ ] **Step 2: 实现 read-only fallback 与严格停止**

  每次 existing DB 打开顺序固定：

  ~~~text
  verify active slot/file shape
  open read-only for identity and user_version classification
  stop immediately on wrong/future/nonempty-level-0
  validate exact current manifest, singleton facts, integrity_check, foreign_key_check
  attempt configured read-write long-lived connection
  if only writability fails, keep a configured read-only connection and return read-only
  if readability/integrity/commit outcome cannot be proven, close and return recovery
  ~~~

  current read-only 不运行 old-schema adapter，不写 pragma 文件状态、不迁移。future/wrong/corrupt 不读取领域事实。任何失败都不调用 unlink/rm/truncate/rename，不把原始 Error.message/code 暴露出 DATA owner。

- [ ] **Step 3: 验证 TEST-DATA-005**

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test --test-name-pattern="TEST-DATA-005" ".test-dist/tests/data/sqlite-data-store.test.js"
  pnpm typecheck
  ~~~

  Expected: 八个 table case 与四类稳定错误映射 PASS；read-only query 可用、write 明确拒绝；wrong-ID/schema/FK/future/corrupt/level-0 bytes 不被 reset。

- [ ] **Step 4: 审阅并提交**

  ~~~powershell
  git add src/data/schema.ts src/data/sqlite-data-store.ts tests/data/sqlite-data-store.test.ts
  git commit -m "feat: classify workspace data opens"
  ~~~

### Task 6: 接入现有 Workspace utility 调用链 — A-DATA-001/TEST-DATA-005

**Files:**

- Modify: src/shared/bootstrap-contract.ts
- Modify: src/main.ts
- Modify: src/workspace.ts
- Modify: src/renderer/main.tsx
- Modify: tests/shared/bootstrap-contract.test.ts
- Modify: tests/architecture/workspace-entry-boundary.test.ts
- Modify: tests/architecture/runtime-boundaries.test.ts

**Interfaces:**

- Consumes: openWorkspaceData(DataSlotsRoot)
- Produces: protocolVersion 2 BootstrapReady.workspaceEpoch/workspaceData
- Preserves: Renderer → preload → Main IPC → WorkspaceSupervisor → utility parentPort

**首先失败的测试（TEST-DATA-005；A-DATA-001 边界证据）：** bootstrap-contract、workspace-entry-boundary 与 runtime-boundaries tests 先因 protocol 仍为 1、DataSlotsRoot 未传入且 workspace.ts 仍拥有内存 SQLite probe 而失败。

**最小生产实现：** Main 仅把 verified DataSlotsRoot 作为 utility argv 传入；Workspace utility 启动一次 SqliteDataStore/open classification；bootstrap DTO 和 Renderer 只显示无路径状态，不增加 command channel。

**验证命令：** 依次运行 `pnpm run clean:test`、`pnpm run test:compile`、三个目标 contract/boundary 测试文件的 `node --test`、`pnpm test`、`pnpm typecheck`。

**本地 commit：** `feat: connect workspace persistent data`

- [ ] **Step 1: 写调用链 RED**

  bootstrap-contract tests 固定以下三个合法 status：absent、ready Revision 字符串、read-only typed problem；再固定 recovery problem 与 exact-key rejection。workspace boundary test 增加：

  ~~~ts
  assert.match(main, /utilityProcess\.fork[\s\S]*dataSlotsRoot/);
  assert.doesNotMatch(workspace, /from ['"]node:(?:fs|path|sqlite)['"]/);
  ~~~

  runtime-boundaries.test.ts 使用现有 productionSourcePaths/moduleSpecifiers helper 计算 importer：

  ~~~ts
  const nodeSqliteImporters = productionSourcePaths
    .filter((sourcePath) => moduleSpecifiers(state, sourceFor(state, sourcePath)).includes('node:sqlite'))
    .map((sourcePath) => path.relative(repositoryRoot, sourcePath).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(nodeSqliteImporters, [
    'src/data/schema.ts',
    'src/data/sqlite-data-store.ts',
  ]);
  ~~~

  bootstrap-contract.test.ts 对其中已声明的合法 ready fixture 运行 JSON.stringify，并断言不命中 DataSlots、workspace.sqlite、drive-qualified Windows path 或 /Users/。将 protocol 期望改为 2。Run targeted shared/architecture tests；Expected: FAIL，现有 DTO 缺少 workspaceEpoch/workspaceData，node:sqlite 仍由 src/workspace.ts 导入。

- [ ] **Step 2: Main 只传 verified root，不打开数据库**

  修改唯一 fork：

  ~~~ts
  const workspace = utilityProcess.fork(
    path.join(__dirname, 'workspace.js'),
    ['--courseflow-data-slots-root', roots.dataSlotsRoot],
    { serviceName: 'CourseFlow Workspace' },
  );
  ~~~

  参数名和值只由 Main 构造；Workspace 要求精确 marker + 一个非空值，缺失时返回 workspace-unavailable 并不 fallback。不得把 path 放入 WorkspaceProbeRequest。

- [ ] **Step 3: Workspace 启动一次 DATA owner 并返回无路径摘要**

  src/workspace.ts 在注册 parentPort message handler 前：

  ~~~text
  parse the one internal DataSlotsRoot argument
  generate one workspaceEpoch with randomUUID()
  call openWorkspaceData once
  retain the sole store when ready/read-only
  retain only the typed recovery/absent summary otherwise
  answer every bootstrap query from this stable process state
  close the store on normal process exit
  ~~~

  移除 probeWorkspace 内每次 new DatabaseSync(':memory:')。SQLite version 由 DATA adapter 在启动时读取；node:sqlite import 只存在于 src/data 下的 schema/store owner 文件。

- [ ] **Step 4: 扩展 exact DTO 并保持 UI 诚实**

  BOOTSTRAP_PROTOCOL_VERSION 改为 2。isBootstrapOutcome 对每个 WorkspaceDataStatus 分支检查 exact keys、canonical UUID/Revision、schemaLevel=1 和 closed problem details；拒绝 BigInt/Buffer/unknown fields。

  renderer 只增加最小文字分支：

  - absent：Workspace 进程已就绪；尚未创建本地工作区；
  - ready：本地数据已就绪；显示 Revision；
  - read-only：本地数据为只读，正式保存不可用；
  - recovery：本地数据需要恢复，不显示 ready。

  不增加按钮、command IPC、路由、表单或未来模块入口。smoke 允许 absent/ready，拒绝 read-only/recovery；输出 JSON 字段保持 appBuildId/sqliteVersion/dataRootClass，不加入路径、WorkspaceId 或 revision。

- [ ] **Step 5: 验证调用链与回归**

  ~~~powershell
  pnpm run clean:test
  pnpm run test:compile
  node --test ".test-dist/tests/shared/bootstrap-contract.test.js" ".test-dist/tests/architecture/workspace-entry-boundary.test.js" ".test-dist/tests/architecture/runtime-boundaries.test.js"
  pnpm test
  pnpm typecheck
  ~~~

  Expected: shared exact DTO、单 utility、唯一 SQLite owner、Renderer/preload 边界和全部既有测试 PASS；dependency lists 完全不变。

- [ ] **Step 6: 审阅并提交**

  ~~~powershell
  git add src/shared/bootstrap-contract.ts src/main.ts src/workspace.ts src/renderer/main.tsx tests/shared/bootstrap-contract.test.ts tests/architecture/workspace-entry-boundary.test.ts tests/architecture/runtime-boundaries.test.ts
  git commit -m "feat: connect workspace persistent data"
  ~~~

### Task 7: 全量验证、证据登记与关闭 WP-R2-01

**Files:**

- Modify: docs/roadmap/BACKLOG.md

**Interfaces:**

- Consumes: Tasks 1–6 的提交和验证结果
- Produces: WP-R2-01 Done 证据，或保持 Verification/Blocked 的真实状态

**首先失败的测试（TEST-DATA-001/002/003/005）：** 本 Task 不新增 RED；`pnpm test` 中第一个未通过的目标 TEST 即停止关闭流程，BACKLOG 保持 Verification 并记录真实失败。

**最小生产实现：** 无生产实现；只验证 Tasks 1–6、审阅范围并在全部适用门通过后更新 docs/roadmap/BACKLOG.md。

**验证命令：** 依次运行 `pnpm test`、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged`、`git diff --check`，再执行列出的范围扫描。

**本地 commit：** `docs: close wp-r2-01`

- [ ] **Step 1: 进入 Verification，先运行最小到扩展门**

  把 WP-R2-01 从 In Progress 改为 Verification，但暂不提交。若 Codex Desktop PATH 无 node，先调用 workspace dependency runtime，仅把其 Node bin 临时加入当前 PowerShell PATH。

  Run:

  ~~~powershell
  pnpm test
  pnpm typecheck
  pnpm package
  pnpm smoke:packaged
  git diff --check
  ~~~

  Expected:

  - TEST-DATA-001/002/003/005 全部有命名输出并 PASS；
  - typecheck PASS；
  - Windows x64 package 与 smoke PASS，stdout 仍只有允许的 smoke JSON 且无路径/WorkspaceId/revision；
  - 未增加 dependencies/devDependencies；
  - macOS arm64 仍明确未验证，WP-R1-05 evidence dependency 保持开放。

  任一目标 TEST、typecheck、package 或当前 Windows smoke 失败时，不把 WP 标 Done；保持 Verification，记录真实失败和最后成功边界。

- [ ] **Step 2: 审阅最终实现范围**

  Run:

  ~~~powershell
  rg -n "node:sqlite" src
  rg -n "drizzle|kysely|sequelize|typeorm|better-sqlite3|SQLTagStore|schema_migrations|CREATE TABLE.*(?:grade|attend|library|term|course|operation|draft)" src package.json
  git diff --stat HEAD~6..HEAD
  git diff HEAD~6..HEAD -- src tests package.json pnpm-lock.yaml docs/roadmap/BACKLOG.md
  git status --short
  ~~~

  Expected: node:sqlite 只在 src/data/schema.ts 与 src/data/sqlite-data-store.ts；第二条无命中；package/lockfile 无 diff；所有变化均属于本计划文件图。

- [ ] **Step 3: 自审 TEST 追溯和 schema 边界**

  人工逐项确认：

  - TEST-DATA-001：每个 semantic pre-COMMIT failpoint 全无，post-COMMIT response loss 全有；
  - TEST-DATA-002：golden digest、同 ID 同 digest 跨并发/重启重放、同 ID 不同 payload/expected/follow-up 拒绝；
  - TEST-DATA-003：stale EntityVersion unchanged、queued writer 不混 ReadSnapshot；
  - TEST-DATA-005：read-only 可读不可写、wrong ID/missing manifest/FK/future/corrupt/nonempty-level-0 recovery、BUSY/FULL/IOERR 稳定分类、无 reset；
  - schema 只有六张共同表，level 1 尚未公开冻结；
  - DTO 中没有 path、DatabaseSync、StatementSync、Buffer、bigint、Error 或 raw SQLite problem；
  - C1/C2、未来模块、ORM、连接池、额外依赖均未出现。

- [ ] **Step 4: 登记证据并提交关闭**

  在 BACKLOG：

  1. WP-R2-01 Verification → Done；
  2. WP-R2-02 — → Ready；
  3. 追加日期、Tasks 1–6 source commit、实际命令/计数、schema level/表、failpoint/restart 结果、Windows packaged smoke 和 macOS 未验证项；
  4. 明确“Done 不关闭 WP-R1-05 或最终双平台 release Gate，也不声明 C1/C2/备份/恢复已实现”。

  然后：

  ~~~powershell
  git add docs/roadmap/BACKLOG.md
  git commit -m "docs: close wp-r2-01"
  git status --short --branch
  ~~~

  Expected: commit 成功，本任务改动均已提交。报告最终 commit hash；push/amend 按当前明确授权处理。若授权仅覆盖 WP-R2-01，到此结束；已授权后续工作时，按 Backlog 硬依赖继续。

## Plan Self-Review Checklist

- Spec coverage：A-DATA-001、MOD-DATA、IF-DATA-READ、IF-DATA-COMMIT、IF-DATA-RECEIPT、FLOW-01、Q-TRUTH-01/Q-CONSIST-01/Q-EVOLVE-01 与四个目标 TEST 均映射到至少一个 Task。
- Placeholder scan：计划不含未定义函数、未命名文件、通用“补错误处理”步骤或省略的 sibling task。
- Type consistency：RecordSetupDecisionCommand、WorkspaceDataStatus、DataFailpoint、Revision/EntityVersion string 和 commit/receipt/snapshot 名称在所有 Task 一致。
- Scope check：共同 schema、level 1 未冻结状态和延后内容明确；没有 C1/C2、未来模块、ORM、连接池、额外依赖或第二 DATA implementation。
- Test restraint：只使用目标 TEST 的 table-driven equivalence classes 和一次真实子进程重启；不增加 fuzz、性能、全平台文件系统破坏或与本 WP 无关的 UI E2E。
