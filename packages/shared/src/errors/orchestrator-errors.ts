import { BaseError } from "./base-error";

// ErrorCode enum from orchestrator package
export enum ErrorCode {
  DATABASE_CONNECTION_FAILED = "DATABASE_CONNECTION_FAILED",
  KUBERNETES_API_ERROR = "KUBERNETES_API_ERROR",
  DEPLOYMENT_SCALE_FAILED = "DEPLOYMENT_SCALE_FAILED",
  DEPLOYMENT_CREATE_FAILED = "DEPLOYMENT_CREATE_FAILED",
  DEPLOYMENT_DELETE_FAILED = "DEPLOYMENT_DELETE_FAILED",
  QUEUE_JOB_PROCESSING_FAILED = "QUEUE_JOB_PROCESSING_FAILED",
  USER_CREDENTIALS_CREATE_FAILED = "USER_CREDENTIALS_CREATE_FAILED",
  SECRET_CREATE_FAILED = "SECRET_CREATE_FAILED",
  PVC_CREATE_FAILED = "PVC_CREATE_FAILED",
  INVALID_CONFIGURATION = "INVALID_CONFIGURATION",
  THREAD_DEPLOYMENT_NOT_FOUND = "THREAD_DEPLOYMENT_NOT_FOUND",
  USER_QUEUE_NOT_FOUND = "USER_QUEUE_NOT_FOUND",
}

/**
 * Error class for orchestrator-related operations
 */
export class OrchestratorError extends BaseError {
  readonly name = "OrchestratorError";

  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any,
    public shouldRetry: boolean = false,
    cause?: Error
  ) {
    super(message, cause);
  }

  static fromDatabaseError(error: any): OrchestratorError {
    return new OrchestratorError(
      ErrorCode.DATABASE_CONNECTION_FAILED,
      `Database error: ${error instanceof Error ? error.message : String(error)}`,
      { code: error.code, detail: error.detail },
      true,
      error
    );
  }

  static fromKubernetesError(error: any): OrchestratorError {
    return new OrchestratorError(
      ErrorCode.KUBERNETES_API_ERROR,
      `Kubernetes operation failed: ${error.message}`,
      error,
      true,
      error
    );
  }

  toJSON(): Record<string, any> {
    return {
      ...super.toJSON(),
      code: this.code,
      details: this.details,
      shouldRetry: this.shouldRetry
    };
  }
}