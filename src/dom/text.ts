import { NodeType, SieveNode } from "./node.ts";

export class SieveText extends SieveNode {
  readonly nodeType = NodeType.Text;
  data: string;

  constructor(data: string) {
    super();
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }

  clone(_deep: boolean): SieveText {
    return new SieveText(this.data);
  }
}

export class SieveComment extends SieveNode {
  readonly nodeType = NodeType.Comment;
  data: string;

  constructor(data: string) {
    super();
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
  }

  clone(_deep: boolean): SieveComment {
    return new SieveComment(this.data);
  }
}
