/**
 * Base error class for all peerbot errors
 */
export abstract class BaseError extends Error {
  abstract readonly name: string;

  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message);
    
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Get the full error chain as a string
   */
  getFullMessage(): string {
    let message = `${this.name}: ${this.message}`;
    if (this.cause) {
      if (this.cause instanceof BaseError) {
        message += `\nCaused by: ${this.cause.getFullMessage()}`;
      } else {
        message += `\nCaused by: ${this.cause.message}`;
      }
    }
    return message;
  }

  /**
   * Convert error to JSON for logging/serialization
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      cause: this.cause instanceof BaseError ? this.cause.toJSON() : this.cause?.message,
      stack: this.stack
    };
  }
}