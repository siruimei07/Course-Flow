# CourseFlow 全仓物理架构重构 Implementation Plan

> 状态：已批准（2026-08-28 用户批准立即执行）
> 日期：2026-08-28
> 工作包：`WP-RF-01`（维护性重构，非首发交付链）
> 上游依据：[ARCHITECTURE.md](../../architecture/ARCHITECTURE.md)、[MODULE_CONTRACTS.md](../../architecture/MODULE_CONTRACTS.md)、已批准 ADR-01–10

> **适用性：** 本文的 Stage、逐提交全量验证、固定环境与提交身份属于该次全仓行为保持重构。后续维护按 [AGENTS.md](../../../AGENTS.md) 和 [BACKLOG.md](../../roadmap/BACKLOG.md) 的当前任务与证据缺口执行，不继承旧基线或重复已完成 Stage；本包尚缺的平台与用户复验义务仍保留。

## 1. 目标与动机

把 `src/` 重组为与已批准逻辑架构一一对应的显式模块包，并以架构测试强制依赖方向，使每个语义所有者都有独立、可导航的物理位置。动机（用户 2026-08-28 确认）：

1. 前端展示存在多处缺陷，当前超大文件使 Agent 定位与修改效率过低；
2. 消除同构重复：11 个 `commit*Synchronously` 命令族的样板、各 `*ConflictResult` 构造器、`main.ts` 手工枚举的 27 个请求 kind；
3. 在 R7–R12 与 2026-08-28 新模型实施之前完成一次全面清理，降低后续每个工作包的改动成本。

本重构是**行为保持**的：不改变任何 Requirement 行为、Workspace Interface 契约、schema 语义、持久格式、`StructuredProblem`、测试义务语义或依赖版本；不实施 `WP-GA-01`，也不实施 2026-08-28 新任务模型。

## 2. 范围与非目标

**范围**：`src/` 全部区域（data、workspace 编排、protect、renderer、shared 契约、plan 领域内核抽取）；`tests/` 仅做导入路径与文件扫描范围的机械同步及新增依赖方向守卫；`docs/roadmap/BACKLOG.md` 登记与证据；`AGENTS.md` §项目状态 过期指针修正。

**非目标**：

- 不改 `package.json` 依赖、锁文件、Forge/Vite 配置与三个构建入口路径（`src/main.ts`、`src/preload.ts`、`src/workspace.ts` 保持薄入口）；
- 不拆 `styles.css`、不改其规则内容（`WP-GA-01` 已批准计划以该文件为实施对象，保持其前提不变）；
- 不改 `schema.ts` 导出的 DDL 字符串、迁移语义与 `CURRENT_SCHEMA_LEVEL`（仅按 Level 拆分文件，导出字节不变）；
- 不新建空模块或未来占位（无 `attend/`、`library/`、`grade/` 目录，遵守 YAGNI 与 Backlog §7）；
- 不顺手修复前端展示缺陷（重构后另行按缺陷清单逐项修复，保证每个 diff 单一意图）。

## 3. 目标物理结构

