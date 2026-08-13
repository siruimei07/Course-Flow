# CourseFlow

CourseFlow 描述学生如何从课程资料中确认课程要求，并把它们组织成可信的跨课程计划。

## 课程组织

**学期（Academic Term）**：
一段有明确起止日期和默认时区的学习周期；课程属于且只属于一个学期。
_Avoid_: Semester（并非所有学校都采用 semester 制）、学年

**课程（Course）**：
学生在某个学期内修读的一门教学单元，由课程代码、名称和可选课节共同识别。
_Avoid_: Class（容易与一次上课混淆）、Subject

**课节（Meeting Pattern）**：
一门课程中按星期与本地时间重复发生的教学安排，例如 Lecture、Tutorial（TUT）或 Practical（PRA）；它描述重复规则，不等同于某一天实际发生的一次课。
_Avoid_: Course Item（课程要求或事项）、Event（无法表达重复规则）

**课节实例（Meeting Occurrence）**：
课节在某个本地日期上展开后的一次实际上课安排；Reading Week、单次取消或改期会影响实例，但不改写原始重复规则。
_Avoid_: Class（含义不清）、Course（层级错误）

**校历例外（Academic Calendar Exception）**：
学期内会改变常规教学安排的命名日期区间，例如 Reading Week；例外默认抑制周期课节，但不自动取消考试、截止事项或显式保留的实例。
_Avoid_: Holiday（范围过窄）、Course Item（不是待办要求）

**课程资料（Source Document）**：
用户提交、用于证明课程信息的原始 PDF 或图片；其内容始终被视为外部输入。
_Avoid_: File（过于宽泛）、Attachment

## 导入与可信度

**导入批次（Import Run）**：
针对一份课程资料进行的一次完整解析尝试；重试会产生新的批次，以保留历史。
_Avoid_: Upload（上传只是导入的一步）、Job（实现术语）

**候选（Candidate）**：
系统从课程资料中提出、等待用户确认的一组结构化课程信息。候选不是正式课程数据。
_Avoid_: Result（暗示已经正确）、Record

**来源证据（Evidence）**：
支撑某个抽取字段的原文片段及其页码或图片位置。
_Avoid_: Citation（容易被理解为学术引用）、Reference

**审核决定（Review Decision）**：
用户对候选作出的接受、修改后接受、拒绝或标记重复的明确决定。
_Avoid_: Approval（无法表达拒绝和修改）

**AI 规划草稿（AI Planning Draft）**：
个人 AI 助手基于用户已确认的课程计划生成的解释、日/周计划或表单预填建议；它不是 Candidate，也不是正式课程数据。草稿只能进入现有手工表单，由用户核对并提交后才可能写入正式记录。
_Avoid_: AI Decision（模型不能替用户决定）、Auto Plan（暗示会自动执行）

## 课程要求

**课程事项（Course Item）**：
出现在课程时间线上的一项要求或事件，例如作业截止、考试、测验、实验或展示。它可以有时间信息，也可以暂为待定。
_Avoid_: Task（并非所有事项都是待办动作）、Event（无法表达待定要求）

**成绩组成（Grade Component）**：
总评计算中的一个命名部分，可代表单个课程事项或一组事项，并可带有明确占比和规则说明。
_Avoid_: Grade（指结果而非构成）、Weight（只是其中一个属性）

**成绩结果（Grade Result）**：
用户在某个成绩组成出分后录入的已得分与满分；百分比和对总评的贡献由它派生，未知结果不会被当作零分。
_Avoid_: Grade Component（构成而非结果）、Current Grade（容易掩盖尚未出分的权重）

**字母等级表（Letter Grade Scale）**：
用户提供并确认的百分比到 A/B/C/D/F 分类边界；它属于换算规则，不是单次成绩结果。
_Avoid_: GPA Scale（首版不计算绩点）、Transcript（外部资料）

**任务标签（Task Label）**：
用户用于组织课程事项的可复用标签；它不改变事项的日期、类型、权重或完成状态。
_Avoid_: Course Item Kind（系统类型）、Status（生命周期状态）

**负荷估计（Workload Estimate）**：
完成课程事项预计需要投入的时间；它可以来自资料、用户输入，也可以在展示时由系统启发式估算。
_Avoid_: Duration（容易与考试持续时间混淆）、Effort Score

**时间冲突（Schedule Conflict）**：
两个已知时间区间发生重叠，或一组临近截止事项达到明确拥挤规则时形成的规划风险。
_Avoid_: Collision（技术意味过强）、Clash

## 视图

**课程时间线（Course Timeline）**：
按时间组织单门课程事项的视图，包含待定和已确定事项。
_Avoid_: Calendar（时间线也包含没有确定日期的事项）

**负荷热力图（Workload Heatmap）**：
按日期或周聚合负荷估计与临近截止压力的跨课程视图。
_Avoid_: Schedule（它表达强度而不是完整日程）

**统计洞察（Insight）**：
由正式课程数据计算、带有口径与数据质量说明的一项可展示结论。
_Avoid_: Stat（过于宽泛）、Metric（洞察也可包含解释）
