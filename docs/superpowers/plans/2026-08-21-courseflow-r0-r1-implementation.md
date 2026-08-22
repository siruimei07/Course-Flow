# CourseFlow R0–R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 把已批准的首发剖面写回规范，并交付一个可重复安装依赖、可类型检查、可测试、可打包的 Electron/React/TypeScript walking skeleton；Main 监督单一 Workspace utility process，打包产物通过精确 build 握手、稳定开发数据根和内存 SQLite 探针。

**Architecture:** R0 只修正上游语义和追溯状态。R1 使用 Electron Main 作为唯一平台/窗口/utility supervisor，sandboxed preload 只暴露一个只读 bootstrap Query，Renderer 只消费 plain DTO；Workspace utility process 使用 `node:sqlite` 做真实运行时探针。R1 不建立正式 schema、领域模块、持久日志、遥测、崩溃收集、安装器或 C1/C2 接缝。

**Tech Stack:** pnpm 11.19.0；Electron 43.4.1；Electron Forge 7.11.2 + 官方 Vite plugin；React/React DOM 19.2.8；TypeScript 7.0.2；Vite 8.2.2；Node 24 内置 test runner 与 `node:sqlite`。所有版本精确锁定，以 `WP-R0-03` 的官方复核结果为进入条件。

**Spec:** [Approved Roadmap Design](../specs/2026-08-21-courseflow-implementation-roadmap-design.md)；[Roadmap](../../roadmap/ROADMAP.md)；[Backlog](../../roadmap/BACKLOG.md)。

## Global Constraints

- 开始每个任务前先读根 [AGENTS.md](../../../AGENTS.md)、检查 `git status --short --branch`，并确认没有覆盖用户改动。
- 适用技术决策必须引用 `ADR-01`、`ADR-02`、`ADR-03`、`ADR-04`、`ADR-09`、`ADR-10`；不得在实现中改选运行时、进程模型、数据协议或更新模型。
- 首发只含 MVP-A + MVP-A-P + MVP-B。R1 不得创建 `grade`、`target`、未来 module registry、空路由、schema 表或 feature flag。
- Shell/Renderer 只能经 Workspace Query 取得状态；Renderer 不得 import `electron`、`node:*`、文件系统、真实路径、MessagePort 或 SQLite 类型。
- R1 只用 `io.github.siruimei07.courseflow.dev` 与 `CourseFlow Dev` 开发身份；不得读取、创建或迁移正式 CourseFlow 数据根。
- 不启动 `crashReporter`，不写持久日志，不加入遥测、support bundle、远程请求或自动更新依赖。烟测只向当前进程 stdout 输出一行结果。
- 每个任务先留下会失败的最小测试/检查，再做最短正确实现。任务结束时更新 Backlog 状态和证据台账、运行指定验证、审阅 diff，并创建一个本地提交；不 push、不 amend。
- 若 macOS 或签名资源不可用，明确记录 `未验证`/`Blocked`；不得由 Windows 结果推断通过，也不得为了“关闭”R1 Gate 伪造平台证据。

### Task 1: `WP-R0-01` — 固化首发剖面与临近截止语义

**Files:**

- Modify: `docs/product/PRD.md`
- Modify: `docs/product/MVP_SCOPE.md`
- Modify: `docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md`
- Modify: `docs/roadmap/BACKLOG.md`

**Target:** 61 条首发 Requirement；19 个首发 UI 表面；五项主导航；已批准 `near-due` 边界。此任务不修改 Architecture/Contracts，它们属于 Task 2。

- [ ] **Step 1: 领取工作包并记录当前失败证据**

  将 `WP-R0-01` 从 `Ready` 改为 `In Progress`，在证据台账追加领取记录。运行：

  ```powershell
  rg -n "GAP-PRODUCT-01|固定浅色|外观预留|六个主导航|六项主导航|临近截止|即将到期" docs/product docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md docs/architecture/MODULE_CONTRACTS.md
  ```

  预期：命中未定义阈值、固定浅色预留位和六项导航，证明现状尚未满足已批准首发剖面。把命中摘要写入该工作包证据行。

- [ ] **Step 2: 在 PRD 拥有“临近截止”规则**

  在 `A-VIEW-*` 所在产品行为段增加唯一规则，必须逐项表达：

  - 候选任务是 `pending`、未 `skipped` 且 deadline 已知；TBA 不进入该集合。
  - `today` 是按 `TermZone` 取得的当前 `LocalDate`。
  - date-only deadline 使用其 `LocalDate`；timed deadline 先按已存 zone context 投影到 `TermZone` 的 `LocalDate`。
  - `near-due` 闭区间为 `today + 1 day` 至 `today + 7 days`。
  - 当天由 Today/overdue 规则承载；`today + 8 days` 及更远不属于 near-due。
  - 阈值不可配置，首发没有设置入口。

  在 `A-VIEW-004` 的核心验收加入 day+1、day+7、day+8、TBA、completed、skipped 的判定示例。不要把该算法复制到 UI 规格。

- [ ] **Step 3: 在 MVP_SCOPE 固化首发发布剖面**

  增加“首个公开版本”小节，明确 `MVP-A + MVP-A-P + MVP-B` 全部纳入，C1/C2 排除；列出 61/19/5 的计数和五项导航。声明 C1/C2 不产生代码、schema、导航、占位接口、feature flag 或兼容层。

