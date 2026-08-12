/**
 * A single error type for anything the client should see.
 *
 * Throwing `ApiError` anywhere in a handler produces a predictable JSON body;
 * everything else that escapes becomes a generic 500 so internal messages and
 * stack traces never reach the browser.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Sign in to continue.') {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have access to that.') {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found.') {
    return new ApiError(404, 'not_found', message);
  }

  static conflict(message: string, details?: unknown) {
    return new ApiError(409, 'conflict', message, details);
  }

  static payloadTooLarge(message: string) {
    return new ApiError(413, 'payload_too_large', message);
  }

  static unprocessable(message: string, details?: unknown) {
    return new ApiError(422, 'unprocessable', message, details);
  }

  static tooManyRequests(message = 'Slow down a moment and try again.') {
    return new ApiError(429, 'rate_limited', message);
  }

  /** The request is well-formed but the account's plan does not allow it. */
  static planLimit(message: string, details?: unknown) {
    return new ApiError(402, 'plan_limit', message, details);
  }

  static internal(message = 'Something went wrong on our side.') {
    return new ApiError(500, 'internal_error', message);
  }

  static serviceUnavailable(message = 'That service is temporarily unavailable.') {
    return new ApiError(503, 'service_unavailable', message);
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
