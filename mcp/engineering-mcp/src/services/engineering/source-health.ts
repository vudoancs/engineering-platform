import type { SourceHealth, SettledSourceResult } from "./engineering.types.js";

export function notConfigured<T = never>(reason = "not configured"): SettledSourceResult<T> {
  return { health: "not_configured", reason };
}

export function unavailable<T = never>(reason: string): SettledSourceResult<T> {
  return { health: "unavailable", reason };
}

export function ok<T>(data: T): SettledSourceResult<T> {
  return { health: "ok", data };
}

export function degraded<T>(data: T, reason: string): SettledSourceResult<T> {
  return { health: "degraded", data, reason };
}

export async function settleSource<T>(
  configured: boolean,
  notConfiguredReason: string,
  run: () => Promise<T>,
): Promise<SettledSourceResult<T>> {
  if (!configured) {
    return notConfigured(notConfiguredReason);
  }
  try {
    const data = await run();
    return ok(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown source error";
    return unavailable(message);
  }
}

export function mergeHealth(...healths: SourceHealth[]): SourceHealth {
  if (healths.includes("unavailable")) {
    return "unavailable";
  }
  if (healths.includes("degraded")) {
    return "degraded";
  }
  if (healths.every((h) => h === "not_configured")) {
    return "not_configured";
  }
  if (healths.includes("not_configured") && healths.includes("ok")) {
    return "degraded";
  }
  return "ok";
}