- [ ] **Step 4: 校准 UI 规格而不删除未来 C1 设计**

  在文档开头增加发布剖面说明：完整产品设计仍有 24 个表面，其中 5 个 `UI-GRADE-*` 是 C1 未来设计；首发只验收其余 19 个。修改全局导航为 `Today`、`Courses`、`Calendar`、`Tasks`、`Files` 五项，并把 Grade 导航明确留在 C1 未来剖面，而不是禁用入口。

  删除三处固定浅色/深色“预留位”文字。顶栏右侧只保留首发真实存在的设置入口；设置分类中删除首发未实现的成绩模板与外观入口，C1 页面段本身继续保留为未来设计。把“六个主导航”验收改为首发五项。

- [ ] **Step 5: 运行产品层检查**

  ```powershell
  rg -n "today \+ 1|today \+ 7|today \+ 8|TermZone|61 条|19 个|Today.*Courses.*Calendar.*Tasks.*Files" docs/product/PRD.md docs/product/MVP_SCOPE.md docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md
  rg -n "固定浅色|外观预留|六个主导航|六项主导航" docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md
  ```

  预期：第一条命令能定位全部批准边界；第二条无输出。人工核对 Grade 五个页面仍存在且被标为首发范围外。

- [ ] **Step 6: 关闭工作包并提交**

  将 `WP-R0-01` 设为 `Done`，`WP-R0-02` 与 `WP-R0-03` 设为 `Ready`；证据台账记录检查结果和提交意图。运行 `git diff --check`、审阅 `git diff -- docs/product docs/superpowers/specs docs/roadmap/BACKLOG.md`，然后提交：

  ```powershell
  git add docs/product/PRD.md docs/product/MVP_SCOPE.md docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md docs/roadmap/BACKLOG.md
  git commit -m "docs: calibrate first release profile"
  ```

### Task 2: `WP-R0-02` — 升级实现基线与首发追溯

**Files:**

