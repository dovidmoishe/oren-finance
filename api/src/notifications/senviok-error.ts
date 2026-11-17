export type SenviokSendFailure = {
  status: number | null;
  message: string;
};

const MAX_ERROR_CHARS = 300;
const FALLBACK = 'senviok send failed';

/**
 * Status plus a short redacted message from a Senviok send failure.
 * `secrets` are removed literally (the recipient and configured key) before
 * pattern redaction, so a value that does not look like a key still cannot
 * land in the log or in notification_jobs.last_error.
 */
export function senviokSendFailure(
  error: unknown,
  secrets: readonly string[] = [],
): SenviokSendFailure {
  const record = asRecord(error);
  const status = httpStatus(record?.status);
  const raw =
    summarize(record?.body) ||
    (typeof record?.message === 'string' ? record.message : '') ||
    FALLBACK;
  return { status, message: redactSendError(raw, secrets) };
}

export function redactSendError(
  value: string,
  secrets: readonly string[] = [],
): string {
  let text = value;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (!shouldStrip(trimmed)) continue;
    text = text.split(trimmed).join('[redacted]');
  }
  text = text
    .replace(/\bbearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsvk_[a-z0-9_-]+/gi, '[redacted]')
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[a-z0-9_-]+/gi, '[redacted]')
    .replace(
      /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/gi,
      '[redacted]',
    )
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['"]?[a-z0-9\-._~+/]{8,}['"]?/gi,
      '[redacted]',
    )
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return FALLBACK;
  if (text.length <= MAX_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_CHARS - 3)}...`;
}

function shouldStrip(secret: string) {
  if (secret.includes('@')) return secret.length >= 6;
  return secret.length >= 8;
}

function httpStatus(status: unknown): number | null {
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function asRecord(error: unknown): {
  status?: unknown;
  body?: unknown;
  message?: unknown;
} | null {
  if (!error || typeof error !== 'object') return null;
  return error;
}

function summarize(body: unknown, depth = 0): string {
  if (body == null || depth > 4) return '';
  if (
    typeof body === 'string' ||
    typeof body === 'number' ||
    typeof body === 'boolean'
  ) {
    return String(body);
  }
  if (Array.isArray(body)) {
    return body
      .map((item) => summarize(item, depth + 1))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const code = ['code', 'type', 'name']
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string');
  const errorCode = typeof record.error === 'string' ? record.error : '';
  const message = [
    'message',
    'detail',
    'title',
    'error_description',
    'description',
  ]
    .map((key) => record[key])
    .find((value): value is string => typeof value === 'string');
  const nested =
    record.error && typeof record.error === 'object'
      ? summarize(record.error, depth + 1)
      : '';
  const errors = record.errors ? summarize(record.errors, depth + 1) : '';
  const parts = [code, errorCode, message, nested, errors].filter(Boolean);
  if (parts.length) return parts.join(': ');
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}
