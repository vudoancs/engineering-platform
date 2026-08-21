export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  checkedAt: string;
}

export interface ReadinessStatus {
  status: "ready" | "not_ready";
  checkedAt: string;
  details?: Record<string, unknown>;
}

/**
 * Internal health abstraction for future transports.
 * No HTTP endpoints are exposed in the STDIO foundation.
 */
export class HealthService {
  health(): HealthStatus {
    return {
      status: "ok",
      checkedAt: new Date().toISOString(),
    };
  }

  readiness(details?: Record<string, unknown>): ReadinessStatus {
    return {
      status: "ready",
      checkedAt: new Date().toISOString(),
      ...(details !== undefined ? { details } : {}),
    };
  }
}
