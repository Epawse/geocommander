/**
 * Logger utility with log levels
 *
 * Provides consistent logging across the application with:
 * - Log level filtering (DEBUG only in development)
 * - Structured output format
 * - Easy integration with external logging services
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
  timestamp: string;
}

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '#8b5cf6', // purple
  info: '#3b82f6',  // blue
  warn: '#f59e0b',  // amber
  error: '#ef4444', // red
};

class Logger {
  private isDev = import.meta.env.DEV;
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 100;

  private formatMessage(level: LogLevel, module: string, message: string, data?: unknown): LogEntry {
    return {
      level,
      module,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  private log(level: LogLevel, module: string, message: string, data?: unknown): void {
    const entry = this.formatMessage(level, module, message, data);

    // Store in history
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Skip debug logs in production
    if (level === 'debug' && !this.isDev) {
      return;
    }

    const color = LOG_COLORS[level];
    const prefix = `%c[${module}]`;
    const style = `color: ${color}; font-weight: bold;`;

    switch (level) {
      case 'debug':
        console.debug(prefix, style, message, data ?? '');
        break;
      case 'info':
        console.info(prefix, style, message, data ?? '');
        break;
      case 'warn':
        console.warn(prefix, style, message, data ?? '');
        break;
      case 'error':
        console.error(prefix, style, message, data ?? '');
        break;
    }
  }

  debug(module: string, message: string, data?: unknown): void {
    this.log('debug', module, message, data);
  }

  info(module: string, message: string, data?: unknown): void {
    this.log('info', module, message, data);
  }

  warn(module: string, message: string, data?: unknown): void {
    this.log('warn', module, message, data);
  }

  error(module: string, message: string, data?: unknown): void {
    this.log('error', module, message, data);
  }

  /**
   * Get recent log entries (useful for debugging/error reporting)
   */
  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Create a scoped logger for a specific module
   */
  scope(module: string): ScopedLogger {
    return new ScopedLogger(this, module);
  }
}

class ScopedLogger {
  constructor(private logger: Logger, private module: string) {}

  debug(message: string, data?: unknown): void {
    this.logger.debug(this.module, message, data);
  }

  info(message: string, data?: unknown): void {
    this.logger.info(this.module, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.logger.warn(this.module, message, data);
  }

  error(message: string, data?: unknown): void {
    this.logger.error(this.module, message, data);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export scoped loggers for common modules
export const appLogger = logger.scope('App');
export const wsLogger = logger.scope('WebSocket');
export const mcpLogger = logger.scope('MCP');
export const cesiumLogger = logger.scope('Cesium');

export default logger;
