# Design System: CourseFlow

> Status: Stitch visual baseline derived from the approved CourseFlow UI specification v1.0.
> Product type: local-first desktop academic planner for macOS and Windows.
> Scope authority: `docs/superpowers/specs/2026-08-18-courseflow-ui-wireframes-page-spec-design.md`.
> Rule: visual generation may refine composition and tokens, but must not invent features, statistics, navigation entries, or product states.

## 1. Visual Theme & Atmosphere

CourseFlow should feel like a calm, sunlit study desk: precise enough for a timetable, warm enough for a daily planning ritual, and lively without becoming playful or decorative. The interface is predominantly neutral white and soft gray. A small warm-yellow glow appears near the upper-right or behind one priority region, as if late-afternoon light is entering the workspace; it must never wash the whole page yellow.

- **Density 6/10 — Daily App Balanced:** information-rich schedules, tables, and bento panels remain quickly scannable.
- **Variance 7/10 — Offset Asymmetric:** the Today page uses an asymmetric 12-column bento rhythm, varied card spans, and deliberate negative space. Avoid equal three-card rows.
- **Motion 4/10 — Restrained Fluidity:** transitions clarify state and location. The product is a planning tool, so decorative continuous motion is forbidden except for a running timer or a genuinely live status.
- **Personality:** composed, optimistic, contemporary, tactile, and academically credible.
- **Platform character:** one shared visual language across macOS and Windows, with native window chrome and file pickers left to each operating system.
- **Primary reference behavior:** generous dashboard composition, pill-shaped global navigation, large but controlled typography, frosted colorless cards, and dense Apple Calendar / Notion Calendar-inspired scheduling surfaces.

## 2. Color Palette & Roles

### 2.1 Structural palette

- **Paper Canvas** (`#F4F5F2`) — default app background; neutral, never visibly blue.
- **Raised Canvas** (`#F8F8F5`) — solid fallback behind tables, calendar grids, and reduced-transparency mode.
- **Frosted White** (`rgba(255,255,255,0.56)`) — ordinary cards, toolbars, drawers, and grouped controls.
- **Dense Frosted White** (`rgba(255,255,255,0.72)`) — inputs and surfaces that require stronger text contrast.
- **Solid Accessibility Surface** (`#FAFAF7`) — replacement when transparency is reduced or unsupported.
- **Charcoal Ink** (`#242420`) — primary text and selected navigation; never use pure black.
- **Graphite Ink** (`#4F504A`) — secondary labels and compact metadata.
- **Quiet Ink** (`#74766E`) — tertiary copy; use only at accessible sizes and contrast.
- **Whisper Line** (`rgba(62,63,56,0.13)`) — structural dividers, table lines, and calendar grid lines.
- **Glass Highlight** (`rgba(255,255,255,0.78)`) — one-pixel top/left card edge.
- **Warm Sun Accent** (`#DDBD47`) — the single product accent for primary actions, selected moments, focus support, and small progress highlights. Use Charcoal Ink text on this color.
- **Warm Sun Halo** (`rgba(242,207,85,0.22)`) — local background glow only; never a card fill or large status field.
- **Error Clay** (`#B64E42`) — destructive and error text with a label or icon.
- **Success Moss** (`#4F7E5B`) — confirmed success with a label or icon.
- **Warning Ochre** (`#9A6A1C`) — warning and pending states with a label or icon.

The product has one interaction accent, Warm Sun Accent. Course colors below are categorical data colors, not competing UI accents.

### 2.2 Course color choices

- **Course Red** (`#D86A61`)
- **Course Orange** (`#DE8A51`)
- **Course Yellow** (`#D5AE43`)
- **Course Green** (`#6AA679`)
- **Course Blue** (`#6D96D1`)
- **Course Purple** (`#8B79C4`)
- **Course Gray** (`#858982`)

Every use of a course color must also show the course code or name. Never encode status or course identity with color alone.

### 2.3 Event color recipes

- **Class session:** course color at 18–28% tint over a near-white surface, plus a 3px solid course-color edge. Text remains Charcoal Ink.
- **Task:** course color at approximately 50% visual tint with 16px backdrop blur; use a clear task label and maintain text contrast.
- **Exam or one-off assessment:** course color at 32–42% tint, stronger edge, and an explicit `考试` or assessment-type label. Never use a large charcoal or black block.
- **Reading Week / holiday:** neutral warm-gray strip (`rgba(116,118,110,0.14)`) with a subtle outline; one continuous bar across the visible date range.
- **Selected row:** a pale Warm Sun Accent tint (`rgba(221,189,71,0.18)`) plus a selection control; background alone is not sufficient.