```text
src/
├── main.ts · preload.ts · workspace.ts      # 构建入口，路径不变，保持薄
├── main/                                    # Electron 主进程内部（现有 4 文件不变）
├── renderer/                                # MOD-SHELL
│   ├── index.html · main.tsx · global.d.ts · styles.css
│   ├── App.tsx · SetupDialog.tsx · workspace-pages.tsx · MigrationRollbackSurface.tsx
│   │                                        # 公共组件表面：文件名与测试导入路径不变，内部瘦身为组合层
│   ├── app/                                 # workspace 装载、任务动作运行时、undo、导航、视图状态
│   ├── pages/                               # Today / Courses / Calendar / Tasks / Files 及页面级组件
│   └── setup/                               # Setup 各步骤表单、检查单、草稿对账、字段文案
├── workspace/                               # MOD-WORKSPACE（新包）
│   ├── application.ts                       # WorkspaceApplication 请求路由（原 src/workspace-application.ts）
│   ├── lifecycle.ts                         # 原 src/workspace-lifecycle.ts
│   ├── bootstrap.ts · setup-commands.ts · plan-commands.ts · plan-queries.ts
│   ├── protection.ts · restore.ts · migration-rollback.ts · build-status.ts
│   └── projections.ts · outcomes.ts         # 投影组装与统一 outcome/conflict 装配（去重点）
├── plan/                                    # MOD-PLAN 领域内核（新包，纯函数，无 SQL/IO）
│   ├── local-date.ts · anchors.ts           # 本地日期数学、weekly 逻辑锚点
│   ├── meeting-occurrences.ts · meeting-overlap.ts
│   ├── task-schedule.ts · confirmation-tokens.ts
├── data/                                    # MOD-DATA
│   ├── sqlite-data-store.ts                 # 公共表面：类与全部现有导出不变，内部委托 store/
│   ├── store/                               # kernel（连接/队列/事务/终态）、reads/、commits/（按命令族分文件）、
│   │                                        # protection/（backup·cleanup·restore 操作持久化）、results.ts、rows.ts、guards.ts
│   ├── schema.ts                            # 公共表面：导出不变，内部委托 schema/
│   ├── schema/levels/level-01.ts … level-16.ts · schema/migrations.ts
│   └── command-digest.ts · migration-safety-copy.ts
├── protect/                                 # MOD-PROTECT：公共模块文件名不变；
│   │                                        # restore-activation 与 migration-rollback-handoff 拆内部子模块目录
├── platform/                                # MOD-PLATFORM（不变）
└── shared/                                  # Workspace Interface 契约：模块路径与导出不变；
                                             # course/setup/task/plan 四个超大契约拆 types/guards/makers 子文件聚合导出
```

原则：**每个模块包有一个稳定公共表面**（原被 78 个测试文件导入的路径尽量保持有效），内部实现按语义拆分；仅 `workspace-application.ts` 与 `workspace-lifecycle.ts` 两个根文件真实迁移进 `src/workspace/`（涉及少量导入更新与 `tests/architecture` 路径同步）。

## 4. 强制依赖方向

新增 `tests/architecture/module-dependency.test.ts`，用现有 TypeScript AST 工具解析 `src/` 全部相对导入并断言矩阵（行 → 允许导入的列）：

| 从 \ 到 | shared | plan | platform | data | protect | workspace | main | renderer |
|---|---|---|---|---|---|---|---|---|
| `shared` | ✓ | — | — | — | — | — | — | — |
| `plan` | ✓ | ✓ | — | — | — | — | — | — |
| `platform` | ✓ | — | ✓ | — | — | — | — | — |
| `data` | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| `protect` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `workspace` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `main/` 与 `main.ts` | ✓ | — | — | — | — | — | ✓ | — |
| `preload.ts` | ✓ | — | — | — | — | — | — | — |
| `workspace.ts` 入口 | ✓ | — | — | — | ✓* | ✓ | — | — |
| `renderer` | ✓ | — | — | — | — | — | — | ✓ |

\* 仅 `protect/workspace-startup` 既有启动判定；矩阵以重构完成时实际最小集为准收紧。该矩阵与 ARCHITECTURE §3.2 允许/禁止依赖一致：Shell 只经 Workspace Interface（IPC，无编译期依赖）；PLAN 内核不依赖外围；接口不泄露实现类型。

## 5. 分阶段执行

生命周期 `Ready → In Progress → Verification → Done` 登记于 Backlog；每个 Stage 为一个或多个独立 commit，**每个 commit 都必须通过 §6 全部验证后才提交，代码与其证据台账行同批提交**。

