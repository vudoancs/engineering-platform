import {
  ConfluenceAuthenticationError,
  ConfluenceError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceTimeoutError,
  ConfluenceUnavailableError,
  ConfluenceValidationError,
} from "./confluence.errors.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ConfluenceClientOptions {
  /** Site base URL, e.g. https://example.atlassian.net (optional trailing /wiki). */
  baseUrl: string;
  email: string;
  apiToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchLike;
}

export interface ConfluenceRequestOptions {
  method?: "GET";
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
}

/**
 * Low-level Confluence Cloud HTTP client (READ-ONLY).
 * Uses Basic auth (email + API token). Never logs credentials.
 *
 * Endpoints use Confluence Cloud REST API under /wiki/rest/api/.
 */
export class ConfluenceClient {
  private readonly siteBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: ConfluenceClientOptions) {
    const normalized = normalizeConfluenceBaseUrl(options.baseUrl);
    this.siteBaseUrl = normalized.siteBaseUrl;
    this.apiBaseUrl = normalized.apiBaseUrl;
    this.authHeader = `Basic ${Buffer.from(`${options.email}:${options.apiToken}`, "utf8").toString("base64")}`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Site origin without /wiki — used for building browse URLs. */
  getSiteBaseUrl(): string {
    return this.siteBaseUrl;
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, {
      method: "GET",
      ...(query !== undefined ? { query } : {}),
    });
  }

  async request<T>(path: string, options: ConfluenceRequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path, options.query);
    let attempt = 0;

    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            Accept: "application/json",
            Authorization: this.authHeader,
          },
          signal: controller.signal,
        });

        if (response.ok) {
          if (response.status === 204) {
            return undefined as T;
          }
          return (await response.json()) as T;
        }

        const error = await this.toError(response);
        if (!this.shouldRetry(error) || attempt > this.maxRetries) {
          throw error;
        }

        await this.delay(this.backoffMs(attempt, error));
      } catch (error) {
        if (error instanceof ConfluenceError) {
          if (!this.shouldRetry(error) || attempt > this.maxRetries) {
            throw error;
          }
          await this.delay(this.backoffMs(attempt, error));
          continue;
        }

        if (isAbortError(error)) {
          const timeoutError = new ConfluenceTimeoutError("Confluence request timed out", {
            details: { path, timeoutMs },
          });
          if (attempt > this.maxRetries) {
            throw timeoutError;
          }
          await this.delay(this.backoffMs(attempt, timeoutError));
          continue;
        }

        const unavailable = new ConfluenceUnavailableError("Confluence network request failed", {
          cause: error,
          details: { path },
        });
        if (attempt > this.maxRetries) {
          throw unavailable;
        }
        await this.delay(this.backoffMs(attempt, unavailable));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    // Paths are relative to /wiki (apiBaseUrl already includes /wiki)
    const url = new URL(`${this.apiBaseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async toError(response: Response): Promise<ConfluenceError> {
    const status = response.status;
    const safeMessage = await this.readSafeErrorMessage(response);

    if (status === 401 || status === 403) {
      return new ConfluenceAuthenticationError(
        "Confluence authentication or authorization failed",
        { status },
      );
    }

    if (status === 404) {
      return new ConfluenceNotFoundError(safeMessage || "Confluence resource not found", {
        status,
      });
    }

    if (status === 400 || status === 422) {
      return new ConfluenceValidationError(
        safeMessage || "Confluence rejected the request",
        { status },
      );
    }

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      return new ConfluenceRateLimitError("Confluence rate limit exceeded", {
        status,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }

    if (status === 502 || status === 503 || status === 504) {
      return new ConfluenceUnavailableError(
        safeMessage || "Confluence is temporarily unavailable",
        { status, retryable: true },
      );
    }

    return new ConfluenceError(
      safeMessage || `Confluence request failed with status ${status}`,
      { status, retryable: status >= 500 },
    );
  }

  private async readSafeErrorMessage(response: Response): Promise<string> {
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body: unknown = await response.json();
        if (typeof body === "object" && body !== null) {
          const record = body as Record<string, unknown>;
          if (typeof record.message === "string") {
            return sanitizeErrorText(record.message);
          }
          if (typeof record.errorMessage === "string") {
            return sanitizeErrorText(record.errorMessage);
          }
          if (Array.isArray(record.message)) {
            return record.message.map(String).join("; ");
          }
        }
      }
      const text = await response.text();
      return sanitizeErrorText(text).slice(0, 300);
    } catch {
      return "";
    }
  }

  private shouldRetry(error: ConfluenceError): boolean {
    if (error instanceof ConfluenceRateLimitError) {
      return true;
    }
    if (error instanceof ConfluenceUnavailableError || error instanceof ConfluenceTimeoutError) {
      return true;
    }
    return (
      error.retryable &&
      (error.status === 502 || error.status === 503 || error.status === 504)
    );
  }

  private backoffMs(attempt: number, error: ConfluenceError): number {
    if (error instanceof ConfluenceRateLimitError && error.retryAfterMs !== undefined) {
      return error.retryAfterMs;
    }
    const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function normalizeConfluenceBaseUrl(baseUrl: string): {
  siteBaseUrl: string;
  apiBaseUrl: string;
} {
  let trimmed = baseUrl.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/wiki")) {
    trimmed = trimmed.slice(0, -"/wiki".length);
  }
  return {
    siteBaseUrl: trimmed,
    apiBaseUrl: `${trimmed}/wiki`,
  };
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const asNumber = Number(header);
  if (!Number.isNaN(asNumber) && asNumber >= 0) {
    return Math.floor(asNumber * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}

function sanitizeErrorText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/Basic\s+\S+/gi, "[redacted]")
    .replace(/api[_-]?token["']?\s*[:=]\s*["']?[\w-]+/gi, "api_token=[redacted]");
}
