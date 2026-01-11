/**
 * File handler interface for platform-specific file operations.
 */

import type { Readable } from "node:stream";

export interface FileMetadata {
  id: string;
  name: string;
  mimetype?: string;
  size: number;
  url: string;
  downloadUrl?: string;
  permalink?: string;
  timestamp?: number;
}

export interface FileUploadResult {
  fileId: string;
  permalink: string;
  name: string;
  size: number;
}

export interface FileUploadOptions {
  filename: string;
  channelId: string;
  threadTs?: string;
  title?: string;
  initialComment?: string;
  sessionKey?: string;
}

export interface IFileHandler {
  downloadFile(
    fileId: string,
    bearerToken: string
  ): Promise<{ stream: Readable; metadata: FileMetadata }>;

  uploadFile(
    fileStream: Readable,
    options: FileUploadOptions
  ): Promise<FileUploadResult>;

  generateFileToken(
    sessionKey: string,
    fileId: string,
    expiresIn?: number
  ): string;

  validateFileToken(token: string): {
    valid: boolean;
    sessionKey?: string;
    fileId?: string;
    error?: string;
  };

  getSessionFiles(sessionKey: string): string[];

  cleanupSession(sessionKey: string): void;
}
