/**
 * Layer 2: Sandboxed JavaScript execution via QuickJS WASM.
 *
 * Executes page JavaScript in an isolated WebAssembly sandbox.
 * The sandbox has DOM API bindings but no real network access.
 *
 * Uses quickjs-emscripten directly for reliable Bun compatibility.
 */

import { getQuickJS, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import { SieveDocument } from "../dom/document.ts";
import { SieveElement } from "../dom/element.ts";
import { querySelector, querySelectorAll } from "../css/selector.ts";
import { serialize } from "../dom/serializer.ts";
import { parseHTML } from "../dom/parser.ts";

// --- Element registry ---

class ElementRegistry {
  private map = new Map<number, SieveElement>();
  private reverse = new Map<SieveElement, number>();
  private nextId = 1;

  register(el: SieveElement | null): number {
    if (!el) return -1;
    const existing = this.reverse.get(el);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.map.set(id, el);
    this.reverse.set(el, id);
    return id;
  }

  get(id: number): SieveElement | null {
    return this.map.get(id) ?? null;
  }
}

// --- DOM bridge code injected into sandbox ---

const DOM_BRIDGE = `
var __callHost = globalThis.__callHost;

function __wrap(id) {
  if (id === -1 || id === null || id === undefined) return null;
  return {
    __id: id,
    get textContent() { return __callHost("getTextContent", id); },
    set textContent(v) { __callHost("setTextContent", id, v); },
    get innerHTML() { return __callHost("getInnerHTML", id); },
    set innerHTML(v) { __callHost("setInnerHTML", id, v); },
    get tagName() { return __callHost("getTagName", id); },
    get id() { return this.getAttribute("id") || ""; },
    set id(v) { this.setAttribute("id", v); },
    get className() { return this.getAttribute("class") || ""; },
    set className(v) { this.setAttribute("class", v); },
    getAttribute: function(n) { return __callHost("getAttribute", id, n); },
    setAttribute: function(n, v) { __callHost("setAttribute", id, n, v); },
    removeAttribute: function(n) { __callHost("removeAttribute", id, n); },
    hasAttribute: function(n) { return __callHost("hasAttribute", id, n); },
    querySelector: function(s) { return __wrap(__callHost("querySelector", id, s)); },
    querySelectorAll: function(s) {
      var ids = __callHost("querySelectorAll", id, s);
      if (!ids) return [];
      return ids.split(",").filter(Boolean).map(function(i) { return __wrap(parseInt(i)); });
    },
    appendChild: function(c) { __callHost("appendChild", id, c.__id); return c; },
    removeChild: function(c) { __callHost("removeChild", id, c.__id); return c; },
    addEventListener: function() {},
    classList: {
      add: function() { for (var i = 0; i < arguments.length; i++) __callHost("classListAdd", id, arguments[i]); },
      remove: function() { for (var i = 0; i < arguments.length; i++) __callHost("classListRemove", id, arguments[i]); },
      toggle: function(c) { return __callHost("classListToggle", id, c); },
      contains: function(c) { return __callHost("classListContains", id, c); },
    },
    style: new Proxy({}, {
      set: function(_, p, v) { __callHost("setStyle", id, p, v); return true; },
      get: function(_, p) { return __callHost("getStyle", id, p) || ""; },
    }),
    get parentElement() { return __wrap(__callHost("getParent", id)); },
    get children() { return this.querySelectorAll("*"); },
  };
}

var document = {
  querySelector: function(s) { return __wrap(__callHost("docQS", s)); },
  querySelectorAll: function(s) {
    var ids = __callHost("docQSA", s);
    if (!ids) return [];
    return ids.split(",").filter(Boolean).map(function(i) { return __wrap(parseInt(i)); });
  },
  getElementById: function(id) { return __wrap(__callHost("docById", id)); },
  createElement: function(tag) { return __wrap(__callHost("createElement", tag)); },
  get title() { return __callHost("getTitle"); },
  set title(v) { __callHost("setTitle", v); },
  get body() { return __wrap(__callHost("getBody")); },
};

var window = { document: document, location: { href: __callHost("getURL") } };
var console = {
  log: function() { var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i])); __callHost("log", a.join(" ")); },
  warn: function() { var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i])); __callHost("log", "WARN: " + a.join(" ")); },
  error: function() { var a = []; for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i])); __callHost("log", "ERROR: " + a.join(" ")); },
};
function setTimeout(fn) { fn(); return 0; }
function setInterval(fn) { fn(); return 0; }
function clearTimeout() {}
function clearInterval() {}
`;

// --- Execution ---

export interface SandboxResult {
  ok: boolean;
  console: string[];
  error?: string;
  durationMs: number;
}

export interface SandboxExecOptions {
  timeout?: number;
  url?: string;
}

export async function executeSandboxed(
  code: string,
  doc: SieveDocument,
  options: SandboxExecOptions = {},
): Promise<SandboxResult> {
  const start = performance.now();
  const consoleOutput: string[] = [];
  const url = options.url ?? "about:blank";
  const registry = new ElementRegistry();

  const QuickJS = await getQuickJS();
  const vm = QuickJS.newContext();

  // Host function dispatcher — single entry point for all DOM calls
  const callHostFn = vm.newFunction("__callHost", (...args: QuickJSHandle[]) => {
    const jsArgs = args.map((a) => vm.dump(a));
    const cmd = jsArgs[0] as string;

    try {
      const result = handleHostCall(cmd, jsArgs.slice(1), doc, registry, consoleOutput, url);
      if (result === null || result === undefined) return vm.null;
      if (typeof result === "boolean") return result ? vm.true : vm.false;
      if (typeof result === "number") return vm.newNumber(result);
      return vm.newString(String(result));
    } catch {
      return vm.null;
    }
  });

  vm.setProp(vm.global, "__callHost", callHostFn);
  callHostFn.dispose();

  // Inject DOM bridge + user code
  const fullCode = `${DOM_BRIDGE}\n;\n${code}`;

  const evalResult = vm.evalCode(fullCode);
  let ok = true;
  let error: string | undefined;

  if (evalResult.error) {
    ok = false;
    const dumped = vm.dump(evalResult.error);
    error = typeof dumped === "object" && dumped !== null
      ? (dumped as any).message ?? (dumped as any).name ?? JSON.stringify(dumped)
      : String(dumped);
    evalResult.error.dispose();
  } else {
    evalResult.value.dispose();
  }

  vm.dispose();

  return {
    ok,
    console: consoleOutput,
    error,
    durationMs: performance.now() - start,
  };
}

function handleHostCall(
  cmd: string,
  args: any[],
  doc: SieveDocument,
  reg: ElementRegistry,
  consoleOutput: string[],
  url: string,
): string | number | boolean | null {
  switch (cmd) {
    // Console
    case "log":
      consoleOutput.push(String(args[0] ?? ""));
      return null;

    // Document queries
    case "docQS": {
      const el = querySelector(doc, String(args[0]));
      return el ? reg.register(el) : -1;
    }
    case "docQSA": {
      const els = querySelectorAll(doc, String(args[0]));
      return els.map((el) => reg.register(el)).join(",");
    }
    case "docById": {
      const el = doc.getElementById(String(args[0]));
      return el ? reg.register(el) : -1;
    }
    case "getBody":
      return doc.body ? reg.register(doc.body) : -1;
    case "getTitle":
      return doc.title;
    case "setTitle":
      doc.title = String(args[0]);
      return null;
    case "getURL":
      return url;

    // Element creation
    case "createElement": {
      const el = doc.createElement(String(args[0]));
      return reg.register(el);
    }

    // Element properties
    case "getTextContent":
      return reg.get(args[0])?.textContent ?? "";
    case "setTextContent": {
      const el = reg.get(args[0]);
      if (el) el.textContent = String(args[1]);
      return null;
    }
    case "getInnerHTML": {
      const el = reg.get(args[0]);
      return el ? el.childNodes.map(serialize).join("") : "";
    }
    case "setInnerHTML": {
      const el = reg.get(args[0]);
      if (!el) return null;
      const frag = parseHTML(`<div>${args[1]}</div>`);
      const wrapper = frag.querySelector("div");
      if (!wrapper) return null;
      for (const c of el.childNodes) c.parentNode = null;
      el.childNodes = [];
      for (const c of [...wrapper.childNodes]) el.appendChild(c);
      return null;
    }
    case "getTagName":
      return reg.get(args[0])?.tagName.toUpperCase() ?? "";
    case "getParent": {
      const el = reg.get(args[0]);
      return el?.parentNode instanceof SieveElement ? reg.register(el.parentNode) : -1;
    }

    // Attributes
    case "getAttribute":
      return reg.get(args[0])?.getAttribute(String(args[1])) ?? null;
    case "setAttribute":
      reg.get(args[0])?.setAttribute(String(args[1]), String(args[2]));
      return null;
    case "removeAttribute":
      reg.get(args[0])?.removeAttribute(String(args[1]));
      return null;
    case "hasAttribute":
      return reg.get(args[0])?.hasAttribute(String(args[1])) ?? false;

    // Element queries
    case "querySelector": {
      const parent = reg.get(args[0]);
      if (!parent) return -1;
      const found = querySelector(parent, String(args[1]));
      return found ? reg.register(found) : -1;
    }
    case "querySelectorAll": {
      const parent = reg.get(args[0]);
      if (!parent) return "";
      return querySelectorAll(parent, String(args[1])).map((el) => reg.register(el)).join(",");
    }

    // Tree manipulation
    case "appendChild": {
      const parent = reg.get(args[0]);
      const child = reg.get(args[1]);
      if (parent && child) parent.appendChild(child);
      return null;
    }
    case "removeChild": {
      const parent = reg.get(args[0]);
      const child = reg.get(args[1]);
      if (parent && child) parent.removeChild(child);
      return null;
    }

    // ClassList
    case "classListAdd":
      reg.get(args[0])?.classList.add(String(args[1]));
      return null;
    case "classListRemove":
      reg.get(args[0])?.classList.remove(String(args[1]));
      return null;
    case "classListToggle":
      return reg.get(args[0])?.classList.toggle(String(args[1])) ?? false;
    case "classListContains":
      return reg.get(args[0])?.classList.contains(String(args[1])) ?? false;

    // Style
    case "setStyle": {
      const el = reg.get(args[0]);
      if (!el) return null;
      const prop = String(args[1]).replace(/([A-Z])/g, "-$1").toLowerCase();
      const style = el.getAttribute("style") ?? "";
      const cleaned = style.replace(new RegExp(`${prop}\\s*:[^;]*;?`, "gi"), "").trim();
      el.setAttribute("style", `${cleaned}${cleaned ? "; " : ""}${prop}: ${args[2]}`);
      return null;
    }
    case "getStyle": {
      const el = reg.get(args[0]);
      if (!el) return "";
      const style = el.getAttribute("style") ?? "";
      const prop = String(args[1]).replace(/([A-Z])/g, "-$1").toLowerCase();
      const match = style.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`));
      return match ? match[1]!.trim() : "";
    }

    default:
      return null;
  }
}

/**
 * Execute all inline <script> tags in a document.
 */
export async function executeDocumentScripts(
  doc: SieveDocument,
  options: SandboxExecOptions = {},
): Promise<SandboxResult[]> {
  const scripts = doc.querySelectorAll("script");
  const results: SandboxResult[] = [];

  for (const script of scripts) {
    if (script.hasAttribute("src")) continue;
    const type = script.getAttribute("type");
    if (type && type !== "text/javascript" && type !== "application/javascript") continue;
    const code = script.textContent;
    if (!code.trim()) continue;

    results.push(await executeSandboxed(code, doc, options));
  }

  return results;
}
