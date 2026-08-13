# CourseFlow：可核对的课程计划

CourseFlow 把学期课表、课程事项、原始资料与手工成绩整理成一套可核对的个人课程计划。正式事实默认由用户手工确认；只有 DeepSeek 最终门禁通过时才启用自动抽取，且候选仍须经用户审核才能进入正式记录。

当前仓库已完成 P3：在 P1–P2 的正式课程与统一投影之上，Sources 已走通私有上传、服务端校验、安全预览、删除和“对照资料打开既有手工表单”，手工提交后由 Timeline/Dashboard 回读。DeepSeek 仍为 `AI_PENDING`；只存在隔离 deterministic fake、冻结 eval policy 与显式 harness，默认生产不含 AI route、UI、adapter 或 migration。实际阶段状态以 [实施计划](./docs/architecture/IMPLEMENTATION_PLAN.md) 为准。

## 本地启动

前置条件：Node.js 24、pnpm 11.16.0，以及带 Compose v2 的 Docker。

首次检出后安装锁定依赖，并从安全示例创建本地配置：

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm exec playwright install chromium
```

macOS/Linux 的第二条命令为 `cp .env.example .env`。Chromium 只供本地浏览器门禁使用；CI 会自动安装。随后始终使用同一个入口启动依赖、执行迁移并运行两个进程：

```powershell
pnpm dev
```

- Web 应用：http://127.0.0.1:3000
- Web liveness/readiness：http://127.0.0.1:3000/api/health、http://127.0.0.1:3000/api/ready
- Worker liveness/readiness：http://127.0.0.1:3001/health、http://127.0.0.1:3001/ready

停止应用使用 `Ctrl+C`；本地依赖可用 `pnpm deps:down` 停止。该命令不会删除数据卷。

## 当前 P3 质量门

本地与 CI 使用同一个阶段门禁：

```powershell
pnpm gate:p3
```

它依次验证 frozen install、依赖与 bucket 准备、当前库和空库 migration、格式、ESLint/模块边界、TypeScript strict、最小 Vitest 集、P1/P2 统一投影、P3 PostgreSQL/S3 Source 权限 contract、eval dry-run、production build、唯一手工 Playwright canonical journey，以及显式隔离的 fake AI harness；最后执行依赖漏洞、许可证和秘密扫描。默认 `pnpm dev`、`pnpm build` 和 `pnpm test:e2e` 都不会启动或构建 AI harness。

## 文档入口

- [产品范围与页面](./docs/product/SCOPE.md)
- [需求基线与后续补充区](./docs/product/REQUIREMENTS.md)
- [系统架构索引](./docs/architecture/README.md)
- [实施顺序与阶段验收](./docs/architecture/IMPLEMENTATION_PLAN.md)
- [Agent 详细开发执行流程](./docs/architecture/DEVELOPMENT_WORKFLOW.md)
- [前端设计基线与冻结流程](./docs/design/DESIGN_BASELINE.md)
- [UI 整合记录](./docs/design/UI_INTEGRATION_LOG.md)
- [项目所有者阶段提示词指南](./docs/product/OWNER_DEVELOPMENT_GUIDE.md)
- [领域术语](./CONTEXT.md)
- [架构决策记录](./docs/adr/README.md)

## 核心承诺

1. 没有 AI 也能完成全部课程计划；AI 只有通过硬门禁才启用，失败不换模型。
2. `AI_ENABLED` 时 AI 不直接修改正式数据，每个抽取字段都可回到原始资料核对。
3. 纯日期、具体时刻和待定日期有不同语义，不互相伪装。
4. 用户提供的 UI 片段会被纳入统一设计系统，而不是形成孤立页面。
