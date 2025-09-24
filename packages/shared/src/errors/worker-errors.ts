import { BaseError } from "./base-error";

/**
 * Error class for worker-related operations
 */
export class WorkerError extends BaseError {
  readonly name = "WorkerError";

  constructor(
    public operation: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      operation: this.operation
    };
  }
}

/**
 * Error class for workspace-related operations
 */
export class WorkspaceError extends BaseError {
  readonly name = "WorkspaceError";

  constructor(
    public operation: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      operation: this.operation
    };
  }
}

/**
 * Error class for Slack-related operations
 */
export class SlackError extends BaseError {
  readonly name = "SlackError";

  constructor(
    public operation: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      operation: this.operation
    };
  }
}

/**
 * Error class for session-related operations
 */
export class SessionError extends BaseError {
  readonly name = "SessionError";

  constructor(
    public sessionKey: string,
    public code: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      sessionKey: this.sessionKey,
      code: this.code
    };
  }
}

/**
 * Worker error variant with workerId for core operations
 */
export class CoreWorkerError extends BaseError {
  readonly name = "WorkerError";

  constructor(
    public workerId: string,
    public operation: string,
    message: string,
    cause?: Error
  ) {
    super(message, cause);
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      workerId: this.workerId,
      operation: this.operation
    };
  }
}