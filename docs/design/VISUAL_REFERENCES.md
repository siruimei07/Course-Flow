# CourseFlow Visual Reference Register

> Purpose: retain the design intent extracted from the user-provided reference images without treating reference-image content as product requirements or reusable production assets.
> Authority: approved CourseFlow UI specification and `DESIGN.md` take precedence whenever a reference conflicts with product scope or interaction semantics.

| Ref | Attachment filename | What CourseFlow retains | What CourseFlow does not copy |
|---|---|---|---|
| VR-01 | `codex-clipboard-aafe0ac0-ad2a-4605-9cc2-6fd1742da377.png` | Original CourseFlow Today information set: classes, next action, weekly load position, term summary, compact top navigation | AI configuration, profile/notification controls, unapproved metrics, and the exact card styling |
| VR-02 | `codex-clipboard-cb88e004-108d-40d3-ad7e-460c7510f8ef.png` | Energetic asymmetric Today composition and varied card proportions | Screenshot-specific user identity, fictitious statistics, and dark oversized regions |
| VR-03 | `codex-clipboard-a976aea8-e69a-4bb1-a214-58eb62930241.png` | Bento rhythm, varied card heights, clear data hierarchy, and compact charts | Team-management content, avatars, audio controls, and black analytics panels |
| VR-04 | `codex-clipboard-26b4114e-70cc-4309-b7ab-a679f40b21b1.png` | Wide desktop frame, pill navigation, controlled whitespace, local yellow light, and asymmetric dashboard grid | HR-specific content, portrait card, onboarding stack, and exact text |
| VR-05 | `codex-clipboard-53a709e2-82d4-45e4-a2c3-9b4efba41390.png` | Primary layout reference: top navigation, title/metrics band, varied dashboard modules, white-to-warm-yellow ambient background | Employee statistics, salary/device content, portrait imagery, and broad yellow coverage |
| VR-06 | `codex-clipboard-0b5bd8fb-21e0-48ae-8152-b1c7036cf170.png` | Translucent surfaces receiving color from the background, large-radius framing, and calendar whitespace | Birthday/profile imagery and organization analytics |
| VR-07 | `codex-clipboard-1047b049-10c1-45e0-a9d4-59e2805aaeaa.png` | Shared table surface, filter/tool row, restrained selected-row highlight, and wide-screen density | People-directory fields, flags, salaries, and status vocabulary |
| VR-08 | `codex-clipboard-091fecfb-18eb-4576-8b8a-aa801ee7b4d0.png` | Large central workspace with a secondary right rail and local warm background emphasis | Map/device/session content and permanent dark rail styling |
| VR-09 | `codex-clipboard-d82b781f-66d8-46bf-8fe7-311794801f3e.png` | Narrow schedule rail, varied panel spans, thin charts, and balanced neutral/yellow/charcoal hierarchy | HR attendance dashboard content and large dark report card |
| VR-10 | `codex-clipboard-adc72649-944f-4a63-9b62-a52b5ff9298b.png` | Requirement evidence that day-column separators remain continuous through header, all-day area, and time grid | Interrupted separators and black exam blocks shown in the interim draft |
| VR-11 | `codex-clipboard-9afc596a-10dc-47c5-a6b3-4f42c7b98e1e.png` | Apple Calendar / Notion Calendar-inspired density, light event fills, concise text, continuous grid, and one Reading Week bar | Notion sidebars, account controls, and exact calendar color assignments |
| VR-12 | `codex-clipboard-372b549c-effe-43cf-8a16-4a027bfa63d2.png` | Candidate course-color families: red, orange, yellow, green, blue, purple, and gray | Exact final values; CourseFlow uses calibrated accessible values from `DESIGN.md` |
| VR-13 | `codex-clipboard-546689af-305b-4cfe-a82f-6cfc531ddfea.png` | Problem evidence for rendering a continuous multi-day holiday span | One separate holiday chip per day |

## Composition framework

The retained framework is a desktop-first 12-column grid with a 1920px maximum content width. The Today page uses asymmetric bento spans; dense modules such as calendars and tables use one continuous surface rather than nested cards. Ordinary cards are colorless translucent white glass, while the page background supplies a small warm-yellow glow. Course color is categorical data, not a second product accent.

Stitch prompts must cite references by `VR-*` intent rather than asking Stitch to reproduce a source image. This keeps CourseFlow visually original and prevents unrelated reference content from entering the product.
