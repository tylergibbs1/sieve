/**
 * Base node types for the virtual DOM.
 *
 * Node hierarchy:
 *   SieveNode (abstract)
 *   ├── SieveDocument
 *   ├── SieveDocumentType
 *   ├── SieveElement
 *   ├── SieveText
 *   └── SieveComment
 */

export const enum NodeType {
  Element = 1,
  Text = 3,
  Comment = 8,
  Document = 9,
  DocumentType = 10,
}

let nextId = 1;

export abstract class SieveNode {
  readonly nodeId: number;
  abstract readonly nodeType: NodeType;

  parentNode: SieveNode | null = null;
  childNodes: SieveNode[] = [];

  constructor() {
    this.nodeId = nextId++;
  }

  get firstChild(): SieveNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): SieveNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): SieveNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const idx = siblings.indexOf(this);
    return siblings[idx + 1] ?? null;
  }

  get previousSibling(): SieveNode | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const idx = siblings.indexOf(this);
    return idx > 0 ? (siblings[idx - 1] ?? null) : null;
  }

  appendChild(child: SieveNode): SieveNode {
    this.assertCanHaveChildren();
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: SieveNode): SieveNode {
    const idx = this.childNodes.indexOf(child);
    if (idx === -1) throw new Error("Node is not a child of this node");
    this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  /** Override in subclasses that cannot have children (void elements). */
  protected assertCanHaveChildren(): void {}

  insertBefore(newChild: SieveNode, refChild: SieveNode | null): SieveNode {
    this.assertCanHaveChildren();
    if (!refChild) return this.appendChild(newChild);
    const idx = this.childNodes.indexOf(refChild);
    if (idx === -1) throw new Error("Reference node is not a child");
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    this.childNodes.splice(idx, 0, newChild);
    return newChild;
  }

  /** Depth-first traversal of all descendants. */
  *descendants(): Generator<SieveNode> {
    for (const child of this.childNodes) {
      yield child;
      yield* child.descendants();
    }
  }

  abstract get textContent(): string;
  abstract set textContent(value: string);

  abstract clone(deep: boolean): SieveNode;
}

/** Reset the ID counter — only for tests. */
export function _resetNodeIdCounter(): void {
  nextId = 1;
}