- Modify: `docs/superpowers/specs/2026-08-17-user-flow-design.md`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/MODULE_CONTRACTS.md`
- Modify: `docs/roadmap/BACKLOG.md`

**Target:** 规范状态、首发剖面和 19/24 UI 表面描述一致；不删除 `MOD-GRADE` 或未来 C1 契约设计。

- [ ] **Step 1: 领取并证明现状不一致**

  将 `WP-R0-02` 设为 `In Progress`。运行：

  ```powershell
  rg -n "待用户审阅书面规格|候选架构基线|候选规范|GAP-PRODUCT-01|24 个正式页面|24 个 UI 表面" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture
  ```

  预期：命中待终审状态、开放 GAP 和把 24 个表面硬编码为当前发布验收的文字。

- [ ] **Step 2: 更新 User Flow 与 Architecture 状态**

  将 User Flow 状态改为“已批准实现基线”。将 Architecture 状态改为“已批准实现基线”，递增其小版本，并在范围段增加首发剖面说明：架构继续描述已批准的 C1 边界，但首个公开版本只实例化 MVP-A/A-P/B；首发实现不得创建 `MOD-GRADE` 运行时/schema。不要删除 C1 的未来架构设计。

- [ ] **Step 3: 关闭产品 GAP 并使 Contracts release-profile-aware**

  将 Contracts 状态改为“已批准实现基线”并递增小版本。把 `GAP-PRODUCT-01` 改为已解决记录，引用 Task 1 的 PRD 所有者，不在 Contracts 再复制算法。

  修改 `TEST-SHELL-004`：首发剖面检查 19 个正式表面；完整已批准产品设计仍有 24 个表面，C1 未进入首发构建。修改 §11.5 的计数说明与终审清单，使其分别列出“首发 19 / 完整设计 24”，而不是把 24 当作首发实现前提。

- [ ] **Step 4: 检查稳定 ID 与状态**

  ```powershell
  rg -n "已批准实现基线|首发 19|完整.*24|GAP-PRODUCT-01.*已解决" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture
  rg -n "候选架构基线|候选规范|待用户审阅书面规格|24 个正式页面只使用" docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture
  git diff --check
  ```

  预期：第一组均可定位；第二组无旧状态/旧硬编码命中。用 `rg -o` 对比修改前后 Requirement/MOD/IF/FLOW/Q/TEST ID 集合，除文字状态外不得丢失稳定 ID。

- [ ] **Step 5: 关闭并提交**

  将 `WP-R0-02` 设为 `Done`，保留 `WP-R0-03` 为 `Ready`，更新证据台账。审阅 diff 后提交：

  ```powershell
  git add docs/superpowers/specs/2026-08-17-user-flow-design.md docs/architecture/ARCHITECTURE.md docs/architecture/MODULE_CONTRACTS.md docs/roadmap/BACKLOG.md
  git commit -m "docs: approve implementation baseline"
  ```

### Task 3: `WP-R0-03` — 复核工具、版本与发布资源

**Files:**

- Modify: `docs/roadmap/BACKLOG.md`

**Target:** 把查询时点的事实写入资源矩阵；资源缺失不阻止完成“事实盘点”，但继续阻塞依赖它的 Gate。

- [ ] **Step 1: 领取并发现当前工具，不使用 ATTEMPT.md**

  将 `WP-R0-03` 设为 `In Progress`。先运行 `Get-Command node,npm,pnpm -ErrorAction SilentlyContinue`。若 PATH 不含 Node/pnpm，调用 workspace dependency runtime 定位本线程捆绑的 Node 与 pnpm，把 Node `bin` 临时加入本次 PowerShell 的 PATH；不得把个人绝对缓存路径写入仓库。

  记录实际结果：`node --version`、`pnpm --version`、`git --version`、`[System.Environment]::OSVersion`、`$env:PROCESSOR_ARCHITECTURE`。

- [ ] **Step 2: 从官方来源与注册表复核精确版本**

  查阅 [Electron releases](https://releases.electronjs.org/)、[Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)、[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[Electron parentPort](https://www.electronjs.org/docs/latest/api/parent-port)、[Node test runner](https://nodejs.org/api/test.html) 与 [Node SQLite](https://nodejs.org/api/sqlite.html)。只把直接支持选择的官方事实写入证据。

  运行：

  ```powershell
  pnpm view electron@43.4.1 version engines license
  pnpm view @electron-forge/cli@7.11.2 version engines license
  pnpm view @electron-forge/plugin-vite@7.11.2 version peerDependencies license
  pnpm view react@19.2.8 version license
  pnpm view react-dom@19.2.8 version license
  pnpm view typescript@7.0.2 version engines license
  pnpm view vite@8.2.2 version engines license
  pnpm view @types/node@24.13.3 version
  pnpm view @types/react@19.2.18 version
  pnpm view @types/react-dom@19.2.4 version
  ```

  预期：精确版本都可解析，许可证可接受，Node 24.19.0 满足 engine/peer 要求。若任一事实不成立，停止 R1，先按 ADR-10 提出最小修订；不得静默换版。

- [ ] **Step 3: 盘点发布资源**

  对 Backlog §5 的七项资源逐项给出 `已验证`、`不可用` 或 `未验证（原因）`，并记录证据日期。当前主机只能证明自身平台；Apple Developer/notary、Windows 签名或 GitHub Releases 权限只有实际登录/签名/上传检查才能标为已验证，不从环境变量名或用户陈述推断。

- [ ] **Step 4: 关闭 R0 并提交**

  在证据台账记录版本查询摘要和资源缺口。将 `WP-R0-03` 设为 `Done`，将 `WP-R1-01` 设为 `Ready`。运行 `git diff --check` 并提交：

  ```powershell
  git add docs/roadmap/BACKLOG.md
  git commit -m "docs: record implementation preflight"
  ```

### Task 4: `WP-R1-01` — 建立精确锁定的最小工具链

**Files:**

- Modify: `.gitignore`
- Create: `.npmrc`
- Create: `package.json`
- Create: `pnpm-lock.yaml` (generated by pnpm)
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `forge.config.ts`
- Create: `vite.node.config.ts`
- Create: `vite.renderer.config.ts`
- Create: `build/read-development-build-id.ts`
- Create: `src/vite-env.d.ts`
- Modify: `docs/roadmap/BACKLOG.md`

**Target ADRs:** ADR-01、ADR-02、ADR-09、ADR-10。R1 只执行 `forge package`，不安装 maker、publisher、auto-updater、logger 或测试框架。

- [ ] **Step 1: 领取并留下工具链缺失证据**

  将 `WP-R1-01` 设为 `In Progress`。运行：

  ```powershell
  Test-Path package.json
  Test-Path pnpm-lock.yaml
  ```

  预期：二者为 `False`，证明当前尚无实现工具链。

- [ ] **Step 2: 写最小包清单与 pnpm 策略**

  `.npmrc` 只包含：

  ```ini
  node-linker=hoisted
  save-exact=true
  ```

  `package.json` 使用下列完整基线：

  ```json
  {
    "name": "courseflow",
    "productName": "CourseFlow Dev",
    "version": "0.0.0",
    "private": true,
    "license": "UNLICENSED",
    "description": "Local-first desktop planning workspace for university students.",
    "main": ".vite/build/main.js",
    "packageManager": "pnpm@11.19.0",
    "engines": {
      "node": ">=24.19.0 <25",
      "pnpm": "11.19.0"
    },
    "scripts": {
      "start": "electron-forge start",
      "package": "electron-forge package",
      "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json",
      "clean:test": "node -e \"require('node:fs').rmSync('.test-dist',{recursive:true,force:true})\"",
      "test:compile": "tsc -p tsconfig.test.json",
      "test": "pnpm run clean:test && pnpm run test:compile && node --test \".test-dist/tests/**/*.test.js\"",
      "smoke:packaged": "node scripts/run-packaged-smoke.mjs"
    },
    "dependencies": {
      "react": "19.2.8",
      "react-dom": "19.2.8"
    },
    "devDependencies": {
      "@electron-forge/cli": "7.11.2",
      "@electron-forge/plugin-vite": "7.11.2",
      "@types/node": "24.13.3",
      "@types/react": "19.2.18",
      "@types/react-dom": "19.2.4",
      "electron": "43.4.1",
      "typescript": "7.0.2",
      "vite": "8.2.2"
    }
  }
  ```

  在 `.gitignore` 追加且只追加 `node_modules/`、`.vite/`、`.test-dist/`、`out/`。

- [ ] **Step 3: 写 TypeScript 配置**

  `tsconfig.json` 使用 `target: ES2023`、`module: ESNext`、`moduleResolution: Bundler`、`strict: true`、`jsx: react-jsx`、`isolatedModules: true`、`noEmit: true`、`skipLibCheck: true`、`esModuleInterop: true`，`lib` 为 `ES2023/DOM/DOM.Iterable`，`types` 为 `node`，并 include `build`、`src`、三个根配置文件和 `tests`。

  `tsconfig.test.json` extends 主配置，覆盖 `module: CommonJS`、`moduleResolution: Node`、`noEmit: false`、`rootDir: .`、`outDir: .test-dist`、`declaration: false`、`sourceMap: false`，include `src/shared/**/*.ts`、`src/main/runtime-paths.ts`、`tests/**/*.ts`。

- [ ] **Step 4: 写唯一开发 build identity 读取器**

  `build/read-development-build-id.ts` 导出 `readDevelopmentBuildId(): string`。它用 `execFileSync('git', ['rev-parse', 'HEAD'])` 取得 40 位 commit；再用 `git status --porcelain` 判定脏树，返回 `development:<commit>` 或 `development:<commit>:dirty`。命令失败或 commit 不是 40 位小写 hex 时直接抛错，不回退到时间戳、package version 或随机值。

- [ ] **Step 5: 写 Forge/Vite 配置**

  `forge.config.ts` 的 `packagerConfig` 只设置 `asar: true`、`name: 'CourseFlow Dev'`、`executableName: 'CourseFlow Dev'`、`appBundleId: 'io.github.siruimei07.courseflow.dev'`；`makers: []`。配置一个官方 `VitePlugin`，其 `build` 精确包含：

  ```ts
  { entry: 'src/main.ts', config: 'vite.node.config.ts', target: 'main' }
  { entry: 'src/preload.ts', config: 'vite.node.config.ts', target: 'preload' }
  { entry: 'src/workspace.ts', config: 'vite.node.config.ts', target: 'workspace' }
  ```

  renderer 只包含 `{ name: 'main_window', config: 'vite.renderer.config.ts' }`。

  两个 Vite 配置都调用同一个 `readDevelopmentBuildId()`，以 `define` 注入 `__COURSEFLOW_APP_BUILD_ID__`。Node 配置 externalize `electron`，renderer `root` 为 `src/renderer`，二者均关闭 sourcemap、关闭 minify，renderer `base` 为 `./`。不要加入 React plugin；Vite 对 TSX 的内置转换已足够，R1 不需要 Fast Refresh plugin。

  `src/vite-env.d.ts` 引用 `@electron-forge/plugin-vite/forge-vite-env`，并声明只读字符串常量 `__COURSEFLOW_APP_BUILD_ID__`。

- [ ] **Step 6: 安装并证明锁文件精确**

  ```powershell
  pnpm install --frozen-lockfile=false
  pnpm list --depth 0
  pnpm exec tsc --version
  pnpm exec electron --version
  ```

  预期：生成 `pnpm-lock.yaml`；顶层版本与 `package.json` 完全一致；TypeScript 为 7.0.2，Electron 为 43.4.1。检查 `package.json` 没有 maker、publisher、auto-updater、logger、Vitest/Jest、Testing Library、router 或状态库；不要把 Forge 自身可能使用的传递内部包误判为项目选型。

- [ ] **Step 7: 关闭并提交**

  此时尚无 `src/main.ts`，所以不把 `pnpm typecheck` 当作成功条件；运行 `pnpm exec tsc --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --types node build/read-development-build-id.ts forge.config.ts vite.node.config.ts vite.renderer.config.ts` 验证配置本身。将 `WP-R1-01` 设为 `Done`，`WP-R1-02` 设为 `Ready`，更新证据台账，运行 `git diff --check` 后提交：

  ```powershell
  git add .gitignore .npmrc package.json pnpm-lock.yaml tsconfig.json tsconfig.test.json forge.config.ts vite.node.config.ts vite.renderer.config.ts build/read-development-build-id.ts src/vite-env.d.ts docs/roadmap/BACKLOG.md
  git commit -m "build: establish desktop toolchain"
  ```

### Task 5: `WP-R1-02`（一）— 先定义最小 bootstrap 契约

**Files:**

- Create: `src/shared/bootstrap-contract.ts`
- Create: `tests/shared/bootstrap-contract.test.ts`
- Modify: `docs/roadmap/BACKLOG.md`

**Target contracts:** `IF-WORKSPACE` 的只读 bootstrap Query 子集、`IF-STRUCTURED-PROBLEM` 的最小 plain DTO 表达；不增加 Command、订阅或未来 capability。

- [ ] **Step 1: 领取工作包并先写失败测试**

  将 `WP-R1-02` 设为 `In Progress`。创建测试，至少覆盖：

  1. `makeBootstrapRequest('req-1', buildId)` 只产生四个字段：`kind`、`protocolVersion`、`appBuildId`、`requestId`。
  2. request build 不匹配、协议不是 `1`、空 requestId、额外字段、数组或 `null` 均被拒绝。
  3. success outcome 必须精确关联同一 request/build/protocol，并明确 `workspaceProcess: 'ready'`。
  4. problem outcome 只接受规范 code 和非空 message；响应 requestId/build 不匹配时被拒绝。

  运行 `pnpm test`。预期：编译失败，原因是 `src/shared/bootstrap-contract.ts` 不存在。

- [ ] **Step 2: 实现完整、窄且可验证的 DTO**

  `bootstrap-contract.ts` 必须导出以下公共形状：

  ```ts
  export const BOOTSTRAP_PROTOCOL_VERSION = 1 as const;
  export const WORKSPACE_QUERY_CHANNEL = 'courseflow:workspace-query' as const;

  export type BootstrapRequest = Readonly<{
    kind: 'bootstrap.status';
    protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
    appBuildId: string;
    requestId: string;
  }>;

  export type BootstrapReady = Readonly<{
    protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
    appBuildId: string;
    requestId: string;
    workspaceProcess: 'ready';
  }>;

  export type BootstrapProblemCode =
    | 'invalid-request'
    | 'build-mismatch'
    | 'workspace-unavailable';

  export type BootstrapOutcome =
    | Readonly<{ ok: true; value: BootstrapReady }>
    | Readonly<{
        ok: false;
        problem: Readonly<{
          code: BootstrapProblemCode;
          message: string;
          requestId: string | null;
          appBuildId: string;
        }>;
      }>;
  ```

  同文件实现 `makeBootstrapRequest`、`makeBootstrapProblem`、`isBootstrapRequest(value, expectedBuildId)` 与 `isBootstrapOutcome(value, expectedBuildId, expectedRequestId)`。所有 guard 必须先确认 plain object，再检查字段类型、固定 literal、非空字符串和**只含允许键**；只在这个信任边界检查一次，后续消费已验证 DTO。Task 8 只有在真实本地根与 SQLite 探针存在后才扩展 ready DTO，不在这里预建字段。不要加入 schema library。

- [ ] **Step 3: 运行测试与类型检查**

  ```powershell
  pnpm test
  pnpm typecheck
  ```

  预期：bootstrap 契约测试全部通过；主类型检查只可能因下一任务尚未创建 Forge 入口而失败。若主配置把缺少的显式入口报告为错误，先只运行 `pnpm exec tsc --noEmit -p tsconfig.test.json` 并在证据中准确记录，不能声称完整 typecheck 已通过。

- [ ] **Step 4: 提交契约切片**

  保持 `WP-R1-02` 为 `In Progress`，在证据台账记录测试结果。运行 `git diff --check` 后提交：

  ```powershell
  git add src/shared/bootstrap-contract.ts tests/shared/bootstrap-contract.test.ts docs/roadmap/BACKLOG.md
  git commit -m "test: define workspace bootstrap contract"
  ```

### Task 6: `WP-R1-02`（二）— 打通安全 Main/preload/renderer 壳

**Files:**

- Create: `src/main.ts`
- Create: `src/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/styles.css`
- Create: `tests/architecture/renderer-boundary.test.ts`
- Modify: `docs/roadmap/BACKLOG.md`

**Target:** 打包后真实打开一个最小窗口；此任务不伪造 Workspace ready，Query 在 Task 7 接通。

- [ ] **Step 1: 先写 Renderer 边界失败测试**

  测试用 `node:fs` 读取 `src/renderer` 下的 `.ts/.tsx` 文件，断言不存在以下 import/require specifier：`electron`、`node:*`、`fs`、`path`、`sqlite`；也不存在 `ipcRenderer`、`MessagePort`、`process.env`、绝对 Windows/macOS 路径字符串。再读取 `src/main.ts`，断言 BrowserWindow 明确设置 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。

  运行 `pnpm test`。预期：因入口文件不存在而失败。

- [ ] **Step 2: 实现 Main 的最小窗口生命周期**

  `src/main.ts` 只 import Electron 的 `app`/`BrowserWindow` 和 `node:path`。创建 `createWindow(options?: { show?: boolean })`，BrowserWindow 使用：

  ```ts
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true
  }
  ```

  开发时加载 `MAIN_WINDOW_VITE_DEV_SERVER_URL`；打包时加载 `path.join(__dirname, '../renderer', MAIN_WINDOW_VITE_NAME, 'index.html')`。正常 `window-all-closed` 在非 macOS 退出，`activate` 时无窗口则重建。不要启动 crash reporter、日志、更新器或网络请求。

  `src/preload.ts` 当前只包含 `export {}`，不暴露空对象或未来 API；Task 7 会在真实 Query 可用时一次性增加唯一 capability。

- [ ] **Step 3: 实现真实但最小的 React 壳**

  `index.html` 只含 UTF-8、viewport、标题、`<div id="root"></div>` 和 `/main.tsx` module script。`main.tsx` 用 `createRoot` 渲染：产品名 `CourseFlow`、说明“本地优先课程工作区”、可感知状态“桌面运行时已启动”。不得出现五项导航、模拟课程/任务、Grade、登录、AI、主题或禁用入口；这些不属于 R1。

  CSS 只提供可读布局、系统字体、可见 focus 样式与 `prefers-reduced-motion` 下无动画；状态不能只用颜色表达。

- [ ] **Step 4: 验证开发壳和打包壳**

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm package
  ```

  预期：测试/类型检查通过；`out/` 生成当前平台包。实际启动当前平台可执行文件，确认窗口显示真实壳且无开发服务器依赖，然后正常退出。此处只登记当前平台观察，不把它当作 `WP-R1-05` 双平台证据。

