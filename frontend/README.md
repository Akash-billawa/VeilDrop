# VeilDrop — Frontend Master Spec

Post-Quantum Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform

This document is the single source of truth for the frontend implementation. It defines the design system, the token map, the page inventory, and the order in which screens are implemented. Screens are implemented in dependency order (design foundation → shared components → reporter journey → investigator journey).

---

## 1. Design Philosophy

VeilDrop handles extremely sensitive reports and evidence. The interface must communicate **trust, privacy, control, safety, and seriousness**.

It feels like premium financial infrastructure + privacy software + enterprise security operations — sophisticated, not flashy. No hacker-terminal clichés, no neon green, no skulls, no glassmorphism everywhere, no rainbow dashboards.

> "This system takes my information seriously."

## 2. Visual Language

- **Color:** restrained neutral palette. Deep charcoal / near-black / graphite / soft white surfaces. One sophisticated accent for primary actions, active nav, selection, focus, and important security indicators. Semantic colors (success / warning / danger / info) only where meaningful.
- **Typography:** premium modern sans (Inter), clear hierarchy `Display → Heading → Section → Body → Label → Metadata`. Technical identifiers (Case IDs, crypto versions) use a monospace face (JetBrains Mono).
- **Spacing:** generous whitespace, strict 4px scale. Nothing cramped.
- **Corners:** subtle modern rounding (6 / 10 / 14 / 20). Avoid pill-shaped everything.
- **Borders:** thin, low-contrast borders for structure.
- **Shadows:** extremely subtle elevation, no floating-card drama.

## 3. Token Map (single source of values)

Every value used in the product comes from one of the token groups below. No arbitrary CSS values.

| Group | Prefix | Example tokens |
|---|---|---|
| Color | `--bg`, `--surface`, `--text`, `--border`, `--accent`, `--success`, `--warning`, `--danger`, `--info` | `--surface-2`, `--text-secondary`, `--accent-hover` |
| Typography | `--font-sans`, `--font-mono`, `--fs-*`, `--lh-*`, `--fw-*` | `--fs-display: 44px`, `--fs-3xl: 32px`, `--fs-xs: 12px` |
| Spacing | `--sp-*` | `--sp-1: 4px` … `--sp-16: 64px` |
| Radius | `--r-*` | `--r-sm: 6px`, `--r-md: 10px`, `--r-lg: 14px`, `--r-xl: 20px` |
| Border | `--border-width`, `--border-strong` | `1px`, elevated border for interactive rows |
| Elevation | `--shadow-xs/sm/md/lg` | subtle |
| Motion | `--dur-1: 150ms`, `--dur-2: 250ms`, `--ease` | cubic-bezier(0.2, 0, 0, 1) |
| Z-index | `--z-nav`, `--z-overlay`, `--z-dialog`, `--z-toast`, `--z-palette` | |

Light and dark themes are implemented as `:root` (light defaults) and `[data-theme="dark"]` overrides. Theme is persisted in `localStorage` and respects `prefers-color-scheme` on first visit.

## 4. Component Inventory

All components live in `css/components.css` and support Default / Hover / Focus / Active / Disabled / Loading / Error states where applicable.

**Navigation** — Sidebar, TopBar, MobileNavigation, Tabs
**Inputs** — TextInput, SecretInput, Textarea, Select, Checkbox, Radio, FileUploader, Search
**Actions** — PrimaryButton, SecondaryButton, DangerButton, IconButton, CopyButton
**Data** — Table, DataCard, Badge, Timeline, FileRow, MetricCard, AuditEvent
**Feedback** — Toast, Alert, Banner, Dialog, Drawer, Tooltip, Skeleton, ProgressState
**Security** — SecurityBadge, RecoveryCredential, IntegrityStatus, CryptoVersion, RecipientList, ReceiptStatus, BurnMessage

## 5. Accessibility

WCAG 2.2 AA. Semantic HTML, full keyboard navigation, visible focus rings, screen-reader labels, accessible dialogs, correct heading order, contrast compliance, `prefers-reduced-motion`, touch targets ≥ 44px. Security state is never communicated by color alone (`✓ Integrity verified`).

## 6. Copy Style

Calm, clear, precise, human. No jargon on reporter screens. No fear-based copy ("Your identity is at risk!"), no absolute claims ("100% anonymous", "Unbreakable encryption").

## 7. Page Inventory & Route Map (hash router)

| Route | Screen | Audience |
|---|---|---|
| `#/` | Landing (hero, trust, how it works) | public |
| `#/submit` | Submit report wizard (details → evidence → review → protect & submit → case created) | reporter |
| `#/access` | Access existing case | reporter |
| `#/case` | Reporter case workspace (conversation / evidence / details) | reporter |
| `#/investigator/login` | Investigator login (passkey + password) | investigator |
| `#/investigator/overview` | Overview dashboard + priority queue | investigator |
| `#/investigator/cases` | Cases queue + filters + table | investigator |
| `#/investigator/critical` | Critical cases queue | investigator |
| `#/investigator/case` | Case workspace (conversation / evidence / timeline / security) | investigator |
| `#/investigator/security` | Security center | security admin |
| `#/investigator/audit` | Audit log | security admin |
| `#/investigator/settings` | Settings | investigator |

## 8. Implementation Order

1. Foundation — `index.html`, `css/tokens.css`, `css/base.css`
2. Design system — `css/components.css`, `js/theme.js`, `js/ui.js` (toast / dialog / copy / skeleton)
3. Core — `js/router.js`, `js/mock-data.js`
4. Reporter journey — landing → submit → case created → access → reporter case workspace
5. Investigator journey — login → shell → overview → cases → critical → case workspace → security → audit
6. Polish — responsive, empty/error/loading states, reduced-motion, keyboard, verification

## 9. Non-Goals

Backend architecture, databases, encryption, authentication servers, and infrastructure are **out of scope**. All interactions are polished mock states driven by client-side mock data, with realistic sequences and no fake percentages.
