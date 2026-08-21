export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  /** Write to stderr by default so STDIO stdout remains MCP protocol-only. */
  sink?: (line: string) => void;
}

export interface ToolInvocationLog {
  requestId: string;
  toolName: string;
  projectId?: string;
  startTime: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Minimal structured logger.
 * Never log tokens, credentials, authorization headers, passwords, or secrets.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly sink: (line: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.sink = options.sink ?? ((line) => process.stderr.write(`${line}\n`));
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write("error", message, fields);
  }

  logToolInvocation(entry: ToolInvocationLog): void {
    this.info("tool_invocation", {
      requestId: entry.requestId,
      toolName: entry.toolName,
      ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
      startTime: entry.startTime,
      durationMs: entry.durationMs,
      success: entry.success,
      ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
    });
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(fields ?? {}),
    };

    this.sink(JSON.stringify(payload));
  }
}
