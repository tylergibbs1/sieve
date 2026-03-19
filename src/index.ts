/**
 * sieve — A virtual browser for AI agents.
 * No rendering. No Chromium. Just the parts that matter.
 */

// Core API
export { SieveBrowser, type BrowserOptions, type NetworkConfig } from "./browser.ts";
export { SievePage, FormHandle, AccessibilityTreeHandle, type PageOptions } from "./page.ts";

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
export { serializeAccessibilityTree } from "./a11y/serialize.ts";
export { getRole, getImplicitRole, getHeadingLevel } from "./a11y/roles.ts";

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
  validateForm,
  getSelectedValues,
  setSelectedValues,
} from "./forms/state.ts";

// Actions
export { simulateClick, type ClickResult } from "./actions/click.ts";
export { simulateType, simulateClear, type TypeResult } from "./actions/type.ts";
export { simulateSelect, simulateSelectByText, type SelectResult } from "./actions/select.ts";

// Navigation
export { NavigationHistory, resolveUrl } from "./navigation/router.ts";
export { CookieJar, type Cookie } from "./navigation/cookies.ts";
export { SieveStorage } from "./navigation/session.ts";

// Network
export type { Fetcher, FetchResponse, FetchOptions } from "./network/fetcher.ts";
export { LiveFetcher } from "./network/live.ts";
export { MockFetcher, ReplayFetcher } from "./network/mock.ts";
export { DiskReplayFetcher, RecordingFetcher } from "./network/replay.ts";
export {
  solveChallenge,
  DEFAULT_SOLVERS,
  type ChallengeSolver,
  type ChallengeSolution,
} from "./network/challenges.ts";

// Persistence
export { SievePersistence, type PersistenceOptions } from "./persistence/sqlite.ts";