## 3. Typography Rules

Use a sans-serif-only dashboard pairing.

- **Display and UI:** `Satoshi`, `Noto Sans SC`, `PingFang SC`, `Microsoft YaHei UI`, sans-serif. Satoshi gives Latin text and numbers an intentional round geometry; the CJK fallbacks keep Chinese crisp across macOS and Windows.
- **Dense numeric metadata:** `JetBrains Mono`, `SFMono-Regular`, `Cascadia Mono`, monospace. Use sparingly for clock times, calculated values, percentages, and aligned metadata.
- **Numerals:** enable tabular numbers in time grids, counters, grade values, GPA, and percentages.
- **Banned:** Inter, generic serif fonts, decorative display fonts, all-caps paragraphs, and enormous marketing-style headings.

### 3.1 Type scale

- **Page greeting:** 40px / 1.08, weight 500, tracking -0.035em; use `clamp(32px, 2.3vw, 48px)` on wide screens.
- **Page title:** 32px / 1.15, weight 500, tracking -0.025em.
- **Card title:** 22px / 1.25, weight 600.
- **Section title:** 18px / 1.3, weight 600.
- **Body:** 15px / 1.55, weight 400–500.
- **Compact row:** 14px / 1.4, weight 450–550.
- **Metadata:** 12–13px / 1.35, weight 500.
- **Large metric:** 40–52px / 1, weight 450; always include a textual label and never let the number stand alone.

Body copy should stay below 65 characters per line. Hierarchy comes from weight, spacing, and contrast before size.

## 4. Material, Depth & Background

### 4.1 Page background

Start with Paper Canvas. Add one low-saturation radial glow anchored near the top-right: Warm Sun Halo fading to transparent within 340–520px. On 2560×1600 the glow should occupy no more than roughly 15% of the visible canvas. A second, extremely faint neutral-white bloom may sit behind the primary bento region. Do not use gradient text.

### 4.2 Standard frosted card

- Fill: Frosted White.
- Backdrop blur: 24px; saturation no higher than 112%.
- Border: 1px Glass Highlight on the bright edge and 1px Whisper Line as the structural edge.
- Radius: 24px for primary cards, 18px for compact cards, 10–12px for calendar events.
- Shadow: `0 18px 52px rgba(54,48,31,0.08)`, tinted warm-neutral and diffused.
- Internal padding: 24px standard, 18px compact, 28–32px for hero cards.
- Hover: border contrast increases slightly and the card translates no more than -1px; no glow.
- Reduced transparency: replace with Solid Accessibility Surface and a stronger Whisper Line.

Cards are for meaningful information groups. Dense tables, calendar cells, and long forms should use a shared surface with dividers rather than wrapping every row in another card.

### 4.3 Dark surfaces

Deep charcoal is limited to the selected navigation pill, compact primary focus regions, and destructive confirmations where semantics demand high contrast. Large ordinary cards, calendar events, exams, and empty states must not become charcoal panels.

## 5. Component Stylings

### 5.1 Global navigation

- Desktop top bar height: 72px, sticky without obscuring keyboard focus.
- Brand at left; centered pill group in the fixed order `今天 / 课程 / 日历 / 任务 / 文件 / 成绩`; settings/personal entry at right.
- Navigation container: Dense Frosted White, 18px radius, faint one-pixel border.
- Active item: Charcoal Ink fill with off-white text; 14px, weight 600.
- Every destination has an explicit text label and remains keyboard reachable at compact widths.
- Do not add global search, notifications, social avatars, AI controls, or unapproved destinations.

### 5.2 Buttons and compact controls

- Primary: Warm Sun Accent fill, Charcoal Ink label, 14px weight 650, 12–14px radius.
- Secondary: Dense Frosted White fill with Whisper Line border.
- Ghost: transparent until hover/focus; preserve a visible 36–40px hit area.
- Destructive: light Error Clay tint with Error Clay text; confirmation copy states the affected scope.
- Active press: translateY(1px) and reduce shadow; never scale dramatically.
- Disabled: lower contrast plus explicit unavailable state; do not use disabled controls as placeholders for future modules.
- Focus: two-part ring visible on glass, yellow, and charcoal: 2px Paper Canvas separation plus 3px `rgba(89,111,173,0.78)` outer ring.

### 5.3 Inputs and forms

