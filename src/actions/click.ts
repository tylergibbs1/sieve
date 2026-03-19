/**
 * Click simulation.
 * Resolves the click target, checks visibility, handles navigation for links,
 * and toggles state for checkboxes/radios.
 */

import { SieveElement } from "../dom/element.ts";
import { isVisible } from "../css/computed.ts";
import { isChecked, setChecked } from "../forms/state.ts";
import { querySelectorAll } from "../css/selector.ts";
import type { SieveNode } from "../dom/node.ts";

export interface ClickResult {
  /** The element that was clicked. */
  target: SieveElement;
  /** Whether the element was visible and clickable. */
  success: boolean;
  /** If the click triggers navigation, the target URL. */
  navigateTo?: string;
  /** If the click submits a form, the form element. */
  submitsForm?: SieveElement;
  /** Description of what happened. */
  effect: string;
}

/** Walk up to find the nearest interactive ancestor. */
function findInteractiveAncestor(el: SieveElement): SieveElement {
  let current: SieveNode | null = el;
  while (current instanceof SieveElement) {
    const tag = current.tagName;
    if (tag === "a" || tag === "button" || tag === "input" || tag === "select" ||
        tag === "textarea" || tag === "summary" || tag === "label" ||
        current.hasAttribute("onclick") || current.getAttribute("role") === "button" ||
        current.getAttribute("tabindex") !== null) {
      return current;
    }
    current = current.parentNode;
  }
  return el;
}

/** Find the form that contains this element. */
function findParentForm(el: SieveElement): SieveElement | null {
  let current: SieveNode | null = el.parentNode;
  while (current) {
    if (current instanceof SieveElement && current.tagName === "form") {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/** Find the root document/element for querySelector scope. */
function findRoot(el: SieveElement): SieveNode {
  let root: SieveNode = el;
  while (root.parentNode) root = root.parentNode;
  return root;
}

export function simulateClick(el: SieveElement): ClickResult {
  if (!isVisible(el)) {
    return { target: el, success: false, effect: "Element is not visible" };
  }

  const interactive = findInteractiveAncestor(el);
  const tag = interactive.tagName;
  const type = interactive.getAttribute("type")?.toLowerCase();

  // Disabled controls reject all clicks
  if (interactive.hasAttribute("disabled")) {
    return { target: interactive, success: false, effect: "Element is disabled" };
  }

  // Links
  if (tag === "a") {
    const href = interactive.getAttribute("href");
    if (href) {
      return {
        target: interactive,
        success: true,
        navigateTo: href,
        effect: `Navigate to ${href}`,
      };
    }
    return { target: interactive, success: true, effect: "Link clicked (no href)" };
  }

  // Submit buttons
  if (tag === "button" || (tag === "input" && (type === "submit" || type === "image"))) {
    const isSubmit = tag === "button"
      ? (type !== "button" && type !== "reset")
      : true;

    if (isSubmit) {
      const form = findParentForm(interactive);
      if (form) {
        return {
          target: interactive,
          success: true,
          submitsForm: form,
          effect: "Form submitted",
        };
      }
    }

    if (type === "reset") {
      return { target: interactive, success: true, effect: "Form reset" };
    }

    return { target: interactive, success: true, effect: "Button clicked" };
  }

  // Checkboxes
  if (tag === "input" && type === "checkbox") {
    const checked = !isChecked(interactive);
    setChecked(interactive, checked);
    return {
      target: interactive,
      success: true,
      effect: checked ? "Checkbox checked" : "Checkbox unchecked",
    };
  }

  // Radio buttons
  if (tag === "input" && type === "radio") {
    const name = interactive.getAttribute("name");
    if (name) {
      // Uncheck other radios in the same group, scoped to the parent form
      const scope = findParentForm(interactive) ?? findRoot(interactive);
      const radios = querySelectorAll(scope, `input[type="radio"][name="${name}"]`);
      for (const radio of radios) {
        setChecked(radio, false);
      }
    }
    setChecked(interactive, true);
    return { target: interactive, success: true, effect: "Radio selected" };
  }

  // Details/summary toggle
  if (tag === "summary") {
    const details = interactive.parentNode;
    if (details instanceof SieveElement && details.tagName === "details") {
      if (details.hasAttribute("open")) {
        details.removeAttribute("open");
        return { target: interactive, success: true, effect: "Details collapsed" };
      }
      details.setAttribute("open", "");
      return { target: interactive, success: true, effect: "Details expanded" };
    }
  }

  // Label — click the associated input
  if (tag === "label") {
    const forId = interactive.getAttribute("for");
    if (forId) {
      const root = findRoot(interactive);
      const target = querySelectorAll(root, `#${forId}`)[0];
      if (target) {
        return simulateClick(target);
      }
    }
    // Check for wrapped input
    const wrappedInput = querySelectorAll(interactive, "input, textarea, select")[0];
    if (wrappedInput) {
      return simulateClick(wrappedInput);
    }
  }

  return { target: interactive, success: true, effect: "Element clicked" };
}
