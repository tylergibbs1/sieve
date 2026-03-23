/**
 * Domain policy: structured domain filtering with inspectable state.
 * Agents can query what domains are allowed and get structured errors.
 */

export interface DomainPolicyOptions {
  /** Allowed domain patterns (supports wildcards like "*.example.com"). */
  allowed: string[];
}

export class DomainBlockedError extends Error {
  readonly hostname: string;
  readonly allowedDomains: readonly string[];

  constructor(hostname: string, allowedDomains: readonly string[]) {
    super(`Domain not allowed: ${hostname}. Allowed: ${allowedDomains.join(", ") || "(none)"}`);
    this.name = "DomainBlockedError";
    this.hostname = hostname;
    this.allowedDomains = allowedDomains;
  }
}

export class DomainPolicy {
  private readonly patterns: readonly string[];

  constructor(options: DomainPolicyOptions) {
    this.patterns = [...options.allowed];
  }

  /** Check if a hostname is allowed. */
  isAllowed(hostname: string): boolean {
    if (this.patterns.length === 0) return true;

    return this.patterns.some((pattern) => {
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
      }
      return hostname === pattern;
    });
  }

  /** Check a URL and throw DomainBlockedError if not allowed. */
  check(url: string): void {
    if (this.patterns.length === 0) return;
    const hostname = new URL(url).hostname;
    if (!this.isAllowed(hostname)) {
      throw new DomainBlockedError(hostname, this.patterns);
    }
  }

  /** Get the list of allowed domain patterns. */
  get allowedPatterns(): readonly string[] {
    return this.patterns;
  }

  /** Whether this policy restricts any domains. */
  get isRestricted(): boolean {
    return this.patterns.length > 0;
  }
}
