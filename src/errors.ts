/** Every error type the API can return. Branch on these, never on the message. */
export type SendpositoryErrorType =
  | "validation_error"
  | "authentication_error"
  | "permission_denied"
  | "not_found"
  | "rate_limit_exceeded"
  | "quota_exceeded"
  | "trial_expired"
  | "domain_not_verified"
  | "email_not_verified"
  | "suppressed_recipient"
  | "internal_error"
  | "connection_error"
  | "idempotency_key_reused"
  | "idempotency_in_progress"
  | "idempotency_original_failed"
  | "send_outcome_unknown";

/**
 * Thrown for every non-2xx response, and for network failures.
 *
 * `type` is stable across releases; `message` is written for humans and may be
 * reworded, so switch on the type.
 */
export class SendpositoryError extends Error {
  readonly type: SendpositoryErrorType;
  readonly status: number;
  /** Seconds to wait, present on `rate_limit_exceeded`. */
  readonly retryAfter?: number;

  constructor(opts: {
    type: SendpositoryErrorType;
    message: string;
    status: number;
    retryAfter?: number;
  }) {
    super(opts.message);
    this.name = "SendpositoryError";
    this.type = opts.type;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }

  /**
   * True when trying again could plausibly succeed.
   *
   * For a write, "could succeed" is not "safe": after an `internal_error` or
   * `connection_error` the first attempt may already have happened. Retry a
   * send with the same idempotency key; check the current state before
   * repeating anything else.
   */
  get isRetryable() {
    return (
      this.type === "rate_limit_exceeded" ||
      this.type === "idempotency_in_progress" ||
      this.type === "internal_error" ||
      this.type === "connection_error"
    );
  }

  /**
   * The recipient is suppressed - a bounced or complained address.
   *
   * Usually not a failure to report: the system did the right thing by
   * refusing to send.
   */
  get isSuppressed() {
    return this.type === "suppressed_recipient";
  }
}
