/**
 * Scroll position tracking.
 * Since sieve has no viewport, scroll is modeled as a numeric position
 * that agents can read and set. Useful for page-state tracking.
 */

import { SieveElement } from "../dom/element.ts";

const scrollPositions = new WeakMap<SieveElement, { x: number; y: number }>();

export function getScrollPosition(el: SieveElement): { x: number; y: number } {
  return scrollPositions.get(el) ?? { x: 0, y: 0 };
}

export function setScrollPosition(el: SieveElement, x: number, y: number): void {
  scrollPositions.set(el, { x, y });
}

/** Scroll an element by a delta. */
export function scrollBy(el: SieveElement, dx: number, dy: number): { x: number; y: number } {
  const current = getScrollPosition(el);
  const newPos = { x: Math.max(0, current.x + dx), y: Math.max(0, current.y + dy) };
  scrollPositions.set(el, newPos);
  return newPos;
}
