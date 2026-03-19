import { NodeType, SieveNode } from "./node.ts";
import { SieveElement } from "./element.ts";
import { querySelector, querySelectorAll } from "../css/selector.ts";

export class SieveDocumentType extends SieveNode {
  readonly nodeType = NodeType.DocumentType;

  get textContent(): string {
    return "";
  }
  set textContent(_value: string) {}

  clone(_deep: boolean): SieveDocumentType {
    return new SieveDocumentType();
  }
}

export class SieveDocument extends SieveNode {
  readonly nodeType = NodeType.Document;

  get textContent(): string {
    return "";
  }
  set textContent(_value: string) {}

  /** The <html> element, if present. */
  get documentElement(): SieveElement | null {
    return this.childNodes.find(
      (n): n is SieveElement =>
        n instanceof SieveElement && n.tagName === "html"
    ) ?? null;
  }

  /** The <head> element. */
  get head(): SieveElement | null {
    return this.querySelector("head");
  }

  /** The <body> element. */
  get body(): SieveElement | null {
    return this.querySelector("body");
  }

  /** The document title. */
  get title(): string {
    const titleEl = this.querySelector("title");
    return titleEl?.textContent.trim() ?? "";
  }

  set title(value: string) {
    const titleEl = this.querySelector("title");
    if (titleEl) {
      titleEl.textContent = value;
    }
  }

  querySelector(selector: string): SieveElement | null {
    return querySelector(this, selector);
  }

  querySelectorAll(selector: string): SieveElement[] {
    return querySelectorAll(this, selector);
  }

  getElementById(id: string): SieveElement | null {
    return querySelector(this, `#${id}`);
  }

  getElementsByTagName(tag: string): SieveElement[] {
    return querySelectorAll(this, tag);
  }

  getElementsByClassName(className: string): SieveElement[] {
    return querySelectorAll(this, `.${className}`);
  }

  createElement(tagName: string): SieveElement {
    return new SieveElement(tagName);
  }

  clone(deep: boolean): SieveDocument {
    const doc = new SieveDocument();
    if (deep) {
      for (const child of this.childNodes) {
        doc.appendChild(child.clone(true));
      }
    }
    return doc;
  }
}
