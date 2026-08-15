# Stage 2 — Public Website Design

**Project:** VeilDrop — Post-Quantum Zero-Knowledge Anonymous Reporting & Secure Evidence Exchange Platform
**Date:** 2026-08-06
**Status:** Approved

---

## 1. Goal

Build the public-facing marketing website for VeilDrop: six pages that communicate trust, privacy, and technical seriousness to reporters and prospective organizational investigators. The site reuses the existing design-system foundation and the existing hash SPA router. The reporter wizard and investigator app are untouched.

## 2. Scope

- New pages: Home (extended), About, Security, Features, FAQ, Contact.
- Shared public shell: sticky responsive navbar + rich multi-column footer.
- Premium, accessible animations: scroll-reveal, scroll-aware navbar, hero cursor glow, auto-rotating testimonial carousel.
- Animated FAQ accordion, contact form (validate + toast), feature grids, security detail sections.
- Fully responsive (desktop / tablet / mobile) and WCAG 2.2 AA accessible.

Out of scope: any backend/API work, real contact-form submission, actual testimonials, compliance badges.

## 3. Architecture

Extends the existing hash router (`frontend/js/router.js` / `frontend/js/main.js`). All public pages render through one new module, `VeilSite`, using a shared `SiteShell`.

### New files

| File | Purpose |
|---|---|
| `frontend/js/site.js` | `VeilSite` module: page renderers, `SiteShell` (nav + footer), scroll-reveal observer, FAQ accordion, testimonial carousel, contact form handler. Includes a runnable self-check. |
| `frontend/css/site.css` | All public-site styles: page bodies, new sections, animations, carousel, accordion, contact form, rich footer, responsive rules. |

### Modified files

| File | Change |
|---|---|
| `frontend/js/main.js` | Register `/about`, `/security`, `/features`, `/faq`, `/contact` routes → `VeilSite.render(page, el)`. |
| `frontend/js/reporter.js` | Home page (`renderLanding`) refactored to use the shared `SiteShell` and the new sections; kept in the reporter module but delegating to shared shell. |
| `frontend/css/pages.css` | Minor additions only; existing landing layout reused. |

## 4. Routes & Pages

| Route | Page | Sections |
|---|---|---|
| `#/` | **Home** | Hero · Trust strip · How it works · Features grid · Technology · Privacy · Testimonials carousel · CTA |
| `#/about` | **About** | Page hero · Mission · Stats/metrics · Story · Principles · Team placeholders |
| `#/security` | **Security** | Page hero · Layered defense · Crypto deep-dive (HPKE, AES-256-GCM, HKDF) · Zero-knowledge explainer · Threat-model table · CTA |
| `#/features` | **Features** | Page hero · Grouped feature grid (Reporting / Investigation / Security) · Burn-on-read explainer · Evidence handling |
| `#/faq` | **FAQ** | Page hero · Category tabs · Animated accordion · Helpful CTA |
| `#/contact` | **Contact** | Page hero · Contact form (validate + toast) · Info cards · Response-time note |

## 5. Shared Shell

### SiteNav
- Sticky top, translucent with backdrop blur; gains a stronger shadow after scroll.
- Content: brand mark + name, 6 links (Home, About, Security, Features, FAQ, Contact), theme toggle, "Submit a report" primary CTA.
- Active link highlighted via `aria-current="page"`.
- Mobile (≤768): hamburger opens a slide-down panel; `aria-expanded` on the toggle; Escape closes and returns focus to the toggle; backdrop closes on click.
- Smooth-scroll to in-page anchors (`scroll-behavior: smooth`, respecting reduced motion).

### SiteFooter
- 4 columns: Brand + blurb; Product (features, security, submit); Resources (FAQ, contact, how it works); Legal (privacy, terms, security).
- Bottom bar: technology line ("AES-256-GCM · HPKE · Ed25519 · ML-KEM"), copyright, theme note.
- Same accent/neutral palette; no fabricated compliance logos.

## 6. Animation System

Implemented in `frontend/js/site.js`; CSS in `frontend/css/site.css`.

- **Scroll-reveal:** `IntersectionObserver` adds `.revealed` to `[data-reveal]` elements. Fade + translate-up (10px), optional per-element stagger via inline `--reveal-delay`. One-time; unobserve after reveal.
- **Scroll-aware navbar:** on scroll past a threshold, add `.scrolled` (deeper shadow, more opaque blur).
- **Hero cursor glow:** a pointer-following radial glow on the Home hero, GPU-friendly (transform-only), disabled when reduced motion or on coarse pointers.
- **Testimonial carousel:** auto-advances every 6s, pauses on hover/focus, prev/next buttons, dots, keyboard arrow navigation.
- All animations respect `prefers-reduced-motion` (global rule already exists in `base.css`).

## 7. Components (new)

### FAQ Accordion
- Button-based (not native `<details>`) for smooth height animation.
- ARIA: each trigger `role="tab"`/`aria-expanded`/`aria-controls`; each panel `role="tabpanel"`/`aria-labelledby`; ArrowUp/Down/Home/End keyboard navigation; `aria-hidden` on closed panels.
- Smooth max-height/opacity transition; respecting reduced motion.

### Testimonial Carousel
- `role="region"` + `aria-roledescription="carousel"` + labelled by visible heading.
- `aria-live="polite"`; slides in a track; prev/next buttons labelled; dots as buttons with `aria-label`.
- Auto-advance 6s; pauses on hover/focus; no autoplay when reduced motion.

### Contact Form
- Reuses existing `.field`, `.input`, `.textarea`, `.btn` components.
- Client-side validation (required, valid email). On valid submit: show success toast, reset form. No network call.
- Error messages use existing `.field-error` pattern; inline, not color-only.

## 8. Content Voice

Follows the existing VeilDrop voice in `frontend/README.md`: calm, precise, human. No fear-based copy, no absolute security claims ("100% anonymous", "unbreakable"). All security claims match the real architecture doc (`ARCHITECTURE.md`): AES-256-GCM, HKDF-SHA-256, HPKE (DHKEM-X25519), Ed25519 receipts, ML-KEM post-quantum path "planned".

## 9. Accessibility

- Semantic landmarks; single `h1` per page; correct heading order.
- Visible focus rings (existing `--focus-ring`).
- Skip link (existing in `base.css`).
- Touch targets ≥ 44px.
- Security state never communicated by color alone.
- Keyboard-navigable accordion and carousel.
- `aria-current` on active nav; labelled nav/footer landmarks.

## 10. Responsive

- **Desktop (>1024):** content max-width 1200px; hero 2-col; feature grids 3-col.
- **Tablet (≤1024):** hero stacks 1-col (hero art hidden); grids 2-col.
- **Mobile (≤768):** hamburger nav; footer stacks 2-col; grids 1-col; carousel dots hidden; accordion full-width.
- Reuses existing responsive breakpoints in `pages.css` where possible.

## 11. Testing

- `frontend/js/site.js` ships a self-check (runnable under Node): asserts all 6 routes resolve to a renderer, `SiteShell` mounts nav+footer with landmark h1, and the accordion / carousel / reveal helpers are present.
- Manual browser pass on the running app: all 6 pages render, responsive at 3 widths, light + dark theme, animations + reduced-motion, keyboard nav on accordion/carousel/mobile menu.

## 12. Non-Goals

- No new build tooling / framework.
- No new third-party animation or UI libraries.
- No backend integration for the contact form.
- No changes to the reporter wizard or investigator app.
