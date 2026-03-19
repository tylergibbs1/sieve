/**
 * CSS selector parser and matcher.
 *
 * Supports: tag, #id, .class, [attr], [attr=val], [attr~=val], [attr|=val],
 * [attr^=val], [attr$=val], [attr*=val], :first-child, :last-child,
 * :nth-child(n), :not(...), :checked, :disabled, :enabled, :empty,
 * :has(...), combinators ( , >, +, ~), and comma-separated groups.
 */

import { SieveElement } from "../dom/element.ts";
import { NodeType, type SieveNode } from "../dom/node.ts";

// --- Types ---

interface SimpleSelector {
  tag?: string;
  id?: string;
  classes: string[];
  attrs: AttrSelector[];
  pseudos: PseudoSelector[];
}

interface AttrSelector {
  name: string;
  op?: "=" | "~=" | "|=" | "^=" | "$=" | "*=";
  value?: string;
  caseInsensitive?: boolean;
}

type PseudoSelector =
  | { type: "first-child" }
  | { type: "last-child" }
  | { type: "nth-child"; a: number; b: number }
  | { type: "nth-last-child"; a: number; b: number }
  | { type: "not"; selectors: SelectorList }
  | { type: "has"; selectors: SelectorList }
  | { type: "checked" }
  | { type: "disabled" }
  | { type: "enabled" }
  | { type: "empty" }
  | { type: "root" }
  | { type: "only-child" };

type Combinator = " " | ">" | "+" | "~";

interface CompoundSelector {
  simple: SimpleSelector;
  combinator?: Combinator;
}

type SelectorList = CompoundSelector[][];

// --- Parser ---

class SelectorParser {
  private pos = 0;
  constructor(private input: string) {}

  parse(): SelectorList {
    const list: SelectorList = [];
    list.push(this.parseCompoundList());
    while (this.peek() === ",") {
      this.advance(); // skip comma
      this.skipWhitespace();
      list.push(this.parseCompoundList());
    }
    return list;
  }

  private parseCompoundList(): CompoundSelector[] {
    const compounds: CompoundSelector[] = [];
    this.skipWhitespace();
    compounds.push({ simple: this.parseSimple() });

    while (this.pos < this.input.length) {
      this.skipWhitespace();
      const ch = this.peek();
      if (!ch || ch === ",") break;

      let combinator: Combinator;
      if (ch === ">") {
        combinator = ">";
        this.advance();
        this.skipWhitespace();
      } else if (ch === "+") {
        combinator = "+";
        this.advance();
        this.skipWhitespace();
      } else if (ch === "~") {
        combinator = "~";
        this.advance();
        this.skipWhitespace();
      } else {
        // descendant combinator (whitespace) — we already skipped ws
        // check if the next char starts a selector
        if (this.isSimpleSelectorStart(ch)) {
          combinator = " ";
        } else {
          break;
        }
      }

      const last = compounds[compounds.length - 1]!;
      last.combinator = combinator;
      compounds.push({ simple: this.parseSimple() });
    }
    return compounds;
  }

