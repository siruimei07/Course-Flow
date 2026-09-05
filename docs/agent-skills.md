# CourseFlow 专项 skill 门禁

本文件由 [AGENTS.md](../AGENTS.md) 按任务触发引用，只维护前端与 FECS 的项目适配规则；授权、规范优先级与完成条件由 AGENTS 拥有。每次只读命中的章节和 references。

## 前端门禁

前端界面、交互、样式、动效与前端代码的编写、修改、重构、评审、修复，在首次实质性操作前按下列顺序应用，冲突优先级同此顺序：

| Skill | CourseFlow 中的职责 |
|---|---|
| `emil-design-eng` | 组件设计、交互细节、动效判断的工艺基线 |
| `design-taste-frontend` | 品味和方向诊断；其 landing、portfolio、redesign 建议只在产品语境中取适用部分 |
| `impeccable` | 将方向与诊断转为可执行改动，完成产品界面实施 |

原文按当前环境的 skill 清单定位；旧环境约定是仓库外工作区 `.claude/skills/<name>/SKILL.md`，不据此假定已安装。可读取时按原文应用；不可用时报告未读取，仍按上表顺序检查工艺、方向和完成状态，遵守下列已明确的项目约束，不声称执行了缺失 skill。

- 仅在已批准产品、架构、FECS、可访问性和跨平台边界内采用建议；保留键盘可达、非颜色状态表达、离线和无账户要求。
- 冻结的方向和布局只按用户授权调整，条件 skill 不重开设计决定。
- Renderer 使用现有原生 CSS 与 `src/renderer/styles.css` token 体系：半径三档、固定 rem 字号档、状态 token、`[data-course-color]` 课程强调色。不得引入 Tailwind、shadcn/ui、Radix 组件或其主题变量方案。

### 条件层

仅命中下列条件时读取，不因执行前端任务而整批加载。补充建议只填补三件套未覆盖的细节，不覆盖其方向、工艺底线或已批准布局。

| Skill | 读取条件与边界 |
|---|---|
| `frontend-design` | 新页面、新版式或重新确立视觉方向；方向冻结的切片不触发 |
| `ui-ux-pro-max` | 需要定向解决无障碍、色彩、排版、图表或实现栈问题时，仅按单一意图查询 `scripts/search.py`，不整篇加载。核对命中项的产品/平台适用性；空结果或无法运行时如实报告，回到项目规范 |
| `ui-styling` | 需要组件结构、状态覆盖或无障碍语义参考时；样式实现仍遵守上述原生 CSS 边界 |
| `vercel-react-best-practices` | 改动涉及渲染/重渲染、effect 依赖、bundle 切分或数据获取性能，且能指出可观测问题；不据此无实测地增加 memo、缓存或懒加载 |
| `web-artifacts-builder` | 仅独立 HTML mockup 或设计探索产物；不用于 `src/` 产品代码，产物不进入构建链，也不带入其 React/Vite/Tailwind/shadcn 技术栈 |

## FECS 门禁

所有项目文件和目录在新增、修改、移动、重命名、评审前判定 `applying-baidu-fecs-standards` 适用分支。skill 可用时先读快速索引，再读命中分支原文；不整套加载。缺失原文时报告限制，不把本地 lint 或摘要冒充原文合规证据。

- 文件按语言、资源、包和图表分支路由。目录变更始终读取“项目目录 1.1”原文；涉及包或模块再读对应原文。现有已批准路径（包括 `docs/`）保持稳定，目录迁移单独获批。
- `MUST / MUST NOT` 是要求，`SHOULD` 是可说明理由后偏离的默认建议，`MAY / OPTIONAL` 不作为违规。引用 ESNext、React 条款标明草案状态。
- TypeScript、TSX 只应用与 JavaScript、ESNext、React 重叠且实际适用的条款。Markdown、SQL、YAML、工具配置、平台代码中 FECS 未覆盖的内容，遵循其规范来源与工具约束。
- FECS 历史条款与已批准 ADR、安全、平台要求或当前规范冲突时，采用当前项目约束，同时说明原条款和冲突。
- 完成时核对改动路径的适用分支及 MUST 条款；仓库 lint 和配置只能提供辅助证据。
