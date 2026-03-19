import { NodeType, SieveNode } from "./node.ts";
import { SieveText } from "./text.ts";

/** Void elements that cannot have children. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export class SieveElement extends SieveNode {
  readonly nodeType = NodeType.Element;
  readonly tagName: string;
  readonly attributes: Map<string, string> = new Map();
  readonly isVoid: boolean;

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toLowerCase();
    this.isVoid = VOID_ELEMENTS.has(this.tagName);
  }

  protected override assertCanHaveChildren(): void {
    if (this.isVoid) {
      throw new Error(`Void element <${this.tagName}> cannot have children`);
    }
  }

  // --- Attribute accessors ---

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  set id(value: string) {
    this.setAttribute("id", value);
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }

  get classList(): ClassList {
    return new ClassList(this);
  }

  // --- Text content ---

  get textContent(): string {
    let text = "";
    for (const node of this.descendants()) {
      if (node instanceof SieveText) {
        text += node.data;
      }
    }
    return text;
  }

  set textContent(value: string) {
    // Detach all existing children to maintain parent backlinks
    for (const child of this.childNodes) {
      child.parentNode = null;
    }
    this.childNodes = [];
    if (value) {
      this.appendChild(new SieveText(value));
    }
  }

  /** The inner text, collapsing whitespace like a browser would. */
  get innerText(): string {
    return this.textContent.replace(/\s+/g, " ").trim();
  }

  // --- Query ---

  get children(): SieveElement[] {
    return this.childNodes.filter(
      (n): n is SieveElement => n.nodeType === NodeType.Element
    );
  }

  /** Walk descendants and return all SieveElements. */
  *elementDescendants(): Generator<SieveElement> {
    for (const node of this.descendants()) {
      if (node instanceof SieveElement) {
        yield node;
      }
    }
  }

  // --- Clone ---

  clone(deep: boolean): SieveElement {
    const el = new SieveElement(this.tagName);
    for (const [k, v] of this.attributes) {
      el.attributes.set(k, v);
    }
    if (deep) {
      for (const child of this.childNodes) {
        el.appendChild(child.clone(true));
      }
    }
    return el;
  }
}

/** Lightweight class-list helper that reads/writes the class attribute. */
class ClassList {
  constructor(private el: SieveElement) {}

  private get tokens(): string[] {
    const raw = this.el.getAttribute("class") ?? "";
    return raw.split(/\s+/).filter(Boolean);
  }

  private set tokens(list: string[]) {
    this.el.setAttribute("class", list.join(" "));
  }

  contains(token: string): boolean {
    return this.tokens.includes(token);
  }

  add(...tokens: string[]): void {
    const current = this.tokens;
    for (const t of tokens) {
      if (!current.includes(t)) current.push(t);
    }
    this.tokens = current;
  }

  remove(...tokens: string[]): void {
    this.tokens = this.tokens.filter((t) => !tokens.includes(t));
  }

  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    if (force !== undefined) {
      if (force) {
        this.add(token);
        return true;
      }
      this.remove(token);
      return false;
    }
    if (has) {
      this.remove(token);
      return false;
    }
    this.add(token);
    return true;
  }

  toString(): string {
    return this.tokens.join(" ");
  }
}