  private parseSimple(): SimpleSelector {
    const sel: SimpleSelector = { classes: [], attrs: [], pseudos: [] };

    while (this.pos < this.input.length) {
      const ch = this.peek();
      if (ch === "#") {
        this.advance();
        sel.id = this.readIdent();
      } else if (ch === ".") {
        this.advance();
        sel.classes.push(this.readIdent());
      } else if (ch === "[") {
        sel.attrs.push(this.parseAttr());
      } else if (ch === ":") {
        sel.pseudos.push(this.parsePseudo());
      } else if (ch === "*") {
        this.advance();
        // universal — no tag constraint
      } else if (this.isIdentStart(ch!)) {
        if (!sel.tag) {
          sel.tag = this.readIdent();
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return sel;
  }

  private parseAttr(): AttrSelector {
    this.expect("[");
    this.skipWhitespace();
    const name = this.readIdent().toLowerCase();
    this.skipWhitespace();

    const ch = this.peek();
    if (ch === "]") {
      this.advance();
      return { name };
    }

    let op: AttrSelector["op"];
    if (ch === "=") {
      op = "=";
      this.advance();
    } else if (ch === "~" || ch === "|" || ch === "^" || ch === "$" || ch === "*") {
      this.advance();
      this.expect("=");
      op = `${ch}=` as AttrSelector["op"];
    } else {
      throw new Error(`Unexpected char in attr selector: ${ch}`);
    }

    this.skipWhitespace();
    const value = this.readAttrValue();
    this.skipWhitespace();

    let caseInsensitive = false;
    if (this.peek() === "i" || this.peek() === "I") {
      caseInsensitive = true;
      this.advance();
      this.skipWhitespace();
    }

    this.expect("]");
    return { name, op, value, caseInsensitive };
  }

  private parsePseudo(): PseudoSelector {
    this.expect(":");
    const name = this.readIdent();

    switch (name) {
      case "first-child":
        return { type: "first-child" };
      case "last-child":
        return { type: "last-child" };
      case "only-child":
        return { type: "only-child" };
      case "checked":
        return { type: "checked" };
      case "disabled":
        return { type: "disabled" };
      case "enabled":
        return { type: "enabled" };
      case "empty":
        return { type: "empty" };
      case "root":
        return { type: "root" };
      case "nth-child": {
        this.expect("(");
        this.skipWhitespace();
        const { a, b } = this.parseNth();
        this.skipWhitespace();
        this.expect(")");
        return { type: "nth-child", a, b };
      }
      case "nth-last-child": {
        this.expect("(");
        this.skipWhitespace();
        const { a, b } = this.parseNth();
        this.skipWhitespace();
        this.expect(")");
        return { type: "nth-last-child", a, b };
      }
      case "not": {
        this.expect("(");
        this.skipWhitespace();
        const inner = new SelectorParser(
          this.readBalancedParens()
        ).parse();
        return { type: "not", selectors: inner };
      }
      case "has": {
        this.expect("(");
        this.skipWhitespace();
        const inner = new SelectorParser(
          this.readBalancedParens()
        ).parse();
        return { type: "has", selectors: inner };
      }
      default:
        throw new Error(`Unsupported pseudo-class: :${name}`);
    }
  }

  private parseNth(): { a: number; b: number } {
    const token = this.readUntil(")").trim();
    if (token === "odd") return { a: 2, b: 1 };
    if (token === "even") return { a: 2, b: 0 };

    const match = token.match(/^([+-]?\d*)n\s*([+-]\s*\d+)?$/);
    if (match) {
      const aStr = match[1]!;
      const a = aStr === "" || aStr === "+" ? 1 : aStr === "-" ? -1 : parseInt(aStr, 10);
      const b = match[2] ? parseInt(match[2].replace(/\s/g, ""), 10) : 0;
      return { a, b };
    }

    const num = parseInt(token, 10);
    if (!isNaN(num)) return { a: 0, b: num };

    throw new Error(`Invalid nth expression: ${token}`);
  }

  // --- Low-level helpers ---

  private peek(): string | undefined {
    return this.input[this.pos];
  }

  private advance(): string {
    return this.input[this.pos++]!;
  }

  private expect(ch: string): void {
    if (this.input[this.pos] !== ch) {
      throw new Error(
        `Expected '${ch}' at pos ${this.pos}, got '${this.input[this.pos]}'`
      );
    }
    this.pos++;
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) {
      this.pos++;
    }
  }

  private readIdent(): string {
    const start = this.pos;
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos]!)) {
      this.pos++;
    }
    if (this.pos === start) throw new Error(`Expected identifier at pos ${this.pos}`);
    return this.input.slice(start, this.pos);
  }

  private readAttrValue(): string {
    const ch = this.peek();
    if (ch === '"' || ch === "'") {
      return this.readQuoted();
    }
    return this.readIdent();
  }

  private readQuoted(): string {
    const quote = this.advance();
    let result = "";
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === "\\") {
        this.pos++;
      }
      result += this.input[this.pos++];
    }
    this.pos++; // closing quote
    return result;
  }

  private readUntil(ch: string): string {
    const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== ch) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private readBalancedParens(): string {
    let depth = 0;
    const start = this.pos;
    while (this.pos < this.input.length) {
      if (this.input[this.pos] === "(") depth++;
      if (this.input[this.pos] === ")") {
        if (depth === 0) {
          const result = this.input.slice(start, this.pos);
          this.pos++; // skip closing paren
          return result;
        }
        depth--;
      }
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private isIdentStart(ch: string): boolean {
    return /[a-zA-Z_-]/.test(ch);
  }

  private isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_-]/.test(ch);
  }

  private isSimpleSelectorStart(ch: string | undefined): boolean {
    if (!ch) return false;
    return /[a-zA-Z_#.*:[\]]/.test(ch);
  }
}

// --- Matcher ---

function matchSimple(el: SieveElement, sel: SimpleSelector): boolean {
  if (sel.tag && el.tagName !== sel.tag.toLowerCase()) return false;
  if (sel.id && el.id !== sel.id) return false;

  for (const cls of sel.classes) {
    if (!el.classList.contains(cls)) return false;
  }

  for (const attr of sel.attrs) {
    const val = el.getAttribute(attr.name);
    if (val === null) return false;
    if (attr.op) {
      const av = attr.caseInsensitive ? val.toLowerCase() : val;
      const sv = attr.caseInsensitive ? (attr.value?.toLowerCase() ?? "") : (attr.value ?? "");
      switch (attr.op) {
        case "=":
          if (av !== sv) return false;
          break;
        case "~=":
          if (!av.split(/\s+/).includes(sv)) return false;
          break;
        case "|=":
          if (av !== sv && !av.startsWith(`${sv}-`)) return false;
          break;
        case "^=":
          if (!av.startsWith(sv)) return false;
          break;
        case "$=":
          if (!av.endsWith(sv)) return false;
          break;
        case "*=":
          if (!av.includes(sv)) return false;
          break;
      }
    }
  }

  for (const pseudo of sel.pseudos) {
    if (!matchPseudo(el, pseudo)) return false;
  }

  return true;
}

