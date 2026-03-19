/**
 * Select option simulation.
 */

import { SieveElement } from "../dom/element.ts";
import { isVisible } from "../css/computed.ts";
import { getSelectedValues, setSelectedValues } from "../forms/state.ts";
import { querySelectorAll } from "../css/selector.ts";

export interface SelectResult {
  success: boolean;
  selectedValues: string[];
  effect: string;
}

/** Select an option in a <select> element by value. */
export function simulateSelect(el: SieveElement, ...values: string[]): SelectResult {
  if (el.tagName !== "select") {
    return { success: false, selectedValues: [], effect: "Element is not a select" };
  }
  if (!isVisible(el)) {
    return { success: false, selectedValues: [], effect: "Element is not visible" };
  }
  if (el.hasAttribute("disabled")) {
    return { success: false, selectedValues: [], effect: "Select is disabled" };
  }

  const isMultiple = el.hasAttribute("multiple");
  const options = querySelectorAll(el, "option");
  const validValues = new Set(
    options.map((o) => o.getAttribute("value") ?? o.textContent.trim()),
  );

  const toSelect = values.filter((v) => validValues.has(v));
  if (toSelect.length === 0) {
    return {
      success: false,
      selectedValues: [...getSelectedValues(el)],
      effect: `No matching options for: ${values.join(", ")}`,
    };
  }

  if (!isMultiple) {
    // Single select: take the last value
    setSelectedValues(el, new Set([toSelect[toSelect.length - 1]!]));
  } else {
    setSelectedValues(el, new Set(toSelect));
  }

  const selected = [...getSelectedValues(el)];
  return {
    success: true,
    selectedValues: selected,
    effect: `Selected: ${selected.join(", ")}`,
  };
}

/** Select an option by its visible text label. */
export function simulateSelectByText(el: SieveElement, ...labels: string[]): SelectResult {
  if (el.tagName !== "select") {
    return { success: false, selectedValues: [], effect: "Element is not a select" };
  }

  const options = querySelectorAll(el, "option");
  const values: string[] = [];
  for (const label of labels) {
    const option = options.find((o) => o.textContent.trim() === label);
    if (option) {
      values.push(option.getAttribute("value") ?? option.textContent.trim());
    }
  }

  return simulateSelect(el, ...values);
}