- Labels sit above fields; helper text beneath; errors beneath helper text without clearing the entered value.
- Field height: 40px compact, 44px standard; radius 12px.
- Fill: Dense Frosted White; border becomes Graphite Ink at focus alongside the focus ring.
- Date ranges display explicit start and end dates. Repetition controls show weekday selection and course/term effective range in one readable group.
- Color picker uses labeled swatches with selection checkmark and accessible name.

### 5.4 Drawers, modals, menus, and Toasts

- Right drawer: 360px standard; 420px only for dense grade or rule editing. It becomes a content overlay below 1280px.
- Drawer and modal surfaces use Dense Frosted White over a subtle neutral scrim; no yellow scrim.
- Modal radius: 22px; width determined by content. Recovery preview and destructive scope dialogs cannot close by accidental outside click.
- Menus: 12px radius, strong enough solid fallback to preserve readability.
- Toast: compact bottom-right or bottom-center glass surface, visible for 6 seconds for reversible task actions; includes a text `撤销` action and never steals focus.

### 5.5 Lists and tables

- Use one shared frosted or solid surface with continuous row dividers.
- Row height: 52–60px depending on density.
- Selected rows use a control and label in addition to pale yellow tint.
- Hover actions cannot be the only way to discover an operation.
- Tight widths preserve name, status, and primary number; secondary fields move to details.
- Empty state occupies the table content area and states what is missing, why, and the next action.

### 5.6 Calendar

- Visual density follows Apple Calendar and Notion Calendar: small radii, concise labels, strong spatial alignment, light grid.
- The weekday header, all-day row, and time grid share the same seven columns.
- Vertical day separators are uninterrupted from the date header through the all-day row and the entire time grid.
- Time rules are continuous, 1px Whisper Line; hour labels use Quiet Ink and tabular numerals.
- Today uses a subtle neutral-yellow wash or small date marker, never a full saturated column.
- Reading Week is one continuous all-day bar across its visible range; do not repeat the label in each day.
- Overlapping events divide available width and remain separately clickable; no complete overlap.
- Dragging is optional enhancement. Every create/edit operation has a keyboard-usable form.

### 5.7 Metrics and progress

- Metrics must use real product state and a text label. Never invent decorative statistics.
- The Today summary contains only `今日已完成`, `今日待完成`, and `学期进度`.
- Semester progress is date-based and shown as a percentage with a compact horizontal track or text, not a task-completion donut.
- Charts in grades or attendance use thin lines, restrained course colors, direct labels, and a table/text alternative.

### 5.8 Empty, loading, and error states

- Empty state = named missing object + reason + one valid next step. No mascots, filler illustration, or `即将推出` card.
- Loading uses skeletons that match final geometry; no generic central spinner.
- Errors are scoped to the affected region, preserve usable cards, and provide retry or corrective action.
- Data status copy distinguishes local save, backup pending, backup failure, TBA, ungraded, zero, unknown weight, attendance unknown, holiday suppression, and semester ended.

## 6. Layout Principles

### 6.1 Desktop grid

- Use CSS Grid semantics: 12 columns, 20px standard gutters, 24px wide-screen gutters.
- Main content max-width: 1920px, centered after expansion. Do not stretch reading lines or card content indefinitely at 2560×1600.
- Outer padding: 24px at 1024–1279; 32px at 1280–1919; 48–64px at 1920 and above.
- Standard vertical section gap: 24px; title-to-content gap: 20px.
- Keep every element in its own spatial zone. No text/image overlap and no absolute-positioned content collisions.

### 6.2 Today bento composition

- The opening greeting and date are left-aligned; three factual summary metrics sit to the right on wide screens and wrap under the title on compact screens.
- First bento band: Today classes receives the largest vertical list area; the next small task and next big task use unequal spans; a compact Today status/action region connects them.
- Second band: real notices or setup continuation use a smaller left area; the weekly summary spans the remaining width.
- Preserve planned positions for future weekly-load and Pomodoro work without displaying dead cards or disabled controls in the MVP.
- Use asymmetric spans such as 4/3/2/3 and 4/8 rather than repeated equal thirds.

### 6.3 Other page compositions

- Courses: compact course collection with one primary create action; course detail uses an anchored summary plus sections for sessions, tasks, files, and grades according to scope.
- Tasks: filter/tool row above a shared list surface; task detail is a page or drawer depending on edit complexity.
- Files: folder/course context at left or top, shared list in the center, preview/details at right on wide screens.
- Grades: term and course summary first, grading scheme and recorded items below; Academic History is not an MVP navigation destination.
- Settings: category navigation with one main settings surface; no decorative dashboard cards.

### 6.4 Responsive desktop behavior

