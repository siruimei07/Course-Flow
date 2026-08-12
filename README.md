# CourseFlow：可核对的课程计划

CourseFlow 把学期课表、课程事项、资料证据与手工成绩整理成一套可核对的个人课程计划。自动抽取只产生候选；只有用户作出审核决定后，候选才可以进入正式课程记录。

当前仓库提供 P0 的可运行质量骨架：Next.js web、常驻 Node worker、PostgreSQL、S3-compatible 本地对象存储、迁移、健康检查和统一质量门。业务功能从 P1 开始，当前应用壳不使用课程 mock 冒充已完成功能。实际阶段状态以 [实施计划](./docs/architecture/IMPLEMENTATION_PLAN.md) 为准。

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

## P0 质量门

本地与 CI 使用同一个阶段门禁：

```powershell
pnpm gate:p0
```

它依次验证 frozen install、格式、ESLint/模块边界、TypeScript strict、Vitest、空库 migration、production build、web/worker health 与唯一 Playwright 启动 smoke，并执行依赖漏洞、许可证和秘密扫描。需要只运行某一层时，以根 `package.json` 中的脚本为准。

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

1. AI 不直接修改正式课程数据。
2. 每个抽取字段都可回到原始课程资料核对。
3. 纯日期、具体时刻和待定日期有不同语义，不互相伪装。
4. 用户提供的 UI 片段会被纳入统一设计系统，而不是形成孤立页面。
