#!/usr/bin/env python3
"""Dynamic WCAG 2.2 AA audit for VeilDrop — browser-driven checks.

Complements the static audit (wcag-audit.cjs) with behaviors that only a real
browser can verify:

  2.4.3/2.4.7  tab order matches DOM order; every stop has a visible focus
               indicator and is on-screen
  2.4.1        skip link is the first tab stop and jumps into #main
  1.3.1        one h1 per view, no skipped heading levels, landmarks present
  4.1.2        FAQ accordion aria-expanded toggles and panel visibility follows
  3.3.1        3.3.2  contact form errors: aria-invalid, focus moves, toast
  4.1.3        status messages use role=status/alert live regions
  2.3.3        prefers-reduced-motion actually stops animation/transition
  1.4.10       no horizontal scroll at 320px viewport (reflow)

Starts the app on 127.0.0.1:8000 automatically if it is not already running
(uvicorn from backend/), and stops it on exit unless --keep-server.

Usage:
  python frontend/tests/wcag-dynamic-audit.py [--url http://127.0.0.1:8000]
                                              [--keep-server]
Requires: python -m pip install playwright && python -m playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT.parent / "backend"

FOCUS_SEL = (
    "a[href], button, input, select, textarea, summary, "
    "[tabindex='0'], [contenteditable='true']"
)

PUBLIC_VIEWS = ["", "about", "security", "features", "faq", "contact"]
APP_VIEWS = ["submit", "access", "investigator/login"]
ALL_VIEWS = PUBLIC_VIEWS + APP_VIEWS


class Results:
    def __init__(self) -> None:
        self.pass_: list[str] = []
        self.warn: list[str] = []
        self.fail: list[str] = []

    def ok(self, msg: str) -> None:
        self.pass_.append(msg)

    def warn_issue(self, msg: str) -> None:
        self.warn.append(msg)

    def fail_issue(self, msg: str) -> None:
        self.fail.append(msg)

    def summary(self) -> str:
        lines = ["\n=== VeilDrop WCAG 2.2 AA dynamic audit ==="]
        lines.append(f"PASS: {len(self.pass_)}  WARN: {len(self.warn)}  FAIL: {len(self.fail)}")
        for group, label in ((self.warn, "Warnings"), (self.fail, "Failures")):
            if group:
                lines.append(f"\n-- {label} --")
                lines.extend(f"  - {w}" for w in group)
        lines.append(f"\nRESULT: {'PASS (no dynamic AA failures)' if not self.fail else 'FAIL'}")
        return "\n".join(lines)


def server_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def boot_server() -> subprocess.Popen | None:
    if server_running("http://127.0.0.1:8000"):
        return None
    print("[wcag-dyn] starting uvicorn on 127.0.0.1:8000 ...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(BACKEND),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        if server_running("http://127.0.0.1:8000"):
            return proc
        time.sleep(0.5)
    proc.terminate()
    raise RuntimeError("app did not become ready on 127.0.0.1:8000")


def desc(el) -> str:
    tag = el.evaluate("e => e.tagName.toLowerCase()")
    ident = el.get_attribute("id")
    cls = el.get_attribute("class")
    bits = [tag]
    if ident:
        bits.append(f"#{ident}")
    if cls:
        bits.append(f".{cls.split()[0]}")
    return "".join(bits)


def visible_focusables(page) -> list:
    """Focusable elements in DOM order, excluding hidden/disabled/roving-tabindex ones.

    tabindex="-1" elements are kept out of the sequence: they are focusable via
    script but intentionally skipped by sequential navigation (ARIA tabs/accordions
    use this roving-tabindex pattern).
    """
    out = []
    for el in page.query_selector_all(FOCUS_SEL):
        try:
            ti = el.get_attribute("tabindex")
            if ti is not None and int(ti) < 0:
                continue
            if el.is_visible() and not el.is_disabled():
                out.append(el)
        except Exception:
            continue
    return out


def check_tab_order(page, results: Results, view: str) -> None:
    expected = visible_focusables(page)
    page.evaluate("document.activeElement && document.activeElement.blur()")
    actual: list[str] = []
    for _ in range(len(expected)):
        page.keyboard.press("Tab")
        active = page.evaluate(
            "() => { const e = document.activeElement; "
            "if (!e || e === document.body) return 'BODY'; "
            "const t = e.tagName.toLowerCase(); "
            "const i = e.id ? '#' + e.id : ''; "
            "const c = e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''; "
            "return t + i + c; }"
        )
        actual.append(active)
        if active != "BODY" and not active.startswith("a.skip-link"):
            el = page.evaluate_handle("document.activeElement").as_element()
            try:
                el.scroll_into_view_if_needed(timeout=800)
            except Exception:
                pass
            box = page.evaluate(
                """() => { const r = document.activeElement.getBoundingClientRect();
                    return [r.left, r.top, r.right, r.bottom]; }"""
            )
            in_view = box[0] >= -2 and box[1] >= -2 and box[2] <= 1282 and box[3] <= 802
            if not in_view:
                results.fail_issue(
                    f"2.4.3 {view}: tabbed element {active} cannot be scrolled into view ({box})"
                )
    expected_desc = [desc(el) for el in expected]

    ok = True
    for i, (exp, got) in enumerate(zip(expected_desc, actual)):
        if exp != got:
            ok = False
            results.fail_issue(
                f"2.4.3 {view}: tab stop {i + 1} — expected {exp}, got {got} (focus order != DOM order)"
            )
            break
    if ok:
        results.ok(f"2.4.3 {view}: tab order follows DOM order ({len(expected_desc)} stops)")
    elif expected_desc and expected_desc[0] != actual[0]:
        results.fail_issue(f"2.4.1 {view}: first tab stop is {actual[0]}, expected the skip link ({expected_desc[0]})")

    for el in expected:
        el.focus()
        styles = el.evaluate(
            """e => {
                const s = getComputedStyle(e);
                return { outline: s.outlineStyle, outlineW: s.outlineWidth, shadow: s.boxShadow };
            }"""
        )
        indicator = styles["outline"] != "none" or styles["outlineW"] not in ("0px", "") or styles["shadow"] != "none"
        d = desc(el)
        if not indicator:
            results.fail_issue(f"2.4.7 {view}: {d} has no visible focus indicator")


def check_headings_landmarks(page, results: Results, view: str, is_public: bool) -> None:
    h1s = page.query_selector_all("main h1, .site-main h1, h1")
    h1_visible = [h for h in h1s if h.is_visible()]
    if len(h1_visible) == 1:
        results.ok(f"1.3.1 {view}: exactly one visible h1")
    else:
        results.fail_issue(f"1.3.1 {view}: expected 1 visible h1, found {len(h1_visible)}")

    levels = [
        int(h.evaluate("e => e.tagName[1]"))
        for h in page.query_selector_all("h1, h2, h3, h4, h5, h6")
        if h.is_visible()
    ]
    skips = [levels[i] for i in range(1, len(levels)) if levels[i] - levels[i - 1] > 1]
    if skips:
        results.warn_issue(f"1.3.1 {view}: heading level skipped before h{skips[0]}")
    else:
        results.ok(f"1.3.1 {view}: heading hierarchy has no skipped levels")

    for landmark in (["header", "nav", "main", "footer"] if is_public else ["nav", "main"]):
        if page.query_selector(landmark) and page.query_selector(f"{landmark}").is_visible():
            results.ok(f"1.3.1 {view}: <{landmark}> landmark present")
        else:
            results.fail_issue(f"1.3.1 {view}: <{landmark}> landmark missing or hidden")


def check_skip_link(page, results: Results, view: str) -> None:
    """Functional skip-link check on a fresh page: first Tab focuses it, Enter jumps to #main."""
    skip = page.query_selector(".skip-link")
    if not skip:
        results.warn_issue(f"2.4.1 {view}: no .skip-link element")
        return
    href = skip.get_attribute("href")
    if href != "#main" or not page.query_selector("#main"):
        results.fail_issue(f"2.4.1 {view}: skip-link href={href!r} does not target #main")
        return
    page.keyboard.press("Tab")
    page.wait_for_timeout(500)
    focused = page.evaluate("document.activeElement && document.activeElement.className || ''")
    if "skip-link" not in focused:
        results.fail_issue(f"2.4.1 {view}: first tab stop is not the skip link")
        return
    box = page.evaluate(
        "() => { const r = document.querySelector('.skip-link').getBoundingClientRect(); return [r.top, r.bottom]; }"
    )
    if box[1] < 0:
        results.fail_issue(f"2.4.1 {view}: skip link stays off-screen when focused ({box})")
    page.keyboard.press("Enter")
    time.sleep(0.2)
    in_main = page.evaluate(
        "() => { const a = document.activeElement; const m = document.getElementById('main'); "
        "return m && (a === m || (a && m.contains(a))); }"
    )
    if in_main:
        results.ok(f"2.4.1 {view}: skip link is first tab stop and jumps into #main")
    else:
        results.warn_issue(f"2.4.1 {view}: after skip-link Enter, focus is not inside #main")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--keep-server", action="store_true", help="do not stop an auto-started server")
    args = parser.parse_args()

    proc = boot_server()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed: python -m pip install playwright && python -m playwright install chromium")
        return 2

    results = Results()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()

            def new_page(width: int = 1280, height: int = 800, reduced_motion: bool = False):
                pg = browser.new_page(viewport={"width": width, "height": height})
                if reduced_motion:
                    pg.emulate_media(reduced_motion="reduce")
                return pg

            for idx, view in enumerate(ALL_VIEWS):
                url = f"{args.url}/#/{view}" if view else f"{args.url}/#/"
                page = new_page()
                try:
                    page.goto(url, wait_until="load", timeout=15000)
                    page.wait_for_selector("#main, main, .site-nav", timeout=10000)
                    page.wait_for_timeout(350)
                except Exception as e:
                    results.fail_issue(f"navigation {view}: {e}")
                    page.close()
                    continue

                label = view or "home"
                is_public = view in PUBLIC_VIEWS
                check_headings_landmarks(page, results, label, is_public)
                check_tab_order(page, results, label)
                page.close()

            # 2.4.1 functional skip-link test on its own fresh page
            try:
                page = new_page()
                page.goto(f"{args.url}/#/", wait_until="load", timeout=15000)
                page.wait_for_selector("#main, main, .site-nav", timeout=10000)
                page.wait_for_timeout(350)
                check_skip_link(page, results, "home")
                page.close()
            except Exception as e:
                results.fail_issue(f"2.4.1 home: {e}")

            # 4.1.2 FAQ accordion
            try:
                page = new_page()
                page.goto(f"{args.url}/#/faq", wait_until="load")
                page.wait_for_selector(".faq-q", timeout=10000)
                q = page.query_selector(".faq-q")
                before = q.get_attribute("aria-expanded")
                q.click()
                page.wait_for_timeout(300)
                after_open = q.get_attribute("aria-expanded")
                panel_id = q.get_attribute("aria-controls")
                panel = page.query_selector(f"#{panel_id}") if panel_id else None
                open_visible = bool(panel and panel.is_visible())
                q.click()
                page.wait_for_timeout(300)
                after_close = q.get_attribute("aria-expanded")
                closed_visible = bool(panel and panel.is_visible())
                if before == "false" and after_open == "true" and open_visible and after_close == "false" and not closed_visible:
                    results.ok("4.1.2 faq: aria-expanded toggles and panel visibility follows")
                else:
                    results.fail_issue(
                        f"4.1.2 faq: expand {before}->{after_open} (panel visible: {open_visible}), "
                        f"collapse ->{after_close} (panel visible: {closed_visible})"
                    )
                still_focused = page.evaluate("document.activeElement === document.querySelector('.faq-q')")
                if not still_focused:
                    results.warn_issue("4.1.2 faq: focus does not stay on the accordion button")
                page.close()
            except Exception as e:
                results.fail_issue(f"4.1.2 faq: {e}")

            # 3.3.1 / 3.3.2 / 4.1.3 contact form
            try:
                page = new_page()
                page.goto(f"{args.url}/#/contact", wait_until="load")
                page.wait_for_selector("#contact-form", timeout=10000)
                note = page.query_selector("#contact-form-note")
                if not note or note.get_attribute("role") != "status" or note.get_attribute("aria-live") != "polite":
                    results.fail_issue("4.1.3 contact: #contact-form-note is not role=status aria-live=polite")
                else:
                    results.ok("4.1.3 contact: status note is a polite live region")

                page.query_selector("#contact-form button[type='submit']").click()
                page.wait_for_timeout(250)
                invalid = page.evaluate(
                    """() => [...document.querySelectorAll('#cf-name,#cf-email,#cf-subject,#cf-message')]
                        .every(i => i.getAttribute('aria-invalid') === 'true')"""
                )
                first_focused = page.evaluate("document.activeElement.id === 'cf-name'")
                toast = page.query_selector(".toast-root .toast")
                toast_role = toast.get_attribute("role") if toast else None
                if invalid and first_focused:
                    results.ok("3.3.1/3.3.2 contact: empty submit sets aria-invalid and moves focus to first error")
                else:
                    results.fail_issue(f"3.3.1 contact: invalid={invalid}, first-invalid-focused={first_focused}")
                if toast and toast_role == "status":
                    results.ok("4.1.3 contact: error toast is a live region (role=status)")
                else:
                    results.warn_issue(f"4.1.3 contact: error toast role={toast_role!r}")

                for ident, value in (("cf-name", "Ada"), ("cf-email", "ada@example.com"), ("cf-subject", "Hi"), ("cf-message", "Hello")):
                    page.fill(f"#{ident}", value)
                page.query_selector("#contact-form button[type='submit']").click()
                page.wait_for_timeout(300)
                note_text = page.evaluate("document.getElementById('contact-form-note').textContent || ''")
                if note_text.strip():
                    results.ok("4.1.3 contact: successful submit updates the live status note")
                else:
                    results.warn_issue("4.1.3 contact: status note stayed empty after valid submit")
                page.close()
            except Exception as e:
                results.fail_issue(f"3.3.1 contact: {e}")

            # 2.3.3 reduced motion
            try:
                rm_page = new_page(reduced_motion=True)
                rm_page.goto(f"{args.url}/#/", wait_until="load")
                rm_page.wait_for_selector("main, .site-nav", timeout=10000)
                rm_page.wait_for_timeout(400)
                durations = rm_page.evaluate(
                    """() => [...document.querySelectorAll('[data-reveal], .carousel-track, .hero, .trust-item')]
                        .slice(0, 5).map(e => {
                            const s = getComputedStyle(e);
                            return s.transitionDuration + '/' + s.animationDuration;
                        })"""
                )
                def secs(d: str) -> float:
                    d = d.strip()
                    if d.endswith("ms"):
                        return float(d[:-2]) / 1000.0
                    return float(d.rstrip("s"))

                too_fast = all(
                    all(d in ("0s", "0ms", "none") or secs(d) <= 0.001 for d in pair.split("/"))
                    for pair in durations
                )
                if durations and too_fast:
                    results.ok(f"2.3.3 reduced-motion: animated elements clamped ({durations[0]})")
                else:
                    results.fail_issue(f"2.3.3 reduced-motion: durations not clamped: {durations}")
                rm_page.close()
            except Exception as e:
                results.fail_issue(f"2.3.3 reduced-motion: {e}")

            # 1.4.10 reflow at 320px
            for view in ["", "submit"]:
                try:
                    small = new_page(width=320, height=640)
                    small.goto(f"{args.url}/#/{view}" if view else f"{args.url}/#/", wait_until="load")
                    small.wait_for_selector("main, .site-nav", timeout=10000)
                    small.wait_for_timeout(350)
                    overflow = small.evaluate(
                        "() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth"
                    )
                    if overflow <= 1:
                        results.ok(f"1.4.10 reflow: no horizontal scroll at 320px on {'home' if not view else view}")
                    else:
                        results.fail_issue(f"1.4.10 reflow: {overflow}px horizontal overflow at 320px on {'home' if not view else view}")
                    small.close()
                except Exception as e:
                    results.fail_issue(f"1.4.10 reflow {view or 'home'}: {e}")

            browser.close()
    except Exception as e:
        results.fail_issue(f"audit run aborted: {e}")

    print(results.summary())
    if proc and not args.keep_server:
        proc.terminate()
    return 1 if results.fail else 0


if __name__ == "__main__":
    sys.exit(main())
