# CourseFlow：可核对的课程计划

CourseFlow 把学期课表、课程事项、原始资料与手工成绩整理成一套可核对的个人课程计划。P4 已签署 `MANUAL_ONLY`：正式事实只来自用户明确提交的表单，产品不含远程 AI、自动抽取、候选审核或规划助手。

当前仓库已完成 P4 清理。在 P1–P2 的正式课程与统一投影之上，Sources 已走通私有上传、服务端校验、安全预览、删除和“对照资料打开既有手工表单”，手工提交后由 Timeline/Dashboard 回读。实际阶段状态以 [实施计划](./docs/architecture/IMPLEMENTATION_PLAN.md) 为准。

## 本地启动

前置要求：Node.js 24、pnpm 11、Docker。

```bash
pnpm install --frozen-lockfile
pnpm deps:up
pnpm db:migrate
pnpm dev
```

默认地址为 `http://localhost:3000`。本地依赖由 Docker Compose 提供 PostgreSQL 与 S3-compatible object storage；`.env.example` 只包含非秘密示例。

## 当前 P4 质量门

```bash
pnpm gate:p4
```

质量门依次验证 frozen install、依赖与 bucket 准备、当前库和空库 migration、格式、ESLint/模块边界、TypeScript strict、Vitest、P3 PostgreSQL/S3 Source 权限 contract、`MANUAL_ONLY` 发布面扫描、production build、手工 Playwright canonical journey，以及依赖漏洞、许可证和秘密扫描。

## 文档入口

- [领域术语](./CONTEXT.md)
- [需求基线](./docs/product/REQUIREMENTS.md)
- [产品范围](./docs/product/SCOPE.md)
- [架构索引](./docs/architecture/README.md)
- [资料流水线](./docs/architecture/INGESTION.md)
- [P4 MANUAL_ONLY 签署](./docs/quality/P4_MANUAL_ONLY_SIGNOFF.md)
- [P4 AI 归档](./docs/architecture/AI_ASSISTANT.md)
- [实施计划](./docs/architecture/IMPLEMENTATION_PLAN.md)
- [设计基线](./docs/design/DESIGN_BASELINE.md)

## 核心承诺

1. 所有正式课程事实都由用户手工确认；上传或预览 Source 不会修改计划。
2. 日期、Reading Week、成绩、负荷、冲突与 ICS 由确定性领域规则派生。
3. 原始资料保持私有、可预览、可删除，并可在手工录入时随时回看。
4. 发布面保持 `MANUAL_ONLY`，不保留死的 AI seam、凭据入口或替代模型。