- **1920px and above:** expand to max 1920px, increase parallel panels and whitespace, retain readable internal widths.
- **1280–1919px:** standard desktop layout; primary design viewport 1440×900.
- **1024–1279px:** compact desktop; three/four columns become two, drawers overlay, tables retain essential columns.
- **Below 1024px:** preserve the compact desktop information architecture with scrolling. MVP does not introduce a separate phone navigation.
- Calendar always preserves seven-day semantics; allow grid-level horizontal scroll only when minimum readable day-column width cannot be maintained.
- No page-level horizontal overflow at any supported desktop size.

## 7. Motion & Interaction

- Default UI easing: `cubic-bezier(0.22, 1, 0.36, 1)`; use spring-like weight without bounce.
- Hover/focus response: 120–160ms. Drawers and modals: 180–240ms. Page content crossfade/translate: 160–220ms with no more than 8px travel.
- Lists may reveal in a short cascade of 20–30ms per item, capped at 180ms total. Do not make users wait for a long waterfall.
- Animate only transform and opacity when possible. Do not animate layout dimensions during ordinary interactions.
- Live timer may use one restrained sweep or pulse. Other dashboard cards remain still.
- Honor reduced motion: remove translation, scale, parallax, pulses, and spring effects; retain immediate state changes and short opacity fades.
- Task completion and skip update only after local persistence. Then show a 6-second undo Toast; the card state transition must not imply success before persistence.

## 8. Accessibility & State Semantics

- Meet WCAG 2.2 AA: body text 4.5:1; large text and non-text controls 3:1 where applicable.
- All core workflows are keyboard operable. Focus is restored to the trigger after a drawer or modal closes.
- Use text or icon-plus-text for completion, skipped, overdue, TBA, absence, ungraded, errors, and backup status.
- Keep focus visible above sticky headers, overlays, and Toasts.
- Screen readers receive save, failure, undo, integrity verification, and meaningful timer threshold announcements; do not announce a timer every second.
- Reduced transparency replaces glass with Solid Accessibility Surface and visible structural borders.
- Course swatches have accessible names and are always paired with course identity.

## 9. Screen-Specific Non-Negotiables

- **Welcome:** exactly two primary choices, `开始新的本地数据` and `从备份恢复`.
- **Setup:** interruptible checklist, real completion status, early access to Today, and `保护数据` only after the minimum setup condition.
- **Today:** always the launch destination when active data exists; show classes, next small task, next big task, weekly summary, and the three approved metrics.
- **Recurring instance scope:** from an instance offer only `仅本次` and `本次及未来`; delete the entire rule only in rule details with explicit impact.
- **Backup restore:** snapshot selection, integrity validation, and impact preview before any overwrite.
- **Attendance:** optional, default off, enabled from the current day forward only, with no retroactive mutation.
- **Calendar:** continuous day separators, one-piece visible holiday spans, no black exam blocks.
- **Grades:** separate current estimate, calculated final, manual final, and official record states; missing grades are never treated as zero.
- **Academic History:** document as a future extension only. Do not create an MVP navigation item or empty page.

## 10. Anti-Patterns (Banned)

- No emojis, decorative avatars, stock portraits, or unrelated lifestyle imagery.
- No Inter or serif typography.
- No pure black, neon glow, purple-blue AI gradients, or oversaturated accents.
- No full-page yellow cast; the warm gradient stays small and local.
- No large dark calendar events, exam cards, ordinary content cards, or empty-state panels.
- No three equal cards in a generic row; use purposeful asymmetric spans.
- No gradient headline text, glass-on-glass nesting without hierarchy, or excessive pill shapes.
- No invented stats, sample notifications, AI features, global search, social controls, or dead navigation.
- No generic future placeholders, `Coming soon`, disabled future tabs, or fake buttons.
- No color-only state, hover-only actions, drag-only calendar editing, or focus hidden behind overlays.
- No filler copy, motivational clichés, oversized marketing hero, or fake personal greetings unrelated to stored local data.
- No accidental destructive close, silent restore overwrite, or success state before local persistence.

## 11. Stitch Generation Contract

When generating screens, preserve the approved information architecture and Chinese product copy. Use realistic course identifiers only to demonstrate layout, and label generated values as design fixtures rather than implying stored user data. Never infer additional modules from reference imagery. If a reference image conflicts with this file or the approved UI specification, follow the approved specification.

Generate desktop screens at 1440×900 first and validate the same composition at 2560×1600, 1920×1080, 1280×720, and 1024×640. The design should remain spacious at large resolutions and usable at the compact minimum without changing product scope.
