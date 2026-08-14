# CourseFlow Agent 开发执行流程

## 1. 目标与边界

每次工作交付最小、真实、可验证的纵向切片。正式数据只经用户手工 command；P4 已签署 `MANUAL_ONLY`，不得恢复模型凭据、远程调用、自动解析、候选审核或助手。

最低防御边界：auth/owner scope、Zod 输入、expected version/幂等、显式时间语义、文件 fail-closed、日志无正文/秘密、UI 不复制领域规则、production 无 fixture。

## 2. 固定顺序

### 2.1 定位阶段与变更面

读取 IMPLEMENTATION_PLAN 的当前 `next`，再按 AGENTS 路由读取产品、数据、interface、前端、质量和设计文档。确认模块 public interface、依赖方向、现有测试与 dirty worktree。

### 2.2 定义可观察契约

写一条成功场景、一条失败/边界场景、输入/输出、owner/version/日期语义和用户看到的状态。避免从表或组件开始反推产品行为。

### 2.3 处理 UI 输入

先登记视觉意图与冻结版本。把页面拆成 visual、interaction、data responsibilities；fixture 只留在测试/demo。涉及可见变化时遵循 FRONTEND 和 DESIGN_BASELINE，并加载 AGENTS 指定技能。

### 2.4 实现最短真实路径

顺序通常是 core rule/interface → 必要 repository/adapter → contract/transport → view model/UI。跨模块只走 public index。不要提前建立第二个 provider、通用 factory、空表或“以后会用”的 layer。

### 2.5 最低证明集

- 纯规则：unit/table-driven。
- 权限、transaction、migration、object storage：adapter contract。
- JSON/ICS：contract/golden。
- 可见行为/a11y：component/Browser。
- 跨层关键旅程：扩展唯一 canonical E2E，而非每页复制 smoke。
- 所有发布变化：`pnpm test:manual-only`。

### 2.6 验收与收尾

运行目标测试，再运行阶段 gate。检查 production build、route/config/schema、secret scan、git diff 和无关变更。更新实施状态、设计记录与用户可见文档；只有实际完成才标 `done`。

## 3. HTML/CSS 与不完整 UI

1. 记录来源、日期、viewport 与 geometry/typography/color/depth/density/motion 指纹。
2. 映射到现有 route/feature/primitive/token/view model/action。
3. 隔离验证原型；移除 document reset、CDN/inline script、内联事件与 mock persistence。
4. 只提升真实复用的 token/primitive。
5. 接真实 contract，处理 loading/empty/error/success/version conflict。
6. 在 `1280x900`、200% zoom、键盘、浅/深主题、长文本和 reduced motion 下浏览器验收。

冻结 UI 是只读权威。必要的安全/正确性/a11y 偏差写 deviation；新视觉方向由用户确认并创建新版本。

## 4. 当前阶段路由

- P0–P4 已完成；P4 结果为 `MANUAL_ONLY`。
- 当前 `next` 是 P5：整合与打磨现有手工产品，不新增已拒绝能力。
- P6 只有首批 Insight 定义完整后解锁。

P5 最低证明：目标 interface tests、production build、canonical Source 手工 journey、Browser 视觉/a11y、secret scan 和 P4 发布面扫描。

## 5. 交付格式

1. **结果**：用户现在能做什么。
2. **范围**：阶段、module/interface、明确未做。
3. **验证**：实际命令、退出状态、失败或未运行原因。
4. **UI**：基线 ID、viewport、键盘/reduced-motion/console。
5. **门禁**：完成标准逐项状态；不满足不标 done。
6. **下一步**：已解锁阶段或唯一具体缺口。
