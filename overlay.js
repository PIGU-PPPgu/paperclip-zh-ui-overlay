/* Paperclip v2026.916.1 local Chinese UI layer. Static UI text only. */
(() => {
  "use strict";

  const ROOT = "/paperclip-zh";
  const scriptUrl = new URL(document.currentScript?.src ?? location.href);
  const version = scriptUrl.searchParams.get("v") ?? "1";
  const localeKey = "paperclip.ui.locale";
  const skipSelector = [
    "script", "style", "noscript", "svg", "canvas", "pre", "code", "textarea",
    "[contenteditable]", ".mdxeditor", ".cm-editor", ".monaco-editor",
    "[data-paperclip-zh]",
  ].join(",");
  const attributeNames = ["placeholder", "aria-label", "title", "alt"];
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();
  const pending = new Set();
  let locale = localStorage.getItem(localeKey) === "en" ? "en" : "zh-CN";
  let translations = new Map();
  let normalizedTranslations = new Map();
  let templates = [];
  let observer;
  let scheduled = false;
  let toggle;
  let titleState;
  let translatedCount = 0;

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function buildTemplates() {
    templates = [];
    for (const [source, target] of translations) {
      if (!source.includes("{{") || source.length > 500) continue;
      const parts = [...source.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)];
      if (!parts.length) continue;
      const staticLength = source.replace(/\{\{[A-Za-z0-9_]+\}\}/g, "").length;
      // Very short templates such as "{{x}} to {{y}}" match unrelated UI text
      // and create half-translated sentences. Keep only specific templates.
      const prefixLength = source.slice(0, parts[0].index).trim().length;
      const suffixLength = source.slice(parts.at(-1).index + parts.at(-1)[0].length).trim().length;
      if (staticLength < 12 || Math.max(prefixLength, suffixLength) < 4) continue;
      const names = [];
      let expression = "^";
      let cursor = 0;
      for (const match of parts) {
        expression += escapeRegExp(source.slice(cursor, match.index));
        expression += "([\\s\\S]+?)";
        names.push(match[1]);
        cursor = match.index + match[0].length;
      }
      expression += escapeRegExp(source.slice(cursor)) + "$";
      templates.push({ pattern: new RegExp(expression), names, target, staticLength });
    }
    templates.sort((a, b) => b.staticLength - a.staticLength);
  }

  function lookup(value) {
    if (!value || value.length > 500 || !/[A-Za-z]/.test(value)) return null;
    let result = translations.get(value);
    if (result === undefined) {
      const trimmed = value.trim();
      result = translations.get(trimmed);
      if (result === undefined) result = normalizedTranslations.get(trimmed.replace(/\s+/g, " "));
      if (result !== undefined && trimmed !== value) {
        const left = value.match(/^\s*/)?.[0] ?? "";
        const right = value.match(/\s*$/)?.[0] ?? "";
        result = left + result + right;
      }
    }
    if (result !== undefined) return result === value ? null : result;

    const trimmed = value.trim().replace(/\s+/g, " ");
    for (const rule of templates) {
      const match = rule.pattern.exec(trimmed);
      if (!match) continue;
      const values = Object.fromEntries(rule.names.map((name, index) => [name, match[index + 1]]));
      const translated = rule.target.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (token, name) => values[name] ?? token);
      const left = value.match(/^\s*/)?.[0] ?? "";
      const right = value.match(/\s*$/)?.[0] ?? "";
      return left + translated + right;
    }
    return null;
  }

  function skipped(element) {
    return !element || Boolean(element.closest(skipSelector));
  }

  function skippedAttributes(element) {
    return !element || Boolean(element.closest("script,style,noscript,svg,canvas,[data-paperclip-zh]"));
  }

  function translateText(node, force = false) {
    if (skipped(node.parentElement)) return;
    const current = node.nodeValue ?? "";
    const prior = originalText.get(node);
    if (locale === "en") {
      if (prior && current === prior.translated) node.nodeValue = prior.original;
      return;
    }
    if (prior && current === prior.translated && !force) return;
    const source = prior && current === prior.translated ? prior.original : current;
    const translated = lookup(source);
    if (translated && translated !== source) {
      originalText.set(node, { original: source, translated });
      node.nodeValue = translated;
      translatedCount += 1;
    }
  }

  function translateAttributes(element, force = false) {
    if (skippedAttributes(element)) return;
    const prior = originalAttributes.get(element) ?? new Map();
    for (const name of attributeNames) {
      if (!element.hasAttribute(name)) continue;
      const current = element.getAttribute(name) ?? "";
      const record = prior.get(name);
      if (locale === "en") {
        if (record && current === record.translated) element.setAttribute(name, record.original);
        continue;
      }
      if (record && current === record.translated && !force) continue;
      const source = record && current === record.translated ? record.original : current;
      const translated = lookup(source);
      if (translated && translated !== source) {
        prior.set(name, { original: source, translated });
        element.setAttribute(name, translated);
        translatedCount += 1;
      }
    }
    if (prior.size) originalAttributes.set(element, prior);
  }

  function translateTree(root, force = false) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateText(root, force);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const element = root;
    translateAttributes(element, force);
    if (skipped(element)) return;
    for (const child of element.childNodes) translateTree(child, force);
  }

  function translateTitle(force = false) {
    const current = document.title;
    if (locale === "en") {
      if (titleState && current === titleState.translated) document.title = titleState.original;
      return;
    }
    if (titleState && current === titleState.translated && !force) return;
    const source = titleState && current === titleState.translated ? titleState.original : current;
    const translated = source.split(" • ").map((part) => lookup(part) ?? part).join(" • ");
    if (translated !== source) {
      titleState = { original: source, translated };
      document.title = translated;
    }
  }

  function observe() {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: attributeNames,
    });
  }

  function applyAll(force = false) {
    observer.disconnect();
    translateTree(document.body, force);
    translateTitle(force);
    document.documentElement.lang = locale;
    observe();
  }

  function flush() {
    scheduled = false;
    observer.disconnect();
    for (const node of pending) translateTree(node);
    pending.clear();
    translateTitle();
    observe();
  }

  function queueMutations(records) {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) pending.add(node);
      } else {
        pending.add(record.target);
      }
    }
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }

  function updateToggle() {
    if (!toggle) return;
    toggle.textContent = locale === "zh-CN" ? "EN" : "中文";
    toggle.setAttribute("aria-label", locale === "zh-CN" ? "切换为英文" : "切换为简体中文");
    toggle.title = locale === "zh-CN" ? "切换为英文" : "切换为简体中文";
  }

  function setLocale(next) {
    if (next !== "en" && next !== "zh-CN") return;
    locale = next;
    localStorage.setItem(localeKey, locale);
    updateToggle();
    applyAll(true);
  }

  function mountToggle() {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("data-paperclip-zh", "toggle");
    toggle.style.cssText = [
      "position:fixed", "right:12px", "bottom:12px", "z-index:2147483647",
      "min-width:44px", "min-height:32px", "padding:4px 10px", "border-radius:999px",
      "border:1px solid #71717a", "background:#18181b", "color:#fafafa",
      "font:600 12px system-ui,sans-serif", "box-shadow:0 2px 8px #0005",
      "cursor:pointer",
    ].join(";");
    updateToggle();
    toggle.addEventListener("click", () => setLocale(locale === "zh-CN" ? "en" : "zh-CN"));
    document.body.append(toggle);
  }

  async function loadJson(name) {
    const response = await fetch(`${ROOT}/${name}?v=${encodeURIComponent(version)}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${name}: invalid JSON`);
    return data;
  }

  async function start() {
    observer = new MutationObserver(queueMutations);
    mountToggle();
    try {
      const [community, overrides] = await Promise.all([
        loadJson("zh-CN.community.json"),
        loadJson("overrides.zh-CN.json"),
      ]);
      translations = new Map([...Object.entries(community), ...Object.entries(overrides)].filter(
        ([source, target]) => typeof source === "string" && typeof target === "string",
      ));
      normalizedTranslations = new Map([...translations].map(
        ([source, target]) => [source.trim().replace(/\s+/g, " "), target],
      ));
      buildTemplates();
    } catch (error) {
      console.warn("Paperclip Chinese UI translations could not load", error);
    }
    applyAll();
    window.__paperclipZhStatus = () => ({ locale, dictionarySize: translations.size, translatedCount });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else void start();
})();