| Stage | 内容 | 主要风险控制 |
|---|---|---|
| A 登记 | 本计划入库；`BACKLOG.md` §2 增设“RF — 维护性重构（非首发交付链）”小节与 `WP-RF-01` 行；证据台账登记 `— → Ready → In Progress` | 纯文档 |
| B plan 内核 | 从 `sqlite-data-store.ts` 抽出模块级纯领域函数（约 2.3–2.5k 行：日期数学、occurrence 展开、重叠告警、任务日程投影、确认令牌）入 `src/plan/`，store 改为导入 | 纯移动 + 导入；函数体不改 |
| C store 拆分 | `SqliteDataStoreImplementation` 内部按 kernel / reads / commits（8 个命令族文件）/ protection 操作持久化拆分；类保持公共 API，方法委托；`results.ts` 统一 conflict/problem 构造器 | 分 4–6 个 commit 递进；每步全量测试 |
| D schema 拆分 | Level 1–16 DDL 与迁移按级拆文件；`schema.ts` 聚合导出 | 新增一次性字符串等价断言（拆分前后导出逐一 `===`）随既有 schema/digest 测试验证 |
| E workspace 包 | `workspace-application.ts`/`workspace-lifecycle.ts` 迁入 `src/workspace/` 并按 §3 拆分；`outcomes.ts` 去重 11 处 outcome 装配样板；`main.ts` 的 27-kind 手工枚举改由 `shared` 导出的 kind 清单驱动（构造结果不变） | 入口 `workspace.ts` 与测试导入同步更新 |
| F renderer 拆分 | `workspace-pages.tsx` → `pages/`；`SetupDialog.tsx` → `setup/`；`App.tsx` 装载/任务动作运行时 → `app/`；三个公共组件文件保留为组合层，现有 renderer 测试导入路径不变 | `tests/architecture/setup-ui.test.ts` 文本扫描范围同步到新目录（断言语义不变） |
| G protect 拆分 | `restore-activation.ts`（2.6k）与 `migration-rollback-handoff.ts`（2.3k）各拆内部子模块（journal/状态机/物理步骤），公共模块文件名与导出不变 | 数据安全内核：只做保守的节段搬移，不改控制流 |
| H shared 契约 | course/setup/task/plan 四个契约拆 types/guards/makers 并由原路径聚合导出；kind 清单归契约所有 | 导出集合前后比对 |
| I 守卫与收口 | 新增 §4 依赖方向测试；`AGENTS.md` §项目状态 过期指针改为指向 Backlog 当前事实；全量验证；台账 `Verification → Done` | — |

预计合计 15–25 个 commit。中断安全：任何 Stage 完成即是一致状态，可随时停在该 Stage。

## 6. 验证协议与证据

每个 commit 前必须全部通过：

1. `tsc --noEmit -p tsconfig.json` 与 `tsc --noEmit -p tsconfig.test.json`；
2. 全量 `node --test`（当前基线：78 文件 676 用例）与重构前基线**逐名比对**：通过/跳过集合不变，仅允许新增用例；
3. `git diff --check`；
4. `git status` 无计划外文件；`package.json`、`pnpm-lock.yaml`、Forge/Vite 配置、`styles.css` 零改动（Stage A/I 的文档与 `AGENTS.md` 除外）。

**执行环境说明（如实登记为证据边界）**：本重构在 Linux x64 / Node 22 容器执行验证。该环境基线为 667 通过 / 5 跳过 / 4 个已定性的环境性失败（2 个 packaged-smoke 后代进程清理、1 个大小写不敏感文件系统假设、1 个 `ApplicationBuildStatus` 的 darwin/win32 平台守卫），重构全程要求失败集合恒等于该 4 项。Windows x64 / Node 24 的 `pnpm test`、`pnpm typecheck`、`pnpm package`、`pnpm smoke:packaged` 及真实 UI 观察**留待用户在 Windows 主机复验**，在台账中登记为未验证项；`WP-RF-01` 的 `Done` 以用户复验通过为准。

## 7. 提交规范

沿用现有风格：英文短意图（`refactor: …` / `docs: …` / `test: …`），作者 `Sirui Mei <sirui.mei07@gmail.com>`，无 co-author 尾注，不 push、不 amend；每个 commit 只包含其 Stage 的文件与对应台账行。

## 8. 与既有批准事项的关系

- `WP-GA-01`：其已批准计划针对 `src/main.ts`、`styles.css`、两个架构/壳测试；本重构不动 `styles.css` 与窗口选项，计划原文引用的文件路径保持有效。
- 2026-08-28 新模型设计：不在本重构实施；重构后其 Task/Grade/Attendance 切片将落在拆分后的 `plan/`、`data/store/commits/`、`renderer/pages|setup/` 结构上。
- ADR-01–10：技术栈、进程模型、存储/迁移/快照/恢复协议全部不变；本重构不需要新 ADR（无跨切面技术选型变化，仅物理组织），如评审认为需要补充记录，可追加轻量 ADR-11 记录“物理模块布局与依赖方向守卫”。

## 9. 回退

每个 Stage 均为独立 commit 序列，可用 `git revert` 逐段回退；重构不触碰持久数据格式，回退无数据影响。
