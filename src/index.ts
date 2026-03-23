/**
 * sieve — A virtual browser for AI agents.
 * No rendering. No Chromium. Just the parts that matter.
 */

// Core API
export { SieveBrowser, type BrowserOptions, type NetworkConfig } from "./browser.ts";
export {
  SievePage,
  FormHandle,
  AccessibilityTreeHandle,
  type PageOptions,
  type SemanticLocator,
  type BatchAction,
  type BatchResult,
  type SessionState,
} from "./page.ts";

// DOM
export { SieveDocument, SieveDocumentType } from "./dom/document.ts";
export { SieveElement } from "./dom/element.ts";
export { SieveText, SieveComment } from "./dom/text.ts";
export { SieveNode, NodeType } from "./dom/node.ts";
export { parseHTML, parseHTMLAsync, type ParseOptions } from "./dom/parser.ts";
export { serialize } from "./dom/serializer.ts";

// HTMLRewriter preprocessing
export {
  rewriteHTML,
  stripForAgent,
  sanitizeHTML,
  extractMetadata,
  AGENT_STRIP_RULES,
  SANITIZE_RULES,
  type RewriteRule,
  type PageMetadata,
} from "./dom/rewriter.ts";

// CSS
export { querySelector, querySelectorAll, matchesSelector } from "./css/selector.ts";
export { getComputedStyle, isVisible } from "./css/computed.ts";

// Accessibility
export { buildAccessibilityTree, type A11yNode } from "./a11y/tree.ts";
export { serializeAccessibilityTree, type SerializeOptions } from "./a11y/serialize.ts";
export { getRole, getImplicitRole, getHeadingLevel } from "./a11y/roles.ts";
export { assignRefs, resolveRef, isLandmark, isSignificant, type RefMap } from "./a11y/refs.ts";
export { diffAccessibilityTrees } from "./a11y/diff.ts";
export { generateNonce } from "./a11y/nonce.ts";

// Snapshots
export {
  captureSnapshot,
  restoreSnapshot,
  diffSnapshots,
  type SnapshotChange,
  type DocumentSnapshot,
} from "./snapshot/capture.ts";
export {
  hashSnapshot,
  snapshotsEqual,
  snapshotId,
  snapshotDigest,
} from "./snapshot/hash.ts";

// Forms
export {
  getInputValue,
  setInputValue,
  isChecked,
  setChecked,
  serializeForm,
  serializeFormURLEncoded,
  validateForm,
  getSelectedValues,
  setSelectedValues,
} from "./forms/state.ts";

// Actions
export { simulateClick, type ClickResult } from "./actions/click.ts";
export { simulateType, simulateClear, type TypeResult } from "./actions/type.ts";
export { simulateSelect, simulateSelectByText, type SelectResult } from "./actions/select.ts";
export {
  checkPolicy,
  PolicyDeniedError,
  DEFAULT_POLICY,
  type ActionPolicy,
  type ActionType,
  type PolicyCheckResult,
} from "./actions/policy.ts";
export { getScrollPosition, setScrollPosition, scrollBy } from "./actions/scroll.ts";
export {
  waitForSelector,
  waitForVisible,
  waitForHidden,
  waitForText,
  waitForTitle,
  waitForCount,
  type WaitResult,
} from "./actions/wait.ts";

// Rules engine (Layer 1)
export { RuleEngine, type Rule, type RuleTrigger, type RuleEffect } from "./rules/engine.ts";

// Navigation
export { NavigationHistory, resolveUrl } from "./navigation/router.ts";
export { CookieJar, type Cookie } from "./navigation/cookies.ts";
export { SieveStorage } from "./navigation/session.ts";

// Network
export type { Fetcher, FetchResponse, FetchOptions } from "./network/fetcher.ts";
export { DomainPolicy, DomainBlockedError, type DomainPolicyOptions } from "./network/domain-policy.ts";
export { LiveFetcher } from "./network/live.ts";
export { MockFetcher, ReplayFetcher } from "./network/mock.ts";
export { DiskReplayFetcher, RecordingFetcher } from "./network/replay.ts";
export {
  solveChallenge,
  DEFAULT_SOLVERS,
  type ChallengeSolver,
  type ChallengeSolution,
} from "./network/challenges.ts";
export {
  PROFILES,
  CHROME_MAC,
  CHROME_WINDOWS,
  FIREFOX_MAC,
  SAFARI_MAC,
  buildNavigationHeaders,
  type BrowserProfile,
  type ProfileName,
} from "./network/profiles.ts";

// Persistence
export { SievePersistence, type PersistenceOptions } from "./persistence/sqlite.ts";

// Compat layers
export { asPuppeteer } from "./compat/puppeteer.ts";

// AI SDK tool
export { createBrowserTool, type BrowserAction, type BrowserToolOptions } from "./tool.ts";

// JavaScript sandbox (Layer 2)
export {
  executeSandboxed,
  executeDocumentScripts,
  scanScript,
  type SandboxResult,
} from "./js/sandbox.ts";

// Resource limits & events
export {
  DEFAULT_LIMITS,
  resolveLimits,
  EventEmitter,
  type ResourceLimits,
  type EventType,
  type SieveEvent,
  type EventHandler,
} from "./limits.ts";
