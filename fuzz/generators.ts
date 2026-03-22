/**
 * Random input generators for fuzzing.
 * Produces structurally varied but semi-valid inputs to find crashes.
 */

const TAGS = [
  "div", "span", "p", "a", "ul", "ol", "li", "table", "tr", "td", "th",
  "form", "input", "button", "select", "option", "textarea", "label",
  "h1", "h2", "h3", "h4", "h5", "h6", "img", "br", "hr", "nav", "main",
  "header", "footer", "section", "article", "aside", "details", "summary",
  "script", "style", "link", "meta", "svg", "iframe", "template",
];

const ATTRS = [
  "id", "class", "name", "value", "type", "href", "src", "alt", "title",
  "style", "hidden", "disabled", "checked", "selected", "required",
  "aria-label", "aria-hidden", "role", "data-id", "data-value",
  "placeholder", "action", "method", "for", "tabindex", "onclick",
];

const INPUT_TYPES = [
  "text", "email", "password", "number", "checkbox", "radio", "submit",
  "hidden", "file", "search", "url", "tel", "date", "range", "color",
];

const ROLES = [
  "button", "link", "textbox", "checkbox", "radio", "combobox", "alert",
  "navigation", "main", "banner", "contentinfo", "search", "dialog",
];

const SELECTORS = [
  "div", "#id", ".cls", "[attr]", '[attr="val"]', "div > p", "ul li",
  "a:first-child", "li:nth-child(2)", ":not(.x)", "h1, h2", "*",
  "div.cls#id", "[href^='/']", ":checked", ":disabled", ":empty",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randStr(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789 _-./&<>\"'@#$%{}[]()=+!?;:";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// --- HTML generators ---

export function randomTag(): string {
  return pick(TAGS);
}

export function randomAttrs(count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const attr = pick(ATTRS);
    if (Math.random() < 0.3) {
      parts.push(attr); // boolean attr
    } else {
      const val = Math.random() < 0.2 ? randStr(randInt(1, 50)) : pick(INPUT_TYPES);
      parts.push(`${attr}="${val}"`);
    }
  }
  return parts.join(" ");
}

export function randomElement(depth: number = 0): string {
  const tag = randomTag();
  const attrCount = randInt(0, 4);
  const attrs = attrCount > 0 ? " " + randomAttrs(attrCount) : "";
  const isVoid = ["br", "hr", "img", "input", "meta", "link"].includes(tag);

  if (isVoid) return `<${tag}${attrs}>`;

  let children = "";
  if (depth < 5) {
    const childCount = randInt(0, 4);
    for (let i = 0; i < childCount; i++) {
      if (Math.random() < 0.4) {
        children += randStr(randInt(1, 30));
      } else {
        children += randomElement(depth + 1);
      }
    }
  } else {
    children = randStr(randInt(0, 20));
  }

  // Sometimes omit closing tag (malformed)
  if (Math.random() < 0.1) return `<${tag}${attrs}>${children}`;

  return `<${tag}${attrs}>${children}</${tag}>`;
}

export function randomHTML(elementCount: number): string {
  let html = "";
  if (Math.random() < 0.5) html += "<!DOCTYPE html>";
  if (Math.random() < 0.7) html += "<html>";
  if (Math.random() < 0.5) html += `<head><title>${randStr(randInt(0, 20))}</title></head>`;
  if (Math.random() < 0.8) html += "<body>";

  for (let i = 0; i < elementCount; i++) {
    html += randomElement(0);
  }

  if (Math.random() < 0.7) html += "</body>";
  if (Math.random() < 0.6) html += "</html>";
  return html;
}

// --- Selector generators ---

export function randomSelector(): string {
  if (Math.random() < 0.5) return pick(SELECTORS);

  // Build a compound selector
  const parts: string[] = [];
  const count = randInt(1, 4);
  for (let i = 0; i < count; i++) {
    let part = "";
    if (Math.random() < 0.4) part += pick(TAGS);
    if (Math.random() < 0.3) part += `#${randStr(randInt(1, 8)).replace(/[^a-z0-9-]/g, "")}`;
    if (Math.random() < 0.3) part += `.${randStr(randInt(1, 8)).replace(/[^a-z0-9-]/g, "")}`;
    if (Math.random() < 0.2) part += `[${pick(ATTRS)}]`;
    if (!part) part = pick(TAGS);
    parts.push(part);
  }

  const combinators = [" ", " > ", " + ", " ~ "];
  return parts.join(pick(combinators));
}

// --- Cookie generators ---

export function randomCookie(): string {
  const name = randStr(randInt(1, 20)).replace(/[^a-zA-Z0-9_-]/g, "");
  const value = randStr(randInt(0, 50)).replace(/[;,\s]/g, "");
  let header = `${name}=${value}`;
  if (Math.random() < 0.3) header += `; Path=/${randStr(randInt(0, 10)).replace(/[^a-z/]/g, "")}`;
  if (Math.random() < 0.2) header += `; Domain=${randStr(randInt(3, 15)).replace(/[^a-z.]/g, "")}`;
  if (Math.random() < 0.1) header += `; Max-Age=${randInt(-10, 86400)}`;
  if (Math.random() < 0.1) header += "; Secure";
  if (Math.random() < 0.1) header += "; HttpOnly";
  return header;
}

// --- JS code generators ---

export function randomJS(): string {
  const stmts: string[] = [];
  const count = randInt(1, 10);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    if (r < 0.3) {
      stmts.push(`document.querySelector("${pick(TAGS)}")`);
    } else if (r < 0.5) {
      stmts.push(`console.log("${randStr(randInt(1, 20)).replace(/"/g, "")}")`);
    } else if (r < 0.6) {
      const el = `document.querySelector("${pick(TAGS)}")`;
      stmts.push(`if(${el}) ${el}.textContent = "${randStr(randInt(1, 15)).replace(/"/g, "")}"`);
    } else if (r < 0.7) {
      stmts.push(`var x = ${randInt(0, 1000)}`);
    } else if (r < 0.8) {
      stmts.push(`document.title = "${randStr(randInt(1, 20)).replace(/"/g, "")}"`);
    } else {
      stmts.push(`try { ${randStr(randInt(5, 30)).replace(/"/g, "")} } catch(e) {}`);
    }
  }
  return stmts.join(";\n");
}
