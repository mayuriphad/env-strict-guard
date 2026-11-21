import * as fs from 'node:fs';
import * as path from 'node:path';

export interface EnvRule {
  key: string;
  exampleValue: string;
  /** False when the example line ends with a `# optional` comment. */
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'url';
}

export interface ValidationIssue {
  key: string;
  issue: 'missing' | 'type_mismatch' | 'empty';
  expectedType?: string;
  message: string;
}

export interface ValidateEnvOptions {
  /** Path to the example/template env file. Defaults to auto-detecting .env.example, .env.template or .env.sample */
  examplePath?: string;
  /** Environment dictionary to validate against. Defaults to process.env */
  env?: Record<string, string | undefined>;
  /** Accept variables that are set but empty. Default: false */
  allowEmpty?: boolean;
}

interface ParsedLine {
  key: string;
  value: string;
  comment: string;
}

const OPTIONAL_MARKER = /^optional\b/i;

/**
 * Parses one `KEY=value` line of an env file. Returns undefined for blank lines and comments.
 *
 * Handles a leading `export `, single- or double-quoted values, and a trailing `# comment`
 * after an unquoted value (a `#` only starts a comment when whitespace precedes it).
 */
function parseLine(line: string): ParsedLine | undefined {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  if (trimmed.startsWith('export ')) trimmed = trimmed.slice('export '.length).trim();

  const equalIndex = trimmed.indexOf('=');
  if (equalIndex === -1) {
    // A bare key: split off a trailing comment the same way as for values
    const [key, ...rest] = trimmed.split(/\s+#/);
    return { key: key.trim(), value: '', comment: rest.join('#').trim() };
  }

  const key = trimmed.slice(0, equalIndex).trim();
  const rawRest = trimmed.slice(equalIndex + 1);
  const rest = rawRest.trim();

  // `KEY= # comment`: an empty value followed by a comment
  if (rest.startsWith('#') && /^\s/.test(rawRest)) {
    return { key, value: '', comment: rest.slice(1).trim() };
  }

  const quote = rest[0];
  if (quote === '"' || quote === "'") {
    const close = rest.indexOf(quote, 1);
    if (close !== -1) {
      const after = rest.slice(close + 1).trim();
      return {
        key,
        value: rest.slice(1, close),
        comment: after.startsWith('#') ? after.slice(1).trim() : '',
      };
    }
  }

  const commentMatch = /\s#/.exec(rest);
  if (commentMatch) {
    return {
      key,
      value: rest.slice(0, commentMatch.index).trim(),
      comment: rest.slice(commentMatch.index + 2).trim(),
    };
  }
  return { key, value: rest, comment: '' };
}

/**
 * Infers expected type from the example value.
 *
 * Only `true`/`false` count as booleans: an example such as `WORKERS=1` is a number.
 */
function inferType(value: string): EnvRule['type'] {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return 'url';
  return 'string';
}

/**
 * Parses an env-formatted string into structured rules.
 *
 * A variable is required unless its line ends with a `# optional` comment, e.g.
 * `SENTRY_DSN= # optional`.
 */
export function parseEnvExample(content: string): EnvRule[] {
  const rules: EnvRule[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed || !parsed.key) continue;
    rules.push({
      key: parsed.key,
      exampleValue: parsed.value,
      required: !OPTIONAL_MARKER.test(parsed.comment),
      type: inferType(parsed.value),
    });
  }
  return rules;
}

/**
 * Parses the contents of a `.env` file into a key/value dictionary.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed && parsed.key) values[parsed.key] = parsed.value;
  }
  return values;
}

/**
 * Reads a `.env` file and copies its values into `env` (process.env by default).
 * Variables already set in `env` are kept, as with dotenv. Returns false when the file
 * does not exist.
 */
export function loadEnvFile(
  envPath: string = path.resolve(process.cwd(), '.env'),
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!fs.existsSync(envPath)) return false;
  const values = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
  for (const [key, value] of Object.entries(values)) {
    if (env[key] === undefined) env[key] = value;
  }
  return true;
}

function isValidNumber(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && Number.isFinite(Number(trimmed));
}

/**
 * Validates a dictionary against an example env template.
 *
 * Messages never include the received values, so a report can be logged without leaking
 * secrets.
 */
export function validateEnv(options: ValidateEnvOptions = {}): {
  valid: boolean;
  issues: ValidationIssue[];
} {
  const env = options.env || process.env;
  let examplePath = options.examplePath;

  if (!examplePath) {
    const candidates = ['.env.example', '.env.template', '.env.sample'];
    for (const c of candidates) {
      const p = path.resolve(process.cwd(), c);
      if (fs.existsSync(p)) {
        examplePath = p;
        break;
      }
    }
  }

  if (!examplePath || !fs.existsSync(examplePath)) {
    return {
      valid: false,
      issues: [
        {
          key: '(config)',
          issue: 'missing',
          message: 'No .env.example or template file could be found to validate against.',
        },
      ],
    };
  }

  const rules = parseEnvExample(fs.readFileSync(examplePath, 'utf-8'));
  const issues: ValidationIssue[] = [];

  for (const rule of rules) {
    const actual = env[rule.key];

    if (actual === undefined) {
      if (rule.required) {
        issues.push({
          key: rule.key,
          issue: 'missing',
          message: `Missing required environment variable '${rule.key}'`,
        });
      }
      continue;
    }

    if (actual.trim() === '') {
      if (rule.required && !options.allowEmpty) {
        issues.push({
          key: rule.key,
          issue: 'empty',
          message: `Environment variable '${rule.key}' is present but empty.`,
        });
      }
      continue;
    }

    if (rule.type === 'number' && !isValidNumber(actual)) {
      issues.push({
        key: rule.key,
        issue: 'type_mismatch',
        expectedType: 'number',
        message: `Expected '${rule.key}' to be a number (example: '${rule.exampleValue}')`,
      });
    } else if (rule.type === 'boolean' && !/^(true|false)$/i.test(actual.trim())) {
      issues.push({
        key: rule.key,
        issue: 'type_mismatch',
        expectedType: 'boolean',
        message: `Expected '${rule.key}' to be a boolean ('true' or 'false')`,
      });
    } else if (rule.type === 'url') {
      try {
        new URL(actual.trim());
      } catch {
        issues.push({
          key: rule.key,
          issue: 'type_mismatch',
          expectedType: 'url',
          message: `Expected '${rule.key}' to be a valid URL`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Formats validation issues into a high-visibility terminal report.
 */
export function formatIssues(issues: ValidationIssue[]): string {
  const red = '\x1b[31m';
  const yellow = '\x1b[33m';
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';

  const lines = [
    `\n${bold}${red}[ENV-STRICT-GUARD] Missing or Invalid Environment Configuration!${reset}`,
    `${yellow}Your environment does not satisfy requirements defined in .env.example:${reset}\n`,
  ];

  for (const item of issues) {
    lines.push(`  • ${bold}${item.key}${reset}: ${item.message}`);
  }

  lines.push(`\n${red}Please set these variables in your .env or deployment platform before launching.${reset}\n`);
  return lines.join('\n');
}

/**
 * Asserts valid environment; logs formatted issues and throws an error if invalid.
 */
export function assertEnv(options?: ValidateEnvOptions): void {
  const result = validateEnv(options);
  if (!result.valid) {
    const report = formatIssues(result.issues);
    console.error(report);
    throw new Error(`Environment validation failed with ${result.issues.length} issue(s).`);
  }
}

export default assertEnv;
