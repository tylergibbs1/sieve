/**
 * Condition-based waiting.
 * In sieve, "waiting" is checking conditions against current state.
 * No real timeouts — pages are data, not live processes.
 */

import type { SieveDocument } from "../dom/document.ts";
import { querySelector, querySelectorAll } from "../css/selector.ts";
import type { SieveElement } from "../dom/element.ts";
import { isVisible } from "../css/computed.ts";

export interface WaitResult {
  satisfied: boolean;
  element?: SieveElement;
  message: string;
}

/** Check if an element matching the selector exists. */
export function waitForSelector(doc: SieveDocument, selector: string): WaitResult {
  const el = querySelector(doc, selector);
  if (el) {
    return { satisfied: true, element: el, message: `Found: ${selector}` };
  }
  return { satisfied: false, message: `Not found: ${selector}` };
}

/** Check if an element matching the selector is visible. */
export function waitForVisible(doc: SieveDocument, selector: string): WaitResult {
  const el = querySelector(doc, selector);
  if (el && isVisible(el)) {
    return { satisfied: true, element: el, message: `Visible: ${selector}` };
  }
  if (el) {
    return { satisfied: false, message: `Found but hidden: ${selector}` };
  }
  return { satisfied: false, message: `Not found: ${selector}` };
}

/** Check if an element matching the selector is hidden or absent. */
export function waitForHidden(doc: SieveDocument, selector: string): WaitResult {
  const el = querySelector(doc, selector);
  if (!el) {
    return { satisfied: true, message: `Absent: ${selector}` };
  }
  if (!isVisible(el)) {
    return { satisfied: true, element: el, message: `Hidden: ${selector}` };
  }
  return { satisfied: false, message: `Still visible: ${selector}` };
}

/** Check if text appears anywhere in the document body. */
export function waitForText(doc: SieveDocument, text: string): WaitResult {
  const body = doc.body;
  if (!body) return { satisfied: false, message: `No body element` };

  if (body.textContent.includes(text)) {
    return { satisfied: true, message: `Text found: "${text}"` };
  }
  return { satisfied: false, message: `Text not found: "${text}"` };
}

/** Check if the document title contains the given text. */
export function waitForTitle(doc: SieveDocument, text: string): WaitResult {
  if (doc.title.includes(text)) {
    return { satisfied: true, message: `Title contains: "${text}"` };
  }
  return { satisfied: false, message: `Title "${doc.title}" does not contain "${text}"` };
}

/** Check a count condition: at least N elements match the selector. */
export function waitForCount(doc: SieveDocument, selector: string, minCount: number): WaitResult {
  const els = querySelectorAll(doc, selector);
  if (els.length >= minCount) {
    return { satisfied: true, message: `Found ${els.length} >= ${minCount}: ${selector}` };
  }
  return { satisfied: false, message: `Found ${els.length} < ${minCount}: ${selector}` };
}
