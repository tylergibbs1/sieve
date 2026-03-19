/**
 * Declarative rule engine (Layer 1).
 *
 * Define state transitions as rules instead of running JavaScript.
 * "When button X is clicked, element Y becomes visible."
 *
 * This lets you model interactive pages without running arbitrary code.
 * Good for testing known UIs and simulating simple SPA behavior.
 */

import type { SieveDocument } from "../dom/document.ts";
import { querySelector, querySelectorAll } from "../css/selector.ts";
import type { SieveElement } from "../dom/element.ts";
import { isVisible } from "../css/computed.ts";
import { SieveText } from "../dom/text.ts";

// --- Rule types ---

export type RuleTrigger =
  | { click: string }
  | { type: string; value?: string }
  | { select: string; value?: string }
  | { hover: string }
  | { focus: string };

export type RuleEffect =
  | { show: string }
  | { hide: string }
  | { toggle: string }
  | { addClass: string; class: string }
  | { removeClass: string; class: string }
  | { toggleClass: string; class: string }
  | { setAttribute: string; attr: string; value: string }
  | { removeAttribute: string; attr: string }
  | { setText: string; text: string }
  | { setHTML: string; html: string }
  | { remove: string }
  | { enable: string }
  | { disable: string };

export interface Rule {
  trigger: RuleTrigger;
  effect: RuleEffect | RuleEffect[];
  /** Only apply if this condition is met. */
  when?: string; // CSS selector — rule fires only if this element exists
}

// --- Engine ---

export class RuleEngine {
  private rules: Rule[] = [];

  constructor(rules: Rule[] = []) {
    this.rules = [...rules];
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  addRules(rules: Rule[]): void {
    this.rules.push(...rules);
  }

  /**
   * Process a trigger event and apply matching rules.
   * Returns the number of effects applied.
   */
  process(
    trigger: { type: "click" | "type" | "select" | "hover" | "focus"; target: SieveElement; value?: string },
    doc: SieveDocument,
  ): number {
    let applied = 0;

    for (const rule of this.rules) {
      if (!this.matchesTrigger(rule.trigger, trigger, doc)) continue;
      if (rule.when && !querySelector(doc, rule.when)) continue;

      const effects = Array.isArray(rule.effect) ? rule.effect : [rule.effect];
      for (const effect of effects) {
        if (this.applyEffect(effect, doc)) {
          applied++;
        }
      }
    }

    return applied;
  }

  private matchesTrigger(
    ruleTrigger: RuleTrigger,
    event: { type: string; target: SieveElement; value?: string },
    doc: SieveDocument,
  ): boolean {
    if ("click" in ruleTrigger && event.type === "click") {
      const el = querySelector(doc, ruleTrigger.click);
      return el === event.target;
    }
    if ("type" in ruleTrigger && event.type === "type") {
      const el = querySelector(doc, ruleTrigger.type);
      if (el !== event.target) return false;
      if (ruleTrigger.value !== undefined && ruleTrigger.value !== event.value) return false;
      return true;
    }
    if ("select" in ruleTrigger && event.type === "select") {
      const el = querySelector(doc, ruleTrigger.select);
      if (el !== event.target) return false;
      if (ruleTrigger.value !== undefined && ruleTrigger.value !== event.value) return false;
      return true;
    }
    if ("hover" in ruleTrigger && event.type === "hover") {
      return querySelector(doc, ruleTrigger.hover) === event.target;
    }
    if ("focus" in ruleTrigger && event.type === "focus") {
      return querySelector(doc, ruleTrigger.focus) === event.target;
    }
    return false;
  }

  private applyEffect(effect: RuleEffect, doc: SieveDocument): boolean {
    if ("show" in effect) {
      const el = querySelector(doc, effect.show);
      if (!el) return false;
      el.removeAttribute("hidden");
      const style = el.getAttribute("style") ?? "";
      el.setAttribute("style", style.replace(/display\s*:\s*none\s*;?/gi, "").trim());
      return true;
    }

    if ("hide" in effect) {
      const el = querySelector(doc, effect.hide);
      if (!el) return false;
      el.setAttribute("hidden", "");
      return true;
    }

    if ("toggle" in effect) {
      const el = querySelector(doc, effect.toggle);
      if (!el) return false;
      if (el.hasAttribute("hidden")) {
        el.removeAttribute("hidden");
      } else {
        el.setAttribute("hidden", "");
      }
      return true;
    }

    if ("addClass" in effect) {
      const el = querySelector(doc, effect.addClass);
      if (!el) return false;
      el.classList.add(effect.class);
      return true;
    }

    if ("removeClass" in effect) {
      const el = querySelector(doc, effect.removeClass);
      if (!el) return false;
      el.classList.remove(effect.class);
      return true;
    }

    if ("toggleClass" in effect) {
      const el = querySelector(doc, effect.toggleClass);
      if (!el) return false;
      el.classList.toggle(effect.class);
      return true;
    }

    if ("setAttribute" in effect) {
      const el = querySelector(doc, effect.setAttribute);
      if (!el) return false;
      el.setAttribute(effect.attr, effect.value);
      return true;
    }

    if ("removeAttribute" in effect) {
      const el = querySelector(doc, effect.removeAttribute);
      if (!el) return false;
      el.removeAttribute(effect.attr);
      return true;
    }

    if ("setText" in effect) {
      const el = querySelector(doc, effect.setText);
      if (!el) return false;
      el.textContent = effect.text;
      return true;
    }

    if ("remove" in effect) {
      const el = querySelector(doc, effect.remove);
      if (!el || !el.parentNode) return false;
      el.parentNode.removeChild(el);
      return true;
    }

    if ("enable" in effect) {
      const el = querySelector(doc, effect.enable);
      if (!el) return false;
      el.removeAttribute("disabled");
      return true;
    }

    if ("disable" in effect) {
      const el = querySelector(doc, effect.disable);
      if (!el) return false;
      el.setAttribute("disabled", "");
      return true;
    }

    return false;
  }
}