function getElementIndex(el: SieveElement): { index: number; total: number } {
  if (!el.parentNode) return { index: 1, total: 1 };
  const siblings = el.parentNode.childNodes.filter(
    (n): n is SieveElement => n.nodeType === NodeType.Element
  );
  return { index: siblings.indexOf(el) + 1, total: siblings.length };
}

function matchNth(a: number, b: number, index: number): boolean {
  if (a === 0) return index === b;
  const n = (index - b) / a;
  return Number.isInteger(n) && n >= 0;
}

function matchPseudo(el: SieveElement, pseudo: PseudoSelector): boolean {
  switch (pseudo.type) {
    case "first-child":
      return getElementIndex(el).index === 1;
    case "last-child": {
      const { index, total } = getElementIndex(el);
      return index === total;
    }
    case "only-child":
      return getElementIndex(el).total === 1;
    case "nth-child": {
      const { index } = getElementIndex(el);
      return matchNth(pseudo.a, pseudo.b, index);
    }
    case "nth-last-child": {
      const { index, total } = getElementIndex(el);
      return matchNth(pseudo.a, pseudo.b, total - index + 1);
    }
    case "not":
      return !pseudo.selectors.some((compoundList) =>
        matchCompound(el, compoundList)
      );
    case "has":
      return pseudo.selectors.some((compoundList) =>
        [...el.elementDescendants()].some((desc) =>
          matchCompound(desc, compoundList)
        )
      );
    case "checked": {
      const tag = el.tagName;
      if (tag === "input") {
        const type = el.getAttribute("type")?.toLowerCase();
        if (type === "checkbox" || type === "radio") {
          return el.hasAttribute("checked");
        }
      }
      if (tag === "option") {
        return el.hasAttribute("selected");
      }
      return false;
    }
    case "disabled":
      return el.hasAttribute("disabled");
    case "enabled":
      return !el.hasAttribute("disabled");
    case "empty":
      // Per CSS spec, :empty ignores comments — only elements and text count
      return el.childNodes.every(
        (n) => n.nodeType !== NodeType.Element && n.nodeType !== NodeType.Text
      );
    case "root":
      return el.parentNode?.nodeType === NodeType.Document;
  }
}

function matchCompound(el: SieveElement, compounds: CompoundSelector[]): boolean {
  // Match right-to-left
  let current: SieveElement | null = el;

  for (let i = compounds.length - 1; i >= 0; i--) {
    const compound = compounds[i]!;
    if (!current || !matchSimple(current, compound.simple)) return false;

    if (i > 0) {
      const prev = compounds[i - 1]!;
      switch (prev.combinator) {
        case ">":
          current = current.parentNode instanceof SieveElement ? current.parentNode : null;
          break;
        case " ": {
          // Find any ancestor matching
          let ancestor: SieveNode | null = current.parentNode;
          let found = false;
          while (ancestor) {
            if (ancestor instanceof SieveElement && matchSimple(ancestor, prev.simple)) {
              current = ancestor;
              found = true;
              // Process the rest of the chain from this ancestor
              i--; // skip the prev compound since we matched it
              break;
            }
            ancestor = ancestor.parentNode;
          }
          if (!found) return false;
          break;
        }
        case "+": {
          const prevSibling: SieveNode | null = current.previousSibling;
          // Walk back past non-element nodes
          let sib: SieveNode | null = prevSibling;
          while (sib && !(sib instanceof SieveElement)) {
            sib = sib.previousSibling;
          }
          current = sib instanceof SieveElement ? sib : null;
          break;
        }
        case "~": {
          // Any preceding sibling
          if (!current.parentNode) return false;
          const siblings: SieveNode[] = current.parentNode.childNodes;
          const idx = siblings.indexOf(current);
          let found = false;
          for (let j = idx - 1; j >= 0; j--) {
            const sib: SieveNode = siblings[j]!;
            if (sib instanceof SieveElement && matchSimple(sib, prev.simple)) {
              current = sib;
              found = true;
              i--;
              break;
            }
          }
          if (!found) return false;
          break;
        }
        default:
          current = current.parentNode instanceof SieveElement ? current.parentNode : null;
      }
    }
  }

  return true;
}

// --- Public API ---

export function parseSelector(input: string): SelectorList {
  return new SelectorParser(input.trim()).parse();
}

export function matchesSelector(el: SieveElement, selector: string): boolean {
  const list = parseSelector(selector);
  return list.some((compounds) => matchCompound(el, compounds));
}

export function querySelector(
  root: SieveNode,
  selector: string
): SieveElement | null {
  const list = parseSelector(selector);
  for (const node of root.descendants()) {
    if (node instanceof SieveElement) {
      if (list.some((compounds) => matchCompound(node, compounds))) {
        return node;
      }
    }
  }
  return null;
}

export function querySelectorAll(
  root: SieveNode,
  selector: string
): SieveElement[] {
  const list = parseSelector(selector);
  const results: SieveElement[] = [];
  for (const node of root.descendants()) {
    if (node instanceof SieveElement) {
      if (list.some((compounds) => matchCompound(node, compounds))) {
        results.push(node);
      }
    }
  }
  return results;
}
