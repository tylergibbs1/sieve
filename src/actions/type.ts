/**
 * Keyboard input simulation.
 */

import { SieveElement } from "../dom/element.ts";
import { isVisible } from "../css/computed.ts";
import { getInputValue, setInputValue } from "../forms/state.ts";

export interface TypeResult {
  success: boolean;
  value: string;
  effect: string;
}

const TYPEABLE_TAGS = new Set(["input", "textarea"]);
const NON_TYPEABLE_INPUT_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset", "image", "file",
  "hidden", "range", "color",
]);

function isTypeable(el: SieveElement): boolean {
  if (!TYPEABLE_TAGS.has(el.tagName)) return false;
  if (el.tagName === "input") {
    const type = el.getAttribute("type")?.toLowerCase() ?? "text";
    if (NON_TYPEABLE_INPUT_TYPES.has(type)) return false;
  }
  if (el.hasAttribute("disabled") || el.hasAttribute("readonly")) return false;
  return true;
}

/** Simulate typing text into an input/textarea. Replaces the current value. */
export function simulateType(el: SieveElement, text: string): TypeResult {
  if (!isVisible(el)) {
    return { success: false, value: "", effect: "Element is not visible" };
  }
  if (!isTypeable(el)) {
    return { success: false, value: "", effect: "Element is not a typeable input" };
  }

  setInputValue(el, text);
  return { success: true, value: text, effect: `Typed "${text}"` };
}

/** Simulate pressing keys to append to the current value. */
export function simulateKeyPress(el: SieveElement, text: string): TypeResult {
  if (!isVisible(el)) {
    return { success: false, value: "", effect: "Element is not visible" };
  }
  if (!isTypeable(el)) {
    return { success: false, value: "", effect: "Element is not a typeable input" };
  }

  const current = getInputValue(el);
  const newValue = current + text;
  setInputValue(el, newValue);
  return { success: true, value: newValue, effect: `Appended "${text}"` };
}

/** Clear the value of an input. */
export function simulateClear(el: SieveElement): TypeResult {
  if (!isTypeable(el)) {
    return { success: false, value: "", effect: "Element is not a typeable input" };
  }

  setInputValue(el, "");
  return { success: true, value: "", effect: "Input cleared" };
}
