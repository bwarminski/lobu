/**
 * WhatsApp file handler implementation.
 * Handles media download from incoming messages and upload back to users.
 */

import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createLogger, sanitizeFilename } from "@peerbot/core";
import {
  type AnyMessageContent,
  downloadMediaMessage,
  type WAMessage,
} from "@whiskeysockets/baileys";
import jwt from "jsonwebtoken";
import pino from "pino";

// Silent logger for Baileys download operations
const baileysLogger = pino({ level: "silent" }) as unknown as ReturnType<
  typeof pino
>;

import type {
  FileMetadata,
  FileUploadOptions,
  FileUploadResult,
  IFileHandler,
} from "../platform/file-handler";
import type { BaileysClient } from "./connection/baileys-client";

const logger = createLogger("whatsapp-file-handler");

function getJwtSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY required for file token generation");
  }
  return secret;
}

export interface ExtractedMedia {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * WhatsApp file handler.
 * Stores extracted media in memory for worker download.
 */
export class WhatsAppFileHandler implements IFileHandler {
  private fileStore = new Map<
    string,
    { buffer: Buffer; metadata: FileMetadata }
  >();
  private uploadedFiles = new Map<string, Set<string>>();
  private jwtSecret: string;

  constructor(private client: BaileysClient) {
    this.jwtSecret = getJwtSecret();
  }

  /**
   * Extract media files from a WhatsApp message.
   * Downloads the media and stores it for later retrieval.
   */
  async extractMediaFromMessage(msg: WAMessage): Promise<ExtractedMedia[]> {
    const files: ExtractedMedia[] = [];
    const message = msg.message;
    if (!message) return files;

    // Check for various media types
    const mediaTypes: Array<{
      key: string;
      extension: string;
    }> = [
      { key: "imageMessage", extension: "jpg" },
      { key: "videoMessage", extension: "mp4" },
      { key: "audioMessage", extension: "ogg" },
      { key: "documentMessage", extension: "bin" },
      { key: "stickerMessage", extension: "webp" },
    ];

    for (const { key, extension } of mediaTypes) {
      const mediaContent = (message as any)[key];
      if (!mediaContent) continue;

      try {
        logger.info(
          { messageId: msg.key?.id, mediaType: key },
          "Downloading media from message"
        );

        const buffer = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          {
            logger: baileysLogger as any,
            reuploadRequest: (this.client as any).socket?.updateMediaMessage,
          }
        );

        if (!buffer || !(buffer instanceof Buffer)) {
          logger.warn(
            { messageId: msg.key?.id },
            "Downloaded media is not a buffer"
          );
          continue;
        }

        const fileId = randomUUID();
        const mimeType = mediaContent.mimetype || `application/${extension}`;

        // Get filename from document or generate one
        let fileName: string;
        if (key === "documentMessage" && mediaContent.fileName) {
          fileName = mediaContent.fileName;
        } else {
          const ext = mimeType.split("/")[1]?.split(";")[0] || extension;
          fileName = `${key.replace("Message", "")}_${Date.now()}.${ext}`;
        }

        const metadata: FileMetadata = {
          id: fileId,
          name: fileName,
          mimetype: mimeType,
          size: buffer.length,
          url: `internal://whatsapp/${fileId}`,
        };

        // Store for later retrieval
        this.fileStore.set(fileId, { buffer, metadata });

        files.push({
          id: fileId,
          name: fileName,
          mimetype: mimeType,
          size: buffer.length,
          buffer,
        });

        logger.info(
          { fileId, fileName, mimeType, size: buffer.length },
          "Extracted media from WhatsApp message"
        );

        // Auto-cleanup after 1 hour
        setTimeout(
          () => {
            this.fileStore.delete(fileId);
          },
          60 * 60 * 1000
        );
      } catch (error) {
        logger.error(
          { error: String(error), messageId: msg.key?.id, mediaType: key },
          "Failed to download media from message"
        );
      }
    }