- [ ] **Step 5: 关闭并提交**

  将 `WP-R1-02` 设为 `Done`，`WP-R1-03` 设为 `Ready`，更新证据台账。运行 `git diff --check`，确认 `out/`、`.vite/`、`.test-dist/` 未被跟踪，然后提交：

  ```powershell
  git add src/main.ts src/preload.ts src/renderer tests/architecture/renderer-boundary.test.ts docs/roadmap/BACKLOG.md
  git commit -m "feat: add packaged desktop shell"
  ```

### Task 7: `WP-R1-03` — 接通单一 Workspace utility process

**Files:**

- Create: `src/main/workspace-supervisor.ts`
- Create: `src/workspace.ts`
- Create: `tests/architecture/workspace-entry-boundary.test.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/renderer/main.tsx`
- Create: `src/renderer/global.d.ts`
- Modify: `docs/roadmap/BACKLOG.md`

**Target ADRs/contracts:** ADR-02 单一 utility process；ADR-04 精确 `appBuildId`/protocol；Renderer 仍只见 plain DTO。真实本地根和 SQLite 探针属于后继 `WP-R1-04`。

- [ ] **Step 1: 领取并先写进程边界失败测试**

  将 `WP-R1-03` 设为 `In Progress`。新增测试读取生产入口，断言：`utilityProcess.fork` 恰好一处；目标文件固定为打包同目录的 `workspace.js`；Workspace 只使用 `process.parentPort` 与 plain DTO，不 import BrowserWindow/renderer/文件系统；Main 与 preload 都使用同一 `WORKSPACE_QUERY_CHANNEL`，而 Renderer 不含 channel 字符串。运行 `pnpm test`，预期因 Workspace 入口和 supervisor 不存在而失败。

