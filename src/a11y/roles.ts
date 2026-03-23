/**
 * ARIA role computation from HTML semantics.
 * Maps elements to their implicit ARIA roles per WAI-ARIA spec.
 */

import { SieveElement } from "../dom/element.ts";

/** Implicit ARIA roles based on tag name + attributes. */
export function getImplicitRole(el: SieveElement): string | null {
  const tag = el.tagName;
  const type = el.getAttribute("type")?.toLowerCase();

  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : null;
    case "article":
      return "article";
    case "aside":
      return "complementary";
    case "button":
      return "button";
    case "datalist":
      return "listbox";
    case "details":
      return "group";
    case "dialog":
      return "dialog";
    case "fieldset":
      return "group";
    case "figure":
      return "figure";
    case "footer":
      return "contentinfo";
    case "form":
      return "form";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "header":
      return "banner";
    case "hr":
      return "separator";
    case "img":
      return el.getAttribute("alt") === "" ? "presentation" : "img";
    case "input":
      switch (type) {
        case "button":
        case "image":
        case "reset":
        case "submit":
          return "button";
        case "checkbox":
          return "checkbox";
        case "radio":
          return "radio";
        case "range":
          return "slider";
        case "search":
          return "searchbox";
        case "number":
          return "spinbutton";
        case "email":
        case "tel":
        case "text":
        case "url":
        case "password":
        case null:
        case undefined:
          return "textbox";
        default:
          return "textbox";
      }
    case "li":
      return "listitem";
    case "main":
      return "main";
    case "math":
      return "math";
    case "menu":
      return "list";
    case "meter":
      return "meter";
    case "nav":
      return "navigation";
    case "ol":
    case "ul":
      return "list";
    case "optgroup":
      return "group";
    case "option":
      return "option";
    case "output":
      return "status";
    case "progress":
      return "progressbar";
    case "section":
      return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")
        ? "region"
        : null;
    case "select":
      return el.hasAttribute("multiple") ? "listbox" : "combobox";
    case "summary":
      return "button";
    case "table":
      return "table";
    case "tbody":
    case "tfoot":
    case "thead":
      return "rowgroup";
    case "td":
      return "cell";
    case "textarea":
      return "textbox";
    case "th":
      return "columnheader";
    case "tr":
      return "row";
    default:
      return null;
  }
}

/**
 * Detect cursor-interactive elements that lack semantic roles.
 * These are divs/spans with onclick, tabindex, or contenteditable
 * that would be invisible to the a11y tree without this heuristic.
 */
function getCursorInteractiveRole(el: SieveElement): string | null {
  // onclick or event handler attributes → button
  if (el.hasAttribute("onclick") || el.hasAttribute("onmousedown") || el.hasAttribute("onmouseup")) {
    return "button";
  }
  // tabindex makes it focusable — if it has a non-negative tabindex, it's interactive
  const tabindex = el.getAttribute("tabindex");
  if (tabindex !== null && tabindex !== "-1") {
    return "button";
  }
  // contenteditable → textbox
  const editable = el.getAttribute("contenteditable");
  if (editable === "" || editable === "true") {
    return "textbox";
  }
  return null;
}

/** Get the effective ARIA role (explicit > implicit > cursor-interactive). */
export function getRole(el: SieveElement): string | null {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0]?.toLowerCase() ?? null;
  const implicit = getImplicitRole(el);
  if (implicit) return implicit;
  return getCursorInteractiveRole(el);
}

/** Get the heading level for heading elements. */
export function getHeadingLevel(el: SieveElement): number | null {
  const match = el.tagName.match(/^h([1-6])$/);
  return match ? parseInt(match[1]!, 10) : null;
}