    return files;
  }

  /**
   * Download a file by ID.
   * Returns the file stream and metadata.
   */
  async downloadFile(
    fileId: string,
    _bearerToken: string
  ): Promise<{ stream: Readable; metadata: FileMetadata }> {
    const entry = this.fileStore.get(fileId);
    if (!entry) {
      throw new Error(`File not found: ${fileId}`);
    }

    return {
      stream: Readable.from(entry.buffer),
      metadata: entry.metadata,
    };
  }

  /**
   * Upload a file to WhatsApp.
   * Sends the file as a message to the specified channel.
   */
  async uploadFile(
    fileStream: Readable,
    options: FileUploadOptions
  ): Promise<FileUploadResult> {
    const safeFilename = sanitizeFilename(options.filename);

    // Collect stream into buffer
    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    logger.info(
      {
        filename: safeFilename,
        size: fileBuffer.length,
        channelId: options.channelId,
      },
      "Uploading file to WhatsApp"
    );

    // Determine media type from filename
    const content = this.buildMediaContent(
      fileBuffer,
      safeFilename,
      options.title
    );

    // Send the media message
    const result = await this.client.sendMessage(options.channelId, content);

    const fileId = randomUUID();

    // Track uploaded file
    if (options.sessionKey) {
      if (!this.uploadedFiles.has(options.sessionKey)) {
        this.uploadedFiles.set(options.sessionKey, new Set());
      }
      this.uploadedFiles.get(options.sessionKey)!.add(fileId);
    }

    return {
      fileId,
      permalink: `whatsapp://${options.channelId}/${result.messageId}`,
      name: safeFilename,
      size: fileBuffer.length,
    };
  }

  /**
   * Build the appropriate media content based on file type.
   */
  private buildMediaContent(
    buffer: Buffer,
    filename: string,
    caption?: string
  ): AnyMessageContent {
    const ext = filename.split(".").pop()?.toLowerCase() || "";

    // Image types
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
      return {
        image: buffer,
        caption: caption || filename,
      };
    }

    // Video types
    if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) {
      return {
        video: buffer,
        caption: caption || filename,
      };
    }

    // Audio types
    if (["mp3", "ogg", "wav", "m4a", "opus"].includes(ext)) {
      return {
        audio: buffer,
        ptt: false,
        mimetype: this.getMimeType(ext),
      };
    }

    // Default: send as document
    return {
      document: buffer,
      fileName: filename,
      mimetype: this.getMimeType(ext),
      caption: caption,
    };
  }

  /**
   * Get MIME type from extension.
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      mkv: "video/x-matroska",
      webm: "video/webm",
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      opus: "audio/opus",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      txt: "text/plain",
      json: "application/json",
      csv: "text/csv",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }

  /**
   * Generate a JWT token for file access.
   */
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
        issuer: "peerbot-gateway",
        audience: "peerbot-worker",
      }
    );
  }

  /**
   * Validate a file access token.
   */
  validateFileToken(token: string): {
    valid: boolean;
    sessionKey?: string;
    fileId?: string;
    error?: string;
  } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ["HS256"],
        issuer: "peerbot-gateway",
        audience: "peerbot-worker",
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

  /**
   * Get files uploaded in a session.
   */
  getSessionFiles(sessionKey: string): string[] {
    return Array.from(this.uploadedFiles.get(sessionKey) || []);
  }

  /**
   * Cleanup session data.
   */
  cleanupSession(sessionKey: string): void {
    this.uploadedFiles.delete(sessionKey);
  }

  /**
   * Check if a file exists in the store.
   */
  hasFile(fileId: string): boolean {
    return this.fileStore.has(fileId);
  }

  /**
   * Get raw file buffer (for internal use).
   */
  getFileBuffer(fileId: string): Buffer | null {
    return this.fileStore.get(fileId)?.buffer || null;
  }
}