- [ ] **Step 2: 实现 Workspace utility 入口**

  `src/workspace.ts`：

  - 取得 `process.parentPort`；缺失时立即抛错，不能改走 stdout/IPC fallback。
  - 对每个 `message` 的 `event.data` 调用 `isBootstrapRequest(raw, __COURSEFLOW_APP_BUILD_ID__)`。
  - request 非法时返回 `invalid-request` 或 `build-mismatch` problem；合法时返回包含同一 protocol/build/requestId 和 `workspaceProcess: 'ready'` 的 success outcome。
  - 不写日志、不读取 env、不访问 SQLite、文件系统或真实路径。Task 8 会在真实 probe 到位后替换这份最小 ready 实现，而不是并行保留两个协议。

- [ ] **Step 3: 实现 Main supervisor**

  `src/main/workspace-supervisor.ts` 只拥有一个 `UtilityProcess`。导出 `WorkspaceSupervisor`，构造参数为 `appBuildId` 与已 fork 的 child；公开方法：

  ```ts
  query(request: BootstrapRequest): Promise<BootstrapOutcome>
  dispose(): void
  ```

  `query` 原样 `postMessage` 已验证 request，并以 requestId 关联 pending；5 秒未响应、child exit 或 message 形状非法时，为对应请求返回 `workspace-unavailable` problem。`dispose` 清理 timer/pending 并 kill child。不得自动并行 fork 第二个 child。

