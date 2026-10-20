import { t } from '../i18n';
/**
 * Typed errors of the AI layer. `message` is always a ready-to-show Russian sentence: the UI prints it
 * as is, and `processCapture` stores it in `Capture.error`. Technical detail (HTTP status, provider text)
 * lives in separate fields and never contains secrets.
 */

export type AiErrorCode =
  | 'no_key'
  | 'bad_key'
  | 'rate_limit'
  | 'offline'
  | 'cors'
  | 'timeout'
  | 'bad_response'
  | 'aborted'
  | 'unsupported'
  | 'provider';

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** HTTP status, when the error came from a response. */
  readonly status?: number;
  /** Whether repeating the same request later can help (the UI offers "повторить"). */
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** No API key is configured for the selected provider. */
export class NoKeyError extends AiError {
  constructor() {
    super('no_key', t('No API key set. Add it in Settings → AI or choose the “via clipboard” mode.'));
  }
}

/** The provider rejected the key (401/403). */
export class BadKeyError extends AiError {
  constructor(status?: number) {
    super('bad_key', t('The provider did not accept the API key. Check the key and the API address in Settings → AI.'), { status });
  }
}

export class RateLimitError extends AiError {
  /** Pause requested by the provider (`Retry-After`), in milliseconds. */
  readonly retryAfterMs?: number;

  constructor(retryAfterMs?: number, status = 429) {
    const wait = retryAfterMs === undefined ? '' : t(' You can retry in about {max} s.', { max: Math.max(1, Math.ceil(retryAfterMs / 1000)) });
    super('rate_limit', t("The provider's request limit was exceeded.{wait} Wait a little and retry.", { wait }), {
      status,
      retryable: true,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class OfflineError extends AiError {
  constructor(cause?: unknown) {
    super('offline', t('No internet connection. The record is saved — retry processing when the network is back.'), {
      retryable: true,
      cause,
    });
  }
}

/** A network-level failure while the browser is online: in practice a CORS block, a wrong host or a blocked request. */
export class CorsError extends AiError {
  constructor(cause?: unknown) {
    super(
      'cors',
      t('Could not reach the provider: the browser blocked the request (CORS) or the API address is wrong. Check the address in Settings → AI.'),
      { retryable: true, cause },
    );
  }
}

export class TimeoutError extends AiError {
  constructor(seconds?: number) {
    const after = seconds === undefined ? '' : t(' ({round} s)', { round: Math.round(seconds) });
    super('timeout', t('The provider is taking too long to respond{after}. Try again.', { after }), { retryable: true });
  }
}

/** The model answered, but not with something usable (not JSON, wrong shape, empty). */
export class BadResponseError extends AiError {
  /** Technical detail for logs and the repair request; not meant for the user. */
  readonly detail: string;

  constructor(detail: string) {
    super('bad_response', t('The model returned an answer that could not be parsed. Try again or choose another model.'), {
      retryable: true,
    });
    this.detail = detail;
  }
}

export class AbortedError extends AiError {
  constructor() {
    super('aborted', t('Request cancelled.'));
  }
}

/** The requested capability does not exist in this provider or browser. */
export class UnsupportedError extends AiError {
  constructor(message: string) {
    super('unsupported', message);
  }
}

/** Any other error status: 4xx with the provider's own explanation, 5xx once retries are used up. */
export class ProviderError extends AiError {
  /** The provider's text, redacted and shortened. */
  readonly providerMessage?: string;

  constructor(status: number, providerMessage?: string) {
    const detail = providerMessage ? `: ${providerMessage}` : '';
    super('provider', t('The provider returned an error {status}{detail}', { status, detail }), { status, retryable: status >= 500 || status === 408 });
    this.providerMessage = providerMessage;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

export function isAbortedError(error: unknown): boolean {
  return error instanceof AbortedError;
}

/** Message safe to store in `Capture.error` and show to the user, for any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof AiError) return error.message;
  if (error instanceof Error && error.message !== '') return t('Could not process the record: {message}', { message: error.message });
  return t('Could not process the recording');
}
