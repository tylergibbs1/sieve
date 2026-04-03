/**
 * Structured data extraction from accessibility trees.
 *
 * Extracts tables, lists, and structured content as typed JSON objects.
 * Works with both virtual DOM and CDP accessibility trees since both
 * produce the same A11yNode format.
 */

import type { A11yNode } from "./tree.ts";

/** A table extracted from the a11y tree. */
export interface ExtractedTable {
  /** Table caption or accessible name. */
  name: string;
  /** Column headers (from first row or <th> elements). */
  headers: string[];
  /** Data rows (each row is an array of cell text). */
  rows: string[][];
}

/** A list extracted from the a11y tree. */
export interface ExtractedList {
  /** List accessible name (if any). */
  name: string;
  /** Whether this is an ordered list. */
  ordered: boolean;
  /** List items. */
  items: string[];
}

/** A link extracted from the a11y tree. */
export interface ExtractedLink {
  text: string;
  ref?: string;
}

/** A form field extracted from the a11y tree. */
export interface ExtractedFormField {
  role: string;
  name: string;
  value?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  checked?: boolean;
  ref?: string;
}

/** A form extracted from the a11y tree. */
export interface ExtractedForm {
  name: string;
  fields: ExtractedFormField[];
}

/** All structured data from a page. */
export interface ExtractedData {
  tables: ExtractedTable[];
  lists: ExtractedList[];
  links: ExtractedLink[];
  forms: ExtractedForm[];
  headings: { level: number; text: string }[];
}

/** Extract all tables from the a11y tree. */
export function extractTables(root: A11yNode): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  walkNodes(root, (node) => {
    if (node.role === "table") {
      tables.push(extractOneTable(node));
    }
  });
  return tables;
}

/** Extract all lists from the a11y tree. */
export function extractLists(root: A11yNode): ExtractedList[] {
  const lists: ExtractedList[] = [];
  walkNodes(root, (node) => {
    if (node.role === "list") {
      const items: string[] = [];
      for (const child of node.children) {
        if (child.role === "listitem") {
          items.push(getNodeText(child));
        }
      }
      if (items.length > 0) {
        lists.push({
          name: node.name || "",
          ordered: false, // a11y tree doesn't distinguish ol/ul
          items,
        });
      }
    }
  });
  return lists;
}

/** Extract all links from the a11y tree. */
export function extractLinks(root: A11yNode): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  walkNodes(root, (node) => {
    if (node.role === "link" && node.name) {
      links.push({ text: node.name, ref: node.ref });
    }
  });
  return links;
}

/** Extract all forms from the a11y tree. */
export function extractForms(root: A11yNode): ExtractedForm[] {
  const forms: ExtractedForm[] = [];
  walkNodes(root, (node) => {
    if (node.role === "form") {
      const fields: ExtractedFormField[] = [];
      walkNodes(node, (child) => {
        if (isFormField(child)) {
          fields.push({
            role: child.role,
            name: child.name,
            value: child.value,
            required: child.required,
            disabled: child.disabled,
            placeholder: child.placeholder,
            checked: child.checked,
            ref: child.ref,
          });
        }
      });
      forms.push({ name: node.name || "", fields });
    }
  });
  return forms;
}

/** Extract all headings from the a11y tree. */
export function extractHeadings(root: A11yNode): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  walkNodes(root, (node) => {
    if (node.role === "heading" && node.level) {
      headings.push({ level: node.level, text: node.name });
    }
  });
  return headings;
}

/** Extract all structured data from an a11y tree. */
export function extractStructured(root: A11yNode): ExtractedData {
  return {
    tables: extractTables(root),
    lists: extractLists(root),
    links: extractLinks(root),
    forms: extractForms(root),
    headings: extractHeadings(root),
  };
}

// --- Helpers ---

function extractOneTable(tableNode: A11yNode): ExtractedTable {
  const headers: string[] = [];
  const rows: string[][] = [];

  for (const child of tableNode.children) {
    if (child.role === "rowgroup") {
      for (const row of child.children) {
        if (row.role === "row") processRow(row, headers, rows);
      }
    } else if (child.role === "row") {
      processRow(child, headers, rows);
    }
  }

  // If first data row looks like headers and we have none, promote it
  if (headers.length === 0 && rows.length > 0) {
    headers.push(...rows.shift()!);
  }

  return {
    name: tableNode.name || "",
    headers,
    rows,
  };
}

function processRow(
  rowNode: A11yNode,
  headers: string[],
  rows: string[][],
): void {
  const cells: string[] = [];
  let isHeader = false;

  for (const cell of rowNode.children) {
    if (cell.role === "columnheader" || cell.role === "rowheader") {
      isHeader = true;
    }
    cells.push(getNodeText(cell));
  }

  if (isHeader) {
    headers.push(...cells);
  } else if (cells.length > 0) {
    rows.push(cells);
  }
}

function getNodeText(node: A11yNode): string {
  if (node.name) return node.name;
  if (node.value) return node.value;
  // Collect text from children
  const parts: string[] = [];
  for (const child of node.children) {
    const text = getNodeText(child);
    if (text) parts.push(text);
  }
  return parts.join(" ").trim();
}

const FORM_FIELD_ROLES = new Set([
  "textbox", "searchbox", "checkbox", "radio", "combobox",
  "listbox", "slider", "spinbutton", "switch",
]);

function isFormField(node: A11yNode): boolean {
  return FORM_FIELD_ROLES.has(node.role);
}

function walkNodes(root: A11yNode, fn: (node: A11yNode) => void): void {
  fn(root);
  for (const child of root.children) {
    walkNodes(child, fn);
  }
}
