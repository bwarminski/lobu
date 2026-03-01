/**
 * Abstract base file handler with shared JWT token and session tracking logic.
 * Subclasses implement only downloadFile() and uploadFile().
 */

import type { Readable } from "node:stream";
import jwt from "jsonwebtoken";
import type {
  FileMetadata,
  FileUploadOptions,
  FileUploadResult,
  IFileHandler,
} from "./file-handler";

function getJwtSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY required for file token generation");
  }
  return secret;
}

export abstract class BaseFileHandler implements IFileHandler {
  protected readonly jwtSecret: string;
  protected readonly uploadedFiles = new Map<string, Set<string>>();

  constructor() {
    this.jwtSecret = getJwtSecret();
  }

  abstract downloadFile(
    fileId: string
  ): Promise<{ stream: Readable; metadata: FileMetadata }>;

  abstract uploadFile(
    fileStream: Readable,
    options: FileUploadOptions
  ): Promise<FileUploadResult>;

  generateFileToken(
    sessionKey: string,
    fileId: string,
    expiresIn = 3600
  ): string {
    return jwt.sign(
      {
        sessionKey,
        fileId,
        type: "file_access",
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      {
        expiresIn,
        algorithm: "HS256",
        issuer: "lobu-gateway",
        audience: "lobu-worker",
      }
    );
  }

  validateFileToken(token: string): {
    valid: boolean;
    sessionKey?: string;
    fileId?: string;
    error?: string;
  } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ["HS256"],
        issuer: "lobu-gateway",
        audience: "lobu-worker",
      });

      if (
        typeof decoded === "string" ||
        typeof decoded.sessionKey !== "string" ||
        typeof decoded.fileId !== "string" ||
        decoded.type !== "file_access"
      ) {
        return { valid: false, error: "Invalid token structure" };
      }

      return {
        valid: true,
        sessionKey: decoded.sessionKey,
        fileId: decoded.fileId,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return { valid: false, error: "Token expired" };
      }
      return { valid: false, error: "Invalid token" };
    }
  }

  getSessionFiles(sessionKey: string): string[] {
    return Array.from(this.uploadedFiles.get(sessionKey) || []);
  }

  cleanupSession(sessionKey: string): void {
    this.uploadedFiles.delete(sessionKey);
  }

  protected trackUpload(sessionKey: string, fileId: string): void {
    if (!this.uploadedFiles.has(sessionKey)) {
      this.uploadedFiles.set(sessionKey, new Set());
    }
    this.uploadedFiles.get(sessionKey)!.add(fileId);
  }
}