- [ ] **Step 4: Main 只注册一个受验证 Query**

  在 `app.whenReady()` 后且创建窗口前，只调用一次：

  ```ts
  utilityProcess.fork(path.join(__dirname, 'workspace.js'), [], {
    serviceName: 'CourseFlow Workspace'
  })
  ```

  用它创建 supervisor。`ipcMain.handle(WORKSPACE_QUERY_CHANNEL, ...)` 必须先确认调用者是当前主窗口 `webContents`，再按当前 `__COURSEFLOW_APP_BUILD_ID__` 验证 request；非法调用返回 problem，不把异常、路径或进程类型透传 Renderer。应用退出时 dispose，utility exit 后页面得到 unavailable，不显示空数据。

- [ ] **Step 5: Preload 暴露唯一 capability**

  `src/preload.ts` 使用 `contextBridge`/`ipcRenderer`，只暴露冻结对象：

  ```ts
  window.courseFlow = Object.freeze({
    query: queryWorkspaceStatus
  });
  ```

  本地函数 `queryWorkspaceStatus(): Promise<BootstrapOutcome>` 生成 requestId、创建 request、执行一次固定 channel 的 `ipcRenderer.invoke`，再验证 outcome。requestId 使用 sandbox 中的 `globalThis.crypto.randomUUID()`；request 由 `makeBootstrapRequest` 创建。invoke 返回值不合法时转换为 `workspace-unavailable` problem。不得暴露 channel 名、`send`、`on`、MessagePort、路径或通用 IPC wrapper。

  `src/renderer/global.d.ts` 只声明 `Window.courseFlow.query(): Promise<BootstrapOutcome>`。

- [ ] **Step 6: Renderer 呈现真实 Query outcome**

  `main.tsx` 在 `useEffect` 中调用一次 `window.courseFlow.query()`，用 discriminated union 表示 `loading | ready | problem`。ready 只显示此刻真实成立的“Workspace 进程已就绪”和 buildId 中 commit 段的前 12 位；problem 显示明确文字和重试按钮。不要提前显示 SQLite 或本地根状态，不模拟成功、自动吞错或把未知当空数据。

- [ ] **Step 7: 验证进程契约并提交**

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm package
  rg -n "utilityProcess\.fork" src
  rg -n "ipcRenderer\.(send|on)|MessagePort|node:|from ['\"]electron['\"]" src/renderer
  ```

  预期：第一组通过；`utilityProcess.fork` 恰好一处；Renderer 边界查询无命中。启动当前平台打包壳，确认显示真实 Workspace process ready/build handshake，且不声称 SQLite/数据根已验证。将 `WP-R1-03` 设为 `Done`，`WP-R1-04` 设为 `Ready`，更新证据台账并提交：

  ```powershell
  git add src tests docs/roadmap/BACKLOG.md
  git commit -m "feat: supervise workspace utility process"
  ```

### Task 8: `WP-R1-04` — 稳定开发数据根、单实例与全链路 smoke mode

**Files:**

- Create: `src/shared/sqlite-version.ts`
- Create: `tests/shared/sqlite-version.test.ts`
- Create: `src/main/runtime-paths.ts`
- Create: `tests/main/runtime-paths.test.ts`
- Modify: `src/shared/bootstrap-contract.ts`
- Modify: `tests/shared/bootstrap-contract.test.ts`
- Modify: `src/main/workspace-supervisor.ts`
- Modify: `src/workspace.ts`
- Modify: `src/main.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `docs/roadmap/BACKLOG.md`

