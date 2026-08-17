# UTM 本科成绩等级与 GPA 规则（官方资料核对）

> 调研日期：2026-08-17
> 适用范围：University of Toronto Mississauga（UTM）本科生；不适用于研究生评分制。
> 当前版本：UTM 官网当前发布的是 **2026–2027 Academic Calendar**，适用于 Fall 2026、Winter 2027 和 Summer 2027。该 Calendar 于 2026-05-13 首次发布；截至调研日，其更新页没有列出对 Grades and Academic Record 的修改。[Calendar 首页](https://utm.calendar.utoronto.ca/) · [Publication Updates](https://utm.calendar.utoronto.ca/publication-updates)

## 结论

1. CourseFlow 可以把下表作为“UTM 本科（2026–2027）”默认模板。UTM 使用 4.0 制，**A+ 和 A 都对应 4.0**；不是 A+=4.3。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
2. 单门课先由最终百分制成绩映射为 letter grade 和离散的 grade-point value；GPA 再按课程权重对这些 grade points 加权。不能直接把各课百分数平均后再映射为 GPA。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
3. UTM 明确定义三种聚合平均：Sessional GPA、Annual GPA、Cumulative GPA。产品中的“学期 GPA”不能含糊地把 Fall+Winter 合并值与单个 Fall/Winter term 的值混为一谈。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
4. CourseFlow 只能将结果称为**估算值**。UTM 明确没有把临界课程成绩自动向上取整的政策或惯例；另一方面，U of T 官方 GPA 计算器说明估算值可能因 GPA rounding 与 ACORN/ROSI 的正式 CGPA 不同，而本次查阅的公开页面没有给出足以复刻正式 GPA 的精确舍入步骤。[UTM Academic Policies Handbook 2026–2027](https://www.utm.utoronto.ca/dean/utm-academic-policies-handbook-2026-2027) · [U of T GPA Calculator](https://gpacalc.utoronto.ca/calculator/)

## 本科成绩映射

| 最终百分制成绩 | Letter grade | Grade point |
|---:|:---:|---:|
| 90–100 | A+ | 4.0 |
| 85–89 | A | 4.0 |
| 80–84 | A− | 3.7 |
| 77–79 | B+ | 3.3 |
| 73–76 | B | 3.0 |
| 70–72 | B− | 2.7 |
| 67–69 | C+ | 2.3 |
| 63–66 | C | 2.0 |
| 60–62 | C− | 1.7 |
| 57–59 | D+ | 1.3 |
| 53–56 | D | 1.0 |
| 50–52 | D− | 0.7 |
| 0–49 | F | 0.0 |

来源：[UTM 2026–2027 Calendar — Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)。相同的 University-wide undergraduate scale 也见于 [University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and) 和 [Transcript Grading Scales and Notations](https://www.registrar.utoronto.ca/records-academics/transcripts/grading-scales-notations/)；后者说明这套 transcript guide 自 1998-09 起生效。

中央政策把本科数值成绩定义为 0–100 的整数；UTM 2026–2027 教师手册还明确说明，临界成绩没有自动向上取整的政策或惯例。因此，CourseFlow 根据尚未完成的 assessment components 算出的带小数“当前分数/预测分数”应继续标为预测，不应自行把 84.5 等预测值抬至下一 letter-grade 区间。[University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and) · [UTM Academic Policies Handbook 2026–2027](https://www.utm.utoronto.ca/dean/utm-academic-policies-handbook-2026-2027)

## GPA 公式与三种平均

对所有应计入的课程：

```text
GPA = sum(课程 grade point × 课程权重) / sum(课程权重)
```

UTM Calendar 的表述是 full course 权重为 2、half course 权重为 1；用现代 FCE 表示为 1.0 与 0.5 也得到相同结果，因为比例相同。官方计算器的课程权重输入示例也是 0.5。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record) · [U of T GPA Calculator](https://gpacalc.utoronto.ca/calculator/)

例：一门 0.5-credit 的 A−（3.7）与一门 1.0-credit 的 B+（3.3）：

```text
(3.7 × 0.5 + 3.3 × 1.0) / 1.5 = 3.4333…
```

这个例子是依据官方公式推导的产品计算示例，不代表学校公开了该中间值应如何舍入。

| 官方术语 | 纳入范围 | 计算时点/含义 |
|---|---|---|
| Sessional GPA (SGPA) | 单个 Fall term、单个 Winter term，或整个 Summer session 中完成且应计入的通过与不通过课程 | 每学年分别为 Fall、Winter、Summer 计算 |
| Annual GPA (AGPA) | Fall + Winter（September–April）中完成且应计入的通过与不通过课程 | Winter term 结束后计算；不含 Summer |
| Cumulative GPA (CGPA) | 学业记录中所有应计入的通过与不通过课程 | 累计值 |

来源：[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)；[U of T GPA Calculator](https://gpacalc.utoronto.ca/calculator/) 也分别把 SGPA、AGPA、CGPA 描述为上述三个范围。

注意：UTM 在 Fall/Winter session 结束及 Summer session 结束时评估 academic standing，**不在 Fall term 结束后单独评估 standing**；这与“Fall SGPA 可以计算”是两件事。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)

## 纳入、排除与边界情况

- 纳入所有符合条件的通过及不通过课程；因此普通 F 以 grade point 0.0 参与分子，课程权重仍参与分母。Non-degree 与 non-degree visiting student 身份下取得的课程也纳入。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
- 当前 UTM Calendar 明确排除以下无 grade-point value 的 notation：`AEG`、`CR`、`NCR`、`EXT`、`GWR`、`IPR`、`PASS`、`LWD`、`NGA`、`SDF`、`WDR`；transfer credits 与 Letter of Permission 课程也排除。[UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
- UTM 的普通 CR/NCR 课程不进入 GPA：CR 可以获得 degree credit，NCR 不获得 degree credit，但两者都不计入当前 GPA 计算。[UTM Course Enrolment](https://utm.calendar.utoronto.ca/course-enrolment)
- Extra (`EXT`) 课程不计入 GPA；但 supplemental courses 虽不计 degree credit，仍计入 GPA。两类记录不能只根据“是否算毕业学分”来推断 GPA 行为。[UTM Course Enrolment](https://utm.calendar.utoronto.ca/course-enrolment)
- 重修已通过课程时，默认是重修那次标为 `EXT`，原成绩继续计入。符合 UTM Second Attempt for Credit（SAC）规则时，最多可指定 1.0 repeated credits：第一次标为 `EXT`，第二次计入；若第二次最终不及格/为 NCR，则 SAC 不适用。[UTM Course Enrolment](https://utm.calendar.utoronto.ca/course-enrolment)
- University Registrar 的 transcript guide 记录了历史或特殊情况下 `NC%` 以 0.0 进入 GPA 的例外。若未来要导入历史 transcript，不能假设每个 NCR 都必然排除；MVP 的“当前 UTM 默认模板”则应遵循当前 UTM Calendar。[Transcript Grading Scales and Notations](https://www.registrar.utoronto.ca/records-academics/transcripts/grading-scales-notations/)

## 学院、项目与规则版本差异

- 这套 A+–F 映射是 University-wide 的标准 undergraduate scale，当前 UTM Calendar 采用同一张表。[University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and) · [UTM Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record)
- U of T 确实允许经正式批准的 alternate grade scales，例如 H/P/F、HH/H/P/LP/F、CR/NCR；中央 transcript guide 也列出了 Dentistry、Medicine、Nursing 等 division-specific 规则。这些不是 UTM 通用本科模板，说明 CourseFlow 不应把“U of T”建模成全球唯一、不可编辑的一套规则。[University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and) · [Transcript Grading Scales and Notations](https://www.registrar.utoronto.ca/records-academics/transcripts/grading-scales-notations/)
- UTM 各项目可以设置不同的 program entry/completion 最低成绩或 GPA 门槛，也可能用指定课程子集计算 admission average，或对 CR/NCR 是否满足项目要求另作规定。例如当前 Biology Major 要求带百分制最终成绩的指定 UTM credits，而 Management Major 对指定先修课计算 weighted average 并使用年度 cutoff。这些属于项目资格规则，不等于改变上述通用百分数→grade point 映射；应作为后续独立功能，而非基础 GPA 算法。[UTM Course Enrolment](https://utm.calendar.utoronto.ca/course-enrolment) · [Biology Major](https://utm.calendar.utoronto.ca/program/ermaj2364) · [Management Major](https://utm.calendar.utoronto.ca/program/ermaj2431)
- 当前 Governing Council 在线版 University Assessment and Grading Practices Policy 标注日期为 **2020-01-01**；CourseFlow 的模板还应记录 Calendar 年份与来源 URL，并允许日后以新版本模板迁移，而不是静默覆盖用户既有学期规则。[University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and)

## 对 CourseFlow PRD 的直接建议

1. 内置模板名使用 `University of Toronto Mississauga — Undergraduate — 2026–2027`，包含来源、核对日期和可见的“可编辑副本”操作。
2. 分开保存 `final percentage`、`letter grade`、`grade point`、`course weight/FCE` 与 `GPA inclusion status`；不要只保存 letter grade。
3. GPA 页面分别显示 SGPA、AGPA 与 CGPA，或在 MVP 只实现其中一项时明确其时间范围。
4. 所有当前成绩、目标成绩和 GPA 预测标注“Estimate / 估算”；ACORN 上的 Academic History 才是正式结果。[U of T GPA Calculator](https://gpacalc.utoronto.ca/calculator/)
5. 若 MVP 不实现 SAC、supplemental、historical `NC%` 等边界，应把“与官方 transcript 完全一致”列为非目标，而不是隐藏误差。

## 官方来源索引

1. [UTM 2026–2027 Academic Calendar](https://utm.calendar.utoronto.ca/) — 当前 Calendar 的适用 session。
2. [UTM Calendar: Grades and Academic Record](https://utm.calendar.utoronto.ca/grades-and-academic-record) — 等级表、GPA 公式、三种 GPA、纳入/排除项。
3. [UTM Calendar: Course Enrolment](https://utm.calendar.utoronto.ca/course-enrolment) — CR/NCR、EXT、supplemental、重修与 SAC。
4. [UTM Calendar: Publication Updates](https://utm.calendar.utoronto.ca/publication-updates) — 2026–2027 Calendar 首发日期及后续勘误。
5. [UTM Academic Policies Handbook 2026–2027](https://www.utm.utoronto.ca/dean/utm-academic-policies-handbook-2026-2027) — 等级表与不自动向上取整规则。
6. [University Assessment and Grading Practices Policy](https://governingcouncil.utoronto.ca/secretariat/policies/grading-practices-policy-university-assessment-and) — University-wide 标准、alternate scales 与政策日期。
7. [University Registrar: Transcript Grading Scales and Notations](https://www.registrar.utoronto.ca/records-academics/transcripts/grading-scales-notations/) — transcript 等级表、历史/学院例外。
8. [University of Toronto GPA Calculator](https://gpacalc.utoronto.ca/calculator/) — 官方估算工具、GPA 范围说明与 rounding 警告。
