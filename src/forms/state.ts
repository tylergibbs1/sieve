/**
 * Form state management.
 * Tracks input values, validation, and serialization.
 */

import { SieveElement } from "../dom/element.ts";
import { querySelectorAll } from "../css/selector.ts";

// --- Form value tracking ---

/**
 * Virtual form state stored separately from DOM attributes.
 * DOM `value` attribute = initial/default value.
 * This map tracks the *current* value as a user would see it.
 */
const valueStore = new WeakMap<SieveElement, string>();
const checkedStore = new WeakMap<SieveElement, boolean>();
const selectedStore = new WeakMap<SieveElement, Set<string>>();

export function getInputValue(el: SieveElement): string {
  if (valueStore.has(el)) return valueStore.get(el)!;
  if (el.tagName === "textarea") return el.textContent;
  return el.getAttribute("value") ?? "";
}

export function setInputValue(el: SieveElement, value: string): void {
  valueStore.set(el, value);
}

export function isChecked(el: SieveElement): boolean {
  if (checkedStore.has(el)) return checkedStore.get(el)!;
  return el.hasAttribute("checked");
}

export function setChecked(el: SieveElement, checked: boolean): void {
  checkedStore.set(el, checked);
  if (checked) {
    el.setAttribute("checked", "");
  } else {
    el.removeAttribute("checked");
  }
}

export function getSelectedValues(el: SieveElement): Set<string> {
  if (selectedStore.has(el)) return selectedStore.get(el)!;
  // Build from DOM
  const options = querySelectorAll(el, "option[selected]");
  return new Set(options.map((o) => o.getAttribute("value") ?? o.textContent.trim()));
}

export function setSelectedValues(el: SieveElement, values: Set<string>): void {
  selectedStore.set(el, values);
  // Update DOM to match
  for (const option of querySelectorAll(el, "option")) {
    const val = option.getAttribute("value") ?? option.textContent.trim();
    if (values.has(val)) {
      option.setAttribute("selected", "");
    } else {
      option.removeAttribute("selected");
    }
  }
}

// --- Validation ---

export interface ValidationResult {
  valid: boolean;
  errors: { element: SieveElement; message: string }[];
}

export function validateForm(formEl: SieveElement): ValidationResult {
  const errors: { element: SieveElement; message: string }[] = [];
  const inputs = querySelectorAll(formEl, "input, textarea, select");

  for (const input of inputs) {
    if (input.hasAttribute("disabled")) continue;

    const name = input.getAttribute("name");
    if (!name) continue;

    const value = getInputValue(input);
    const type = input.getAttribute("type")?.toLowerCase() ?? "text";

    // Required check
    if (input.hasAttribute("required")) {
      if (input.tagName === "select") {
        const selected = getSelectedValues(input);
        if (selected.size === 0) {
          errors.push({ element: input, message: "Please select a value" });
          continue;
        }
      } else if (type === "checkbox" && !isChecked(input)) {
        errors.push({ element: input, message: "Please check this box" });
        continue;
      } else if (!value) {
        errors.push({ element: input, message: "Please fill out this field" });
        continue;
      }
    }

    if (!value) continue;

    // Pattern check
    const pattern = input.getAttribute("pattern");
    if (pattern) {
      const re = new RegExp(`^(?:${pattern})$`);
      if (!re.test(value)) {
        errors.push({ element: input, message: `Please match the format: ${pattern}` });
      }
    }

    // Min/max length
    const minLength = input.getAttribute("minlength");
    if (minLength && value.length < parseInt(minLength, 10)) {
      errors.push({
        element: input,
        message: `Please use at least ${minLength} characters`,
      });
    }
    const maxLength = input.getAttribute("maxlength");
    if (maxLength && value.length > parseInt(maxLength, 10)) {
      errors.push({
        element: input,
        message: `Please use no more than ${maxLength} characters`,
      });
    }

    // Type-specific validation
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push({ element: input, message: "Please enter a valid email address" });
    }
    if (type === "url") {
      try {
        new URL(value);
      } catch {
        errors.push({ element: input, message: "Please enter a valid URL" });
      }
    }
    if (type === "number") {
      const num = parseFloat(value);
      if (isNaN(num)) {
        errors.push({ element: input, message: "Please enter a number" });
      } else {
        const min = input.getAttribute("min");
        if (min !== null && num < parseFloat(min)) {
          errors.push({ element: input, message: `Value must be at least ${min}` });
        }
        const max = input.getAttribute("max");
        if (max !== null && num > parseFloat(max)) {
          errors.push({ element: input, message: `Value must be at most ${max}` });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Serialization ---

export function serializeForm(
  formEl: SieveElement,
): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};
  const inputs = querySelectorAll(formEl, "input, textarea, select");

  for (const input of inputs) {
    if (input.hasAttribute("disabled")) continue;

    const name = input.getAttribute("name");
    if (!name) continue;

    const type = input.getAttribute("type")?.toLowerCase() ?? "text";

    if (input.tagName === "select") {
      const values = [...getSelectedValues(input)];
      if (input.hasAttribute("multiple")) {
        data[name] = values;
      } else {
        data[name] = values[0] ?? "";
      }
      continue;
    }

    if (type === "checkbox") {
      if (isChecked(input)) {
        data[name] = input.getAttribute("value") ?? "on";
      }
      continue;
    }

    if (type === "radio") {
      if (isChecked(input)) {
        data[name] = input.getAttribute("value") ?? "";
      }
      continue;
    }

    if (type === "file" || type === "image") continue;

    data[name] = getInputValue(input);
  }

  return data;
}

/** Serialize as URL-encoded form data. */
export function serializeFormURLEncoded(formEl: SieveElement): string {
  const data = serializeForm(formEl);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  return params.toString();
}
