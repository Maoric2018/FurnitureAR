export class ApiError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
