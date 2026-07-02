import * as fs from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Key substrings that must never be printed to console or written to run.log verbatim. */
const SECRET_KEY_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/gi,
  /ANTHROPIC_API_KEY\s*=\s*\S+/gi,
  /MISTRAL_API_KEY\s*=\s*\S+/gi,
  /R2_SECRET_ACCESS_KEY\s*=\s*\S+/gi,
  /R2_ACCESS_KEY_ID\s*=\s*\S+/gi,
  /CLOUDFLARE_R2_SECRET_ACCESS_KEY\s*=\s*\S+/gi,
  /CLOUDFLARE_R2_ACCESS_KEY_ID\s*=\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_KEY_PATTERNS) {
    out = out.replace(pattern, (match) => `${match.split('=')[0]}=***REDACTED***`);
  }
  return out;
}

/** Truncates long text for console display; full text still goes to the run folder / log file. */
export function truncateForConsole(text: string, maxLen = 300): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}… [truncated ${text.length - maxLen} more chars — see run folder for full text]`;
}

export function createLogger(logFilePath: string): Logger {
  const write = (level: LogLevel, msg: string) => {
    const safe = redactSecrets(msg);
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${safe}`;
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(line);
    fs.appendFileSync(logFilePath, `${line}\n`, 'utf-8');
  };

  return {
    debug: (msg) => write('debug', msg),
    info: (msg) => write('info', msg),
    warn: (msg) => write('warn', msg),
    error: (msg) => write('error', msg),
  };
}
