import {
  GitHubAuthenticationError,
  GitHubError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubUnavailableError,
  GitHubValidationError,
} from "./github.errors.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface GitHubClientOptions {
  token: string;
  apiUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchLike;
}

export interface GitHubRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  accept?: string;
}

/**
 * Low-level GitHub REST API client.
 * Uses Bearer token auth. Never logs credentials.
 */
export class GitHubClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: GitHubClientOptions) {
    this.baseUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.authHeader = `Bearer ${options.token}`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getApiBaseUrl(): string {
    return this.baseUrl;
  }

  async get<T>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    options?: Omit<GitHubRequestOptions, "method" | "query" | "body">,
  ): Promise<T> {
    return this.request<T>(path, {
      method: "GET",
      ...(query !== undefined ? { query } : {}),
      ...(options ?? {}),
    });
  }

  async request<T>(path: string, options: GitHubRequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path, options.query);
    let attempt = 0;

    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const init: RequestInit = {
          method,
          headers: {
            Accept: options.accept ?? "application/vnd.github+json",
            Authorization: this.authHeader,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "engineering-mcp",
            ...(options.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          signal: controller.signal,
        };
        if (options.body !== undefined) {
          init.body = JSON.stringify(options.body);
        }

        const response = await this.fetchImpl(url, init);

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
        if (error instanceof GitHubError) {
          if (!this.shouldRetry(error) || attempt > this.maxRetries) {
            throw error;
          }
          await this.delay(this.backoffMs(attempt, error));
          continue;
        }

        if (isAbortError(error)) {
          const timeoutError = new GitHubTimeoutError("GitHub request timed out", {
            details: { path, timeoutMs },
          });
          if (attempt > this.maxRetries) {
            throw timeoutError;
          }
          await this.delay(this.backoffMs(attempt, timeoutError));
          continue;
        }

        const unavailable = new GitHubUnavailableError("GitHub network request failed", {
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
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async toError(response: Response): Promise<GitHubError> {
    const status = response.status;
    const safeMessage = await this.readSafeErrorMessage(response);
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");

    if (status === 401) {
      return new GitHubAuthenticationError("GitHub authentication failed", { status });
    }

    if (status === 403) {
      if (remaining === "0" || /rate limit/i.test(safeMessage)) {
        const resetAt =
          reset && !Number.isNaN(Number(reset))
            ? new Date(Number(reset) * 1000).toISOString()
            : undefined;
        return new GitHubRateLimitError("GitHub rate limit exceeded", {
          status,
          ...(resetAt !== undefined ? { resetAt } : {}),
        });
      }
      return new GitHubAuthenticationError(
        safeMessage || "GitHub authorization failed",
        { status },
      );
    }

    if (status === 404) {
      return new GitHubNotFoundError(safeMessage || "GitHub resource not found", { status });
    }

    if (status === 400 || status === 422) {
      return new GitHubValidationError(safeMessage || "GitHub rejected the request", {
        status,
      });
    }

    if (status === 429) {
      const resetAt =
        reset && !Number.isNaN(Number(reset))
          ? new Date(Number(reset) * 1000).toISOString()
          : undefined;
      return new GitHubRateLimitError("GitHub rate limit exceeded", {
        status,
        ...(resetAt !== undefined ? { resetAt } : {}),
      });
    }

    if (status === 502 || status === 503 || status === 504) {
      return new GitHubUnavailableError(
        safeMessage || "GitHub is temporarily unavailable",
        { status, retryable: true },
      );
    }

    return new GitHubError(safeMessage || `GitHub request failed with status ${status}`, {
      status,
      retryable: status >= 500,
    });
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
        }
      }
      const text = await response.text();
      return sanitizeErrorText(text).slice(0, 300);
    } catch {
      return "";
    }
  }

  private shouldRetry(error: GitHubError): boolean {
    if (error instanceof GitHubRateLimitError) {
      return true;
    }
    if (error instanceof GitHubUnavailableError || error instanceof GitHubTimeoutError) {
      return true;
    }
    return error.retryable && (error.status === 502 || error.status === 503 || error.status === 504);
  }

  private backoffMs(attempt: number, error: GitHubError): number {
    if (error instanceof GitHubRateLimitError && error.resetAt) {
      const wait = Date.parse(error.resetAt) - Date.now();
      if (wait > 0 && wait < 60_000) {
        return wait;
      }
    }
    const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
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
    .replace(/token["']?\s*[:=]\s*["']?[\w-]+/gi, "token=[redacted]");
}
