#!/usr/bin/env node
/**
 * VeilDrop static WCAG 2.2 AA audit (no external deps).
 *
 * Statically checks what is machine-verifiable without a browser:
 *   - index.html: lang, title, viewport, skip-link, tabindex, img alt, autofocus
 *   - CSS: focus-visible indicator exists; token color contrast (light + dark)
 *         for documented pairs and for color/background pairs used in rules
 *   - JS: positive tabindex, empty aria-label, autofocus, bare <img>
 *
 * Dynamic, rendered-DOM checks (headings order, aria-expanded state, etc.) are
 * explicitly listed as "manual" at the end of the report.
 *
 * Usage: node frontend/tests/wcag-audit.cjs
 * Exit code 0 = no AA failures; 1 = failures found (warnings don't fail).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FAIL = [];
const WARN = [];
const PASS = [];
const MANUAL = [];

const relLuminance = (hex) => {
  if (typeof hex !== "string") return null;
  const n = hex.replace("#", "");
  if (n.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (a, b) => {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = [Math.max(la, lb), Math.min(la, lb)];
  return (hi + 0.05) / (lo + 0.05);
};

function parseTheme(cssText, selector) {
  const tokens = {};
  for (const m of cssText.matchAll(/([^\s{]+)\s*\{([^}]*)\}/g)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (sel !== selector) continue;
    for (const line of m[2].split(";")) {
      const kv = line.match(/^\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*$/);
      if (kv) tokens[kv[1]] = kv[2];
    }
  }
  return tokens;
}

const resolveColor = (value, tokens) => {
  const m = String(value).trim().match(/var\(\s*(--[\w-]+)\s*\)/);
  if (m) return tokens[m[1]] || null;
  const hex = String(value).trim().match(/^#[0-9a-fA-F]{6}$/);
  return hex ? hex[0] : null;
};

function checkContrast(fg, bg, label, large = false) {
  const ratio = contrastRatio(fg, bg);
  if (ratio == null) return;
  const min = large ? 3.0 : 4.5;
  if (ratio < min) {
    FAIL.push(`1.4.3 contrast FAIL ${label}: ${ratio.toFixed(2)}:1 (needs >= ${min}:1) [${fg} on ${bg}]`);
  } else if (ratio < min + 0.5) {
    WARN.push(`1.4.3 contrast WARN ${label}: ${ratio.toFixed(2)}:1 [${fg} on ${bg}]`);
  } else {
    PASS.push(`1.4.3 contrast ${label}: ${ratio.toFixed(2)}:1`);
  }
}

function checkPairSet(themeName, tokens, pairs) {
  for (const [label, fgToken, bgToken, large] of pairs) {
    const fg = tokens[fgToken];
    const bg = tokens[bgToken];
    if (!fg || !bg) continue;
    checkContrast(fg, bg, `${themeName} ${label}`, large);
  }
}

function scanCssFiles() {
  const files = fs.readdirSync(path.join(ROOT, "css")).filter((f) => f.endsWith(".css"));
  const allCss = [];
  let lightTokens = {};
  let darkTokens = {};
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, "css", f), "utf8");
    allCss.push(text);
    if (f === "tokens.css") {
      lightTokens = Object.assign(lightTokens, parseTheme(text, ":root"));
      darkTokens = Object.assign(darkTokens, parseTheme(text, '[data-theme="dark"]'));
    }
  }

  // Focus indicator (2.4.7): a global :focus-visible rule with outline/shadow.
  const hasGlobalFocus = /:focus-visible\s*\{[^}]*box-shadow|:focus-visible\s*\{[^}]*outline/.test(allCss.join("\n"));
  if (hasGlobalFocus) PASS.push("2.4.7 focus-visible indicator defined globally");
  else FAIL.push("2.4.7 no global :focus-visible indicator rule found");

  // Rules that strip focus indicators without a compensating focus-visible rule.
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, "css", f), "utf8");
    for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = m[1].trim();
      const body = m[2];
      if (/:focus(?![a-z-])/.test(selector) && /outline:\s*none|box-shadow:\s*none/.test(body)) {
        WARN.push(`2.4.7 ${f}: focus style strips indicator at '${selector}' — verify :focus-visible covers it`);
      }
    }
  }

  // 2.5.8 Target size (min 24px, WCAG 2.2 AA): component size tokens.
  if (/--btn-height:\s*2[4-9]\dpx|--btn-height:\s*[3-9]\dpx/.test(allCss.join("\n"))) {
    PASS.push("2.5.8 button height token >= 24px");
  } else {
    WARN.push("2.5.8 no button height token >= 24px found");
  }
  if (/--input-height:\s*2[4-9]\dpx|--input-height:\s*[3-9]\dpx/.test(allCss.join("\n"))) {
    PASS.push("2.5.8 input height token >= 24px");
  }

  // Documented token pairs (WCAG 1.4.3 text, 1.4.11 non-text).
  const docPairs = [
    ["text-on-bg", "--text", "--bg", false],
    ["text-on-surface", "--text", "--surface", false],
    ["text-secondary-on-bg", "--text-secondary", "--bg", false],
    ["text-secondary-on-surface", "--text-secondary", "--surface", false],
    ["text-secondary-on-surface-2", "--text-secondary", "--surface-2", false],
    ["text-muted-on-bg", "--text-muted", "--bg", false],
    ["text-muted-on-surface", "--text-muted", "--surface", false],
    ["text-inverse-on-surface-inverse", "--text-inverse", "--surface-inverse", false],
    ["accent-contrast-on-accent", "--accent-contrast", "--accent", false],
    ["danger-contrast-on-danger", "--danger-contrast", "--danger", false],
    ["success-contrast-on-success", "--success-contrast", "--success", false],
    ["warning-on-warning-subtle", "--warning", "--warning-subtle", false],
    ["accent-on-accent-subtle", "--accent", "--accent-subtle", false],
    ["accent-on-accent-soft", "--accent", "--accent-soft", false],
    ["danger-on-danger-subtle", "--danger", "--danger-subtle", false],
    ["info-on-info-subtle", "--info", "--info-subtle", false],
    ["success-on-success-subtle", "--success", "--success-subtle", false],
    ["text-on-accent-subtle", "--text", "--accent-subtle", false],
  ];
  checkPairSet("light", lightTokens, docPairs);
  checkPairSet("dark", darkTokens, docPairs);

  // Non-text / UI boundary contrast (1.4.11) — informational only.
  for (const [theme, tokens] of [
    ["light", lightTokens],
    ["dark", darkTokens],
  ]) {
    const bg = tokens["--bg"];
    const borderStrong = tokens["--border-strong"];
    const border = tokens["--border"];
    for (const [label, fg, t] of [
      ["border-strong-on-bg", borderStrong, "--border-strong"],
      ["border-on-bg", border, "--border"],
    ]) {
      const ratio = contrastRatio(fg, bg);
      if (ratio != null && ratio < 3.0) {
        WARN.push(`1.4.11 ${theme} ${label}: ${ratio.toFixed(2)}:1 (UI boundary < 3:1 — verify component is identifiable another way)`);
      }
    }
  }

  // Color/background pairs actually used in rules (excluding tokens.css).
  for (const f of files) {
    if (f === "tokens.css") continue;
    let text = fs.readFileSync(path.join(ROOT, "css", f), "utf8");
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/([^{}\n]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      const body = m[2];
      const colorM = body.match(/color\s*:\s*([^;]+);/);
      const bgM = body.match(/background(?:-color)?\s*:\s*([^;]+);/);
      if (!colorM || !bgM) continue;
      const fgRaw = colorM[1].trim();
      const bgRaw = bgM[1].trim();
      const fgToken = fgRaw.match(/var\(\s*(--[\w-]+)\s*\)/);
      for (const [theme, tokens] of [
        ["light", lightTokens],
        ["dark", darkTokens],
      ]) {
        const fg = resolveColor(fgRaw, tokens);
        const bg = resolveColor(bgRaw, tokens);
        if (!fg || !bg || fg === bg) continue;
        const isText = fgToken && (fgToken[1] === "--text" || fgToken[1].includes("text-"));
        if (isText) checkContrast(fg, bg, `${theme} ${f} '${selector}' color/background`);
        else if (contrastRatio(fg, bg) < 3.0) {
          WARN.push(`1.4.11 ${theme} ${f} '${selector}' graphical contrast: ${contrastRatio(fg, bg).toFixed(2)}:1 (< 3:1)`);
        }
      }
    }
  }

  return { lightTokens, darkTokens };
}

function scanIndexHtml() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const lang = html.match(/<html[^>]*\blang=["']([^"']+)["']/);
  if (lang && lang[1]) PASS.push(`3.1.1 html lang = "${lang[1]}"`);
  else FAIL.push("3.1.1 <html lang> attribute missing/empty");

  const title = html.match(/<title>([^<]+)<\/title>/);
  if (title && title[1].trim()) PASS.push("2.4.2 <title> present");
  else FAIL.push("2.4.2 <title> missing/empty");

  if (/<meta\s+name=["']viewport["']/.test(html)) PASS.push("1.4.4/1.4.10 viewport meta present (zoom not disabled)");
  else WARN.push("1.4.10 viewport meta missing");

  if (/class=["'][^"']*skip-link/.test(html)) PASS.push("2.4.1 skip link present");
  else WARN.push("2.4.1 skip link missing");

  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(m[0])) FAIL.push(`1.1.1 <img> without alt: ${m[0].slice(0, 60)}`);
  }
  for (const m of html.matchAll(/tabindex=["']([1-9])/g)) {
    FAIL.push(`2.4.3 positive tabindex: ${m[1]}`);
  }
  for (const m of html.matchAll(/autofocus/g)) {
    WARN.push(`3.2.5 autofocus found in index.html (${m.index})`);
  }
  if (html.includes('href="#main"')) PASS.push("2.4.1 skip-link targets #main");
  else WARN.push("2.4.1 skip-link does not target #main");
}

function scanJs() {
  const files = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, "js", f), "utf8");
    for (const m of text.matchAll(/tabindex\s*=\s*["']([1-9])/g)) {
      FAIL.push(`2.4.3 ${f}: positive tabindex ${m[1]} at offset ${m.index}`);
    }
    for (const m of text.matchAll(/aria-label\s*=\s*["']\s*["']/g)) {
      FAIL.push(`1.3.1/4.1.2 ${f}: empty aria-label at offset ${m.index}`);
    }
    for (const m of text.matchAll(/autofocus/g)) {
      WARN.push(`3.2.5 ${f}: autofocus used (at most one per view) at offset ${m.index}`);
    }
    for (const m of text.matchAll(/<img\b[^>]*>/g)) {
      if (!/\balt\s*=/.test(m[0])) FAIL.push(`1.1.1 ${f}: <img> without alt at offset ${m.index}`);
    }
    for (const m of text.matchAll(/<(button|a)[^>]*class=["'][^"']*icon[^"']*["'][^>]*>/g)) {
      if (!/aria-label/.test(m[0])) WARN.push(`4.1.2 ${f}: icon button/link without aria-label at offset ${m.index}`);
    }
  }
}

function main() {
  scanIndexHtml();
  scanCssFiles();
  scanJs();

  MANUAL.push(
    "2.4.4/2.4.9 link purpose (context on every view)",
    "1.3.1 heading order / landmarks per view (static shell only)",
    "4.1.2 aria-expanded / aria-controls on accordions & menus",
    "2.4.3 sequential focus order across views",
    "1.4.10/1.4.11 reflow & non-text contrast at every breakpoint",
    "3.3.1/3.3.2 input error identification & labels in every form",
    "1.2.x any video/audio content (none present today)",
  );

  console.log(`\n=== VeilDrop WCAG 2.2 AA static audit ===`);
  console.log(`PASS: ${PASS.length}  WARN: ${WARN.length}  FAIL: ${FAIL.length}`);
  if (PASS.length) console.log("\n-- Passed --\n" + PASS.join("\n"));
  if (WARN.length) console.log("\n-- Warnings (review manually) --\n" + WARN.join("\n"));
  if (FAIL.length) console.log("\n-- Failures (blocking AA) --\n" + FAIL.join("\n"));
  console.log("\n-- Manual checks (need a real browser) --\n" + MANUAL.map((m) => "  - " + m).join("\n"));
  console.log(`\nRESULT: ${FAIL.length === 0 ? "PASS (no static AA failures)" : "FAIL"}\n`);
  process.exit(FAIL.length === 0 ? 0 : 1);
}

main();
