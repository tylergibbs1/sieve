/**
 * Chrome DevTools Protocol types.
 * Minimal subset covering the methods sieve actually uses.
 */

// --- Transport ---

export interface CdpRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: string };
  sessionId?: string;
}

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export type CdpMessage = CdpResponse | CdpEvent;

export function isEvent(msg: CdpMessage): msg is CdpEvent {
  return !("id" in msg);
}

// --- Page domain ---

export interface NavigateParams {
  url: string;
  referrer?: string;
  transitionType?: string;
}

export interface NavigateResult {
  frameId: string;
  loaderId?: string;
  errorText?: string;
}

export interface CaptureScreenshotParams {
  format?: "jpeg" | "png" | "webp";
  quality?: number;
  clip?: { x: number; y: number; width: number; height: number; scale: number };
  fromSurface?: boolean;
  captureBeyondViewport?: boolean;
  optimizeForSpeed?: boolean;
}

export interface CaptureScreenshotResult {
  data: string; // base64
}

export interface NavigationEntry {
  id: number;
  url: string;
  title: string;
}

export interface GetNavigationHistoryResult {
  currentIndex: number;
  entries: NavigationEntry[];
}

// --- DOM domain ---

export interface DomNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName: string;
  nodeValue: string;
  childNodeCount?: number;
  children?: DomNode[];
  attributes?: string[];
}

export interface GetDocumentResult {
  root: DomNode;
}

export interface QuerySelectorResult {
  nodeId: number;
}

export interface QuerySelectorAllResult {
  nodeIds: number[];
}

export interface ResolveNodeResult {
  object: RemoteObject;
}

export interface GetBoxModelResult {
  model: {
    content: number[];
    padding: number[];
    border: number[];
    margin: number[];
    width: number;
    height: number;
  };
}

export interface GetOuterHTMLResult {
  outerHTML: string;
}

export interface DescribeNodeResult {
  node: DomNode;
}

// --- Runtime domain ---

export interface RemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  objectId?: string;
  description?: string;
  className?: string;
}

export interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: ExceptionDetails;
}

export interface ExceptionDetails {
  exceptionId: number;
  text: string;
  lineNumber: number;
  columnNumber: number;
  exception?: RemoteObject;
}

export interface CallFunctionOnResult {
  result: RemoteObject;
  exceptionDetails?: ExceptionDetails;
}

// --- Accessibility domain ---

export interface AXValue {
  type: string;
  value?: unknown;
}

export interface AXProperty {
  name: string;
  value: AXValue;
}

export interface AXNode {
  nodeId: string;
  ignored: boolean;
  ignoredReasons?: AXValue[];
  role?: AXValue;
  name?: AXValue;
  description?: AXValue;
  value?: AXValue;
  properties?: AXProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
  parentId?: string;
}

export interface GetFullAXTreeResult {
  nodes: AXNode[];
}

// --- Input domain ---

export interface DispatchMouseEventParams {
  type: "mousePressed" | "mouseReleased" | "mouseMoved";
  x: number;
  y: number;
  button?: "left" | "middle" | "right";
  clickCount?: number;
  buttons?: number;
}

export interface DispatchKeyEventParams {
  type: "keyDown" | "keyUp" | "rawKeyDown" | "char";
  key?: string;
  text?: string;
  code?: string;
}

export interface InsertTextParams {
  text: string;
}

// --- Network domain ---

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  size: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface GetCookiesResult {
  cookies: CdpCookie[];
}

export interface SetCookieParams {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  expires?: number;
}

// --- Target domain ---

export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

export interface CreateTargetResult {
  targetId: string;
}

export interface AttachToTargetResult {
  sessionId: string;
}

// --- Console / Runtime events ---

export interface ConsoleAPICalledEvent {
  type: "log" | "debug" | "info" | "error" | "warning" | "dir" | "table" | "trace" | "clear" | "assert";
  args: RemoteObject[];
  timestamp: number;
}

export interface ExceptionThrownEvent {
  timestamp: number;
  exceptionDetails: ExceptionDetails;
}

// --- Dialog ---

export interface JavaScriptDialogOpeningEvent {
  url: string;
  message: string;
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  defaultPrompt?: string;
}

// --- Browser launch ---

export interface ChromeLaunchOptions {
  /** Path to Chrome/Chromium executable. Auto-detected if omitted. */
  executablePath?: string;
  /** Run headless. Default: true */
  headless?: boolean;
  /** Extra Chrome flags. */
  args?: string[];
  /** User data directory. Temporary if omitted. */
  userDataDir?: string;
}