**Target ADRs:** ADR-03 活动数据位置；ADR-08 ActivityControl/DataSlots 分离；ADR-10 稳定身份。这里只创建开发根，不创建正式 DATA/schema。

- [ ] **Step 1: 领取并先写跨平台路径与 SQLite 边界测试**

  将 `WP-R1-04` 设为 `In Progress`。测试必须覆盖：

  - Windows `C:\\Users\\A\\AppData\\Local` 解析为 `CourseFlow Dev\\ActivityControl`、`DataSlots`、`Chromium` 三个不重叠子根。
  - Windows 缺少 `LOCALAPPDATA`、相对路径、UNC 路径均抛出明确错误，不回退到 roaming、cwd 或临时目录。
  - macOS `/Users/a/Library/Application Support` 解析为对应 POSIX 子根。
  - macOS 相对 appData 和 Linux 均抛错。
  - `isSupportedSqliteVersion` 对 `3.37.0`、`3.50.4`、`4.0.0` 为 true；对 `3.36.9`、缺段、负数、非数字、空字符串为 false。
  - bootstrap success DTO 现在必须包含真实 `sqliteVersion` 与 `dataRootClass: 'verified-local'`；缺失、额外或 build/request 不匹配仍被拒绝。

  运行 `pnpm test`，预期模块不存在而失败。

- [ ] **Step 2: 实现纯路径与版本策略**

  `resolveDevelopmentRoots(input)` 接受 `{ platform, localAppData, appData }`，返回只读 `{ activityControlRoot, dataSlotsRoot, chromiumRoot, dataRootClass: 'verified-local' }`。Windows 分支只用 `path.win32`，macOS 只用 `path.posix`；根名固定 `CourseFlow Dev`。对拒绝条件直接抛错，不新增 fallback 或用户确认分支。

  `src/shared/sqlite-version.ts` 导出 `isSupportedSqliteVersion(version: string): boolean`。只接受恰好三个十进制非负整数段，按 `[major, minor, patch]` 与 `[3, 37, 0]` 逐段比较；不引入 semver 依赖。

- [ ] **Step 3: 只在事实存在后扩展 bootstrap DTO 与 utility probe**

  在 `bootstrap-contract.ts` 增加 `WorkspaceProbeRequest = BootstrapRequest & { dataRootClass: 'verified-local' }`，把 `sqliteVersion` 与 `dataRootClass` 加入 `BootstrapReady`，把 `sqlite-unsupported` 加入 problem code，并同步严格 guard。

  `WorkspaceSupervisor.query` 现在接受已验证 `dataRootClass`，加入 probe request 后发送。`src/workspace.ts` 用 `node:sqlite` 创建且只创建 `new DatabaseSync(':memory:')`，对合法 probe 执行 `SELECT sqlite_version() AS version`；低于 3.37 返回 `sqlite-unsupported`，否则返回真实版本和输入的 root class。退出时关闭 database。不得创建文件、schema、migration 表或第二份旧协议实现。

- [ ] **Step 4: 在 Electron ready 前固定路径与单实例**

  `src/main.ts` 在创建窗口/utility 前：

  1. 用当前 platform、`process.env.LOCALAPPDATA`、`app.getPath('appData')` 解析开发根。
  2. 只创建三个根及 Chromium Session 子目录。
  3. `app.setPath('userData', chromiumRoot)`，`app.setPath('sessionData', chromiumRoot/Session)`；不改正式 CourseFlow 路径。
  4. Windows 设置 `app.setAppUserModelId('io.github.siruimei07.courseflow.dev')`。
  5. 取得单实例锁；失败即退出，`second-instance` 只恢复/聚焦现有窗口。

  Main 每次 Query 向 supervisor 只传已解析结果的 `dataRootClass`，不把任何实际路径送入 preload/Renderer。Renderer ready 状态此时才增加真实 SQLite 版本与“本地开发数据根已验证”。

- [ ] **Step 5: 加入显式开发 smoke mode**

  当且仅当 argv 含 `--courseflow-smoke` 时，创建 `show: false` 的同一 BrowserWindow，等待页面加载，然后通过 `webContents.executeJavaScript('window.courseFlow.query()')` 调用真实 preload → Main IPC → utility → SQLite 路径。验证 outcome 后向 stdout 输出恰好一行 JSON：

  ```json
  {"kind":"courseflow.smoke","ok":true,"appBuildId":"development:<commit>","sqliteVersion":"<actual>","dataRootClass":"verified-local"}
  ```

  成功以 0 退出；Task 8 在未提交工作树上构建时 buildId 可以带 `:dirty`，Task 9 的候选烟测会要求干净 commit。任何 problem/timeout 只输出一行 `ok:false`、不含路径的 JSON 并以非零退出。正常模式不输出该行；不要加入隐藏调试菜单或持久文件。

