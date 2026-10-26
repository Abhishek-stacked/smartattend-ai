# UI Wireframes (low fidelity)

Design system: aurora mesh background (indigo → cyan → violet glows over a pale blue-grey
base), glass "panel" surfaces with inset top highlights and coloured outer shadows, gradient
hairlines on card edges, brand indigo → cyan accent ramp, Inter/system font, 8-px spacing
grid, WCAG AA contrast, lucide icons, focus rings on all interactive elements.

Depth is expressed with four reusable utilities in `frontend/src/index.css`:
`.panel` (frosted surface + layered shadow), `.panel-edge` (2-px gradient hairline on the top
edge), `.panel-lift` (3-px lift + deeper shadow on hover), `.press-3d` (2-px press with scale
on `:active`). `.orb` provides the blurred coloured glows used behind hero panels and the
sidebar.

## App shell (all authenticated pages)
```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ ◉ SmartAttend│  Breadcrumb › Page                         🔔  (JD) ▾   │
│  (dark       ├──────────────────────────────────────────────────────────┤
│   aurora     │  Page title                                [Primary CTA] │
│   sidebar    │  One-line description                                    │
│   + glows)   │  ┌ content ──────────────────────────────────────────┐   │
│ ▣ Dashboard  │  │                                                   │   │
│ ☺ Students   │  └───────────────────────────────────────────────────┘   │
│ ☺ Faculty    │                                                          │
│ ▤ Courses    │                                                          │
│ ◷ Sessions   │                                                          │
│ ◎ Live       │                                                          │
│ ✓ Records    │                                                          │
│ ⚑ Review     │                                                          │
│ ✎ Corrections│                                                          │
│ ▦ Reports    │                                                          │
│ ⚙ Settings   │                                                          │
│ « collapse   │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```
Mobile: sidebar becomes a slide-over drawer opened from a hamburger in the top bar.
Navigation items are filtered by role (admin / faculty / student).
The active item is a gradient pill with a translucent white ring; inactive items dim on hover.

## Admin dashboard
```
[Students] [Faculty] [Courses] [Sessions today] [Recorded today]
[Present]  [Absent]  [Late]    [Avg attendance %] [Pending corrections]
Filters: date range ▾  course ▾
┌ Attendance trend (day|week|month tabs, line) ┐ ┌ Status distribution (donut) ┐
└──────────────────────────────────────────────┘ └─────────────────────────────┘
┌ Course-wise attendance % (bar) ──────────────┐ ┌ Recent activity list ───────┐
```
Stat tiles are gradient panels with a blurred accent orb in the corner, a gradient-clipped
number and a hover lift.

## Live attendance
```
Session: [CS301 – Lecture 4 ▾]  status ● Active   [Start camera] [Stop camera]
┌──────────── video 640×480 ─────────────┐  ┌ Status panel ─────────────────┐
│   ┌──────┐ green = recorded            │  │ Camera: ready   Model: ready  │
│   │ face │ amber = review/low conf      │  │ Last result: Recorded ✓       │
│   └──────┘ red = unknown/liveness fail │  │ Present 18/42   Late 2        │
└────────────────────────────────────────┘  │ Event feed (latest first)     │
                                            │ 10:02 Asha R. – present ✓     │
                                            │ 10:02 Unknown face – review   │
                                            └───────────────────────────────┘
[Manual attendance] opens roster dialog (non-biometric alternative)
```
States shown: camera inactive / permission requested / ready / face detected / quality
insufficient / processing / recognized / unknown / liveness pending / liveness failed /
recorded / duplicate prevented / review required / backend or camera error.

## Facial enrollment (stepper)
`1 Select student → 2 Privacy notice & consent → 3 Camera & capture (3–5 samples with live
quality hints) → 4 Review & submit → 5 Result`

## Courses → students → class
```
Course row: [CS301 · Database Systems] [11 students] [Schedule] [Roster] [Edit]
Create course ──▶ roster opens ──▶ search and add students ──▶ [Schedule class]
Schedule class: title, date, starts, ends ──▶ opens the new session with every student on the roster
```
Students added to a course later also join its open sessions (`scheduled`/`active`/`paused`);
finalized sessions keep their original roster.

## Admin entry forms
Add student / Add faculty / Create course: department (and programme) are never pre-filled —
the field is empty with a greyed example, and the form refuses to submit with a clear message
instead of assuming a branch. Every password input carries an eye toggle that reveals the
typed value and hides it again.

## Session detail — student self-marking controls
```
┌ Session meta ─ 6 tiles: course | date | start | end | status | late cutoff ┐
┌ Counts ───────────────────── present | late | absent | review | excused ┐

Student self-marking                          [ ●──── ]  ← admin switch
When enabled, students can mark their own attendance between the scheduled
start and the close of the attendance window. You can still lock any
individual student below.

Roster table
  Student        Status      Source        Self-marking
  Asha Rao       present     self_reported  [ Lock ]
  Ben Iyer       —           —              [ Lock ]
```
The switch is admin-only; the per-student lock is available to admin and to the faculty
owning the course. The switch and the text block share a row so the control stays
right-aligned on narrow screens.

## Student portal
```
Hello, Asha        Overall 86.4 %  Present 38  Late 4  Absent 7
┌ Course-wise % (bars) ┐ ┌ History table: date | course | session | status | source | ⋯ ┐
[Request correction]   Privacy & biometrics: status, withdraw consent / delete templates
```

## Student mark-attendance page (live self-marking)
```
┌ Today's sessions ────────────────────────────────────────────────────────┐
│  ┌ OPEN NOW ─ dark aurora hero, spans 2 columns ──────────────────────┐  │
│  │ ● Live now   AIML01 · Gen AI                                       │  │
│  │ Lecture 6 – Self-marking demo                                     │  │
│  │ Closes in 24:10        [ ● Mark me present ]                       │  │
│  │ (blurred brand + accent orbs behind the content)                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ┌ Later today ──────────────────────────────────────────────────────┐  │
│  │ CS301 · Lecture 4    14:00 – 15:00    Self-marking opens then     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```
The "Mark me present" button only exists while the window is open. If the session has not
started, or the window has closed, or the student is locked out, the hero is replaced by the
same reason text that the API returns in `self_marking_message`. Pressing the button marks
the student `present` (or `late` past the cutoff) with `source = self_reported`; a second
press does nothing and never overwrites an existing record.

## Login
```
┌───────────────┬─────────────────────────────────────┐
│  ◉ SmartAttend│                                     │
│  head-line     │   Sign in                          │
│  feature cards │   [email            ] [eye]        │
│  (icon chips)  │   [password         ] [eye]        │
│  3-D scan      │   [   Sign in   ]                  │
│  motif (rings, │   error alert                      │
│  glow, scan    │                                     │
│  line)         │                                     │
└───────────────┴─────────────────────────────────────┘
```
The left panel is a dark aurora hero with concentric scan rings, a glowing orb and a scan
line; it is hidden below the `xl` breakpoint so the mobile layout is a single column.