- [ ] **Step 6: 验证并提交**

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm package
  ```

  从当前平台包直接运行可执行文件并传 `--courseflow-smoke`；确认一行 success JSON、实际 SQLite ≥3.37、无路径、退出码 0。将 `WP-R1-04` 设为 `Done`，`WP-R1-05` 与 `WP-R2-01` 设为 `Ready`（后者保留开放证据依赖），更新证据台账并提交：

  ```powershell
  git add src tests docs/roadmap/BACKLOG.md
  git commit -m "feat: stabilize development runtime roots"
  ```

### Task 9: `WP-R1-05` — 自动化打包烟测并登记双平台证据

**Files:**

- Create: `scripts/run-packaged-smoke.mjs`
- Create: `tests/architecture/runtime-boundaries.test.ts`
- Modify: `docs/roadmap/BACKLOG.md`

**Target:** 自动证据覆盖依赖边界、隐私和当前平台打包产物；双平台实际执行才关闭 R1 Gate。

- [ ] **Step 1: 领取并先写边界失败测试**

  将 `WP-R1-05` 设为 `In Progress`。新增测试读取 tracked source/config，断言：

  - `utilityProcess.fork` 在生产源码中恰好一次；Renderer 没有 Electron/Node/path/MessagePort import。
  - `contextBridge.exposeInMainWorld` 只暴露 `courseFlow`，公开 key 只有 `query`；不存在通用 `send/on/invoke(channel)` wrapper。
  - BrowserWindow 的四个安全选项保持显式值。
  - 源码与顶层依赖不含 `crashReporter`、`autoUpdater`、`electron-log`、Sentry、analytics、telemetry、HTTP client、maker 或 publisher。
  - `package.json` 名称/identity 是 development，且没有 Grade/C1/C2 runtime source directory。

  同时新增对 `scripts/run-packaged-smoke.mjs` 的存在性检查。运行 `pnpm test`，预期因脚本不存在失败。

- [ ] **Step 2: 实现跨 host 的 smoke runner**

  脚本只使用 Node 标准库：

  1. 根据 `process.platform`/`process.arch` 在 `out/` 递归定位唯一的 `CourseFlow Dev.exe`，或 `CourseFlow Dev.app/Contents/MacOS/CourseFlow Dev`。
  2. 找不到或发现多个目标时失败，不猜测任意 executable。
  3. `spawn` 目标并只传 `--courseflow-smoke`，收集 stdout/stderr，20 秒超时后终止 child。
  4. 要求 exit code 0、stdout 恰有一个非空 JSON 行、`kind === 'courseflow.smoke'`、`ok === true`、buildId 匹配 `development:<40 hex>`（干净包不得含 `:dirty`）、SQLite ≥3.37、`dataRootClass === 'verified-local'`，且序列化结果不含盘符、UNC 或 `/Users/` 路径。
  5. 输出一个简短 PASS 行；失败时输出可操作原因，不写文件。

- [ ] **Step 3: 在干净提交边界构建候选**

  先提交 smoke 测试/脚本的代码，使工作树干净，避免 buildId 为 `:dirty`：

  ```powershell
  pnpm test
  pnpm typecheck
  git add scripts/run-packaged-smoke.mjs tests/architecture/runtime-boundaries.test.ts docs/roadmap/BACKLOG.md
  git commit -m "test: automate packaged runtime smoke"
  ```

  然后运行：

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm package
  pnpm smoke:packaged
  git status --short
  ```

  预期：所有命令通过，smoke 报 PASS，工作树仍干净。

- [ ] **Step 4: 收集平台证据**

  在 Windows x64 与 macOS arm64 分别从同一 source commit 执行 Step 3。每个平台记录：OS/架构、commit、Node/pnpm/Electron/SQLite 版本、package 命令、smoke 结果、正常可见窗口启动/退出观察，以及未验证项。不得提交 `out/`。

- [ ] **Step 5: 关闭或准确阻塞 R1 Gate**

  - 两个平台均通过：将 `WP-R1-05` 设为 `Done`，记录 R1 Gate 关闭。
  - 任一平台没有真实主机/结果：将 `WP-R1-05` 设为 `Blocked`，写明缺少的唯一证据；`WP-R2-01` 可保持 `Ready`，但其 evidence dependency 和最终发布 Gate 保持开放。
  - 任何平台实际失败：保持 `Verification` 或回到造成失败的最小 R1 工作包修复，使用 `superpowers:systematic-debugging`；不得把失败改写为资源缺失。

  更新 Backlog 后运行 `git diff --check`、审阅证据 diff 并提交：

  ```powershell
  git add docs/roadmap/BACKLOG.md
  git commit -m "docs: record r1 packaged evidence"
  ```

## R0–R1 Completion Check

完成本计划前必须同时满足：

- `WP-R0-01`–`03`、`WP-R1-01`–`04` 为 `Done`；`WP-R1-05` 为有证据的 `Done` 或明确外部原因的 `Blocked`。
- `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 在已记录平台实际通过。
- `git diff --check` 通过，`git status --short --branch` 只显示预期 ahead 状态且无未提交文件。
- 生产源码没有 Grade/C1/C2、安装器、更新器、生产诊断、持久日志、遥测、远程请求、正式 schema 或正式数据根。
- Renderer 只能调用 `window.courseFlow.query()`；Main 只监督一个 Workspace utility process；smoke 返回真实 SQLite 版本且不泄露路径。
- Backlog 证据准确列出另一平台、签名和发布资源的所有未验证项，不能把 R1 development package 描述为公开发布候选。

通过后，下一份计划从 `WP-R2-01` 开始，以 `A-DATA-001` 和 `TEST-DATA-001/002/003/005` 为第一个真实持久化切片；不得在本计划中提前建立其 schema。
