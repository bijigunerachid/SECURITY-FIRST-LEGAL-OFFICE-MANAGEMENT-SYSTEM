import type { DocumentDetail, DocumentSummary, DocumentVersion } from "@lexora/shared";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { HttpError, notFound, rateLimited } from "../../http/errors.js";
import type { Database } from "../../lib/database.js";
import { recordAudit, type AuditEventInput } from "../audit/audit-log.js";
import type { RequestContext } from "../auth/auth-service.js";
import { RATE_RULES, type RateLimiter } from "../auth/rate-limit.js";
import { authorizeMatter } from "../matters/matter-access.js";
import type { Actor } from "../policy/matter-policy.js";
import { ScannerUnavailableError, type MalwareScanner } from "./clamd.js";
import { cleanFileName } from "./file-name.js";
import { detectFileType, type DetectedType } from "./file-type.js";
import { UploadTooLargeError, type DocumentStorage } from "./storage.js";

export interface UploadInput {
  body: Readable;
  /** Content-Length, when the client sent one. */
  declaredLength: number | null;
  /** The name the user's computer gave the file. Untrusted. */
  rawFileName: string;
}

export interface Download {
  stream: Readable;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

interface CheckedFile {
  storageKey: string;
  fileName: string;
  type: DetectedType;
  sizeBytes: number;
  sha256: Buffer;
  scannedWith: string;
}

const tooLarge = () => new HttpError(413, "payload_too_large");
const unsupported = () => new HttpError(415, "unsupported_file_type");
const infected = () => new HttpError(422, "malware_detected");
const scannerDown = () => new HttpError(503, "scan_unavailable");

const versionSelect = {
  number: true,
  storageKey: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  createdAt: true,
  uploadedBy: { select: { id: true, displayName: true } },
} as const;

interface VersionRow {
  number: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: Uint8Array;
  createdAt: Date;
  uploadedBy: { id: string; displayName: string };
}

function toVersion(row: VersionRow): DocumentVersion {
  return {
    number: row.number,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: Buffer.from(row.sha256).toString("hex"),
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Matter documents (ADR 0004). Access comes from the matter: anyone who can
 * read the matter can list and download its documents; team members upload
 * and add versions; lawyers on the team hide (delete) them. Break-glass
 * access is read-only. Every action is audited, never with file names
 * (they often contain client names).
 */
export class DocumentService {
  constructor(
    private readonly db: Database,
    private readonly storage: DocumentStorage,
    private readonly scanner: MalwareScanner,
    private readonly limiter: RateLimiter,
    private readonly settings: { maxUploadBytes: number },
  ) {}

  private audit(event: AuditEventInput, ctx: RequestContext): Promise<void> {
    return recordAudit(this.db, { ...event, requestId: ctx.requestId, ipAddress: ctx.ipAddress });
  }

  /** A visible (not hidden) document of this matter, or 404. */
  private async findDocument(matterId: string, documentId: string) {
    const document = await this.db.document.findFirst({
      where: { id: documentId, matterId, deletedAt: null },
      select: { id: true },
    });
    if (!document) throw notFound();
    return document;
  }

  // --- Reading -------------------------------------------------------------------

  async list(actor: Actor, matterId: string, ctx: RequestContext): Promise<DocumentSummary[]> {
    await authorizeMatter(this.db, actor, matterId, "read", ctx);
    const rows = await this.db.document.findMany({
      where: { matterId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        versions: { orderBy: { number: "desc" }, take: 1, select: versionSelect },
        _count: { select: { versions: true } },
      },
    });
    return rows.flatMap((row) => {
      const latest = row.versions[0];
      if (!latest) return [];
      return [
        {
          id: row.id,
          title: row.title,
          latest: toVersion(latest),
          versionCount: row._count.versions,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
      ];
    });
  }

  async get(
    actor: Actor,
    matterId: string,
    documentId: string,
    ctx: RequestContext,
  ): Promise<DocumentDetail> {
    await authorizeMatter(this.db, actor, matterId, "read", ctx);
    const row = await this.db.document.findFirst({
      where: { id: documentId, matterId, deletedAt: null },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        versions: { orderBy: { number: "desc" }, select: versionSelect },
      },
    });
    const latest = row?.versions[0];
    if (!row || !latest) throw notFound();
    const versions = row.versions.map(toVersion);
    return {
      id: row.id,
      title: row.title,
      latest: toVersion(latest),
      versionCount: versions.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      versions,
    };
  }

  /**
   * Opens a stored version for download. The bytes are checked against the
   * SHA-256 recorded at upload while they are sent; on a mismatch the
   * transfer is broken off and the event audited, so a damaged or altered
   * file is never delivered as if it were intact.
   */
  async download(
    actor: Actor,
    matterId: string,
    documentId: string,
    versionNumber: number | undefined,
    ctx: RequestContext,
  ): Promise<Download> {
    const { access } = await authorizeMatter(this.db, actor, matterId, "read", ctx);
    await this.findDocument(matterId, documentId);
    const version = await this.db.documentVersion.findFirst({
      where: { documentId, ...(versionNumber === undefined ? {} : { number: versionNumber }) },
      orderBy: { number: "desc" },
      select: {
        number: true,
        storageKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
      },
    });
    if (!version) throw notFound();

    const integrityFailure = (detail: string) =>
      this.audit(
        {
          action: "document.integrity",
          outcome: "failure",
          actorUserId: actor.id,
          targetType: "document",
          targetId: documentId,
          metadata: { version: version.number, detail },
        },
        ctx,
      );
    let storedSize: number;
    try {
      storedSize = await this.storage.size(version.storageKey);
    } catch {
      await integrityFailure("missing");
      throw new HttpError(500, "internal_error");
    }
    if (storedSize !== version.sizeBytes) {
      await integrityFailure("size");
      throw new HttpError(500, "internal_error");
    }

    await this.audit(
      {
        action: "document.download",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "document",
        targetId: documentId,
        metadata: {
          matterId,
          version: version.number,
          ...(access.kind === "break_glass" ? { breakGlass: true } : {}),
        },
      },
      ctx,
    );

    const expected = Buffer.from(version.sha256);
    const hash = createHash("sha256");
    // The last chunk is held back until the hash has been checked. On a
    // mismatch it is never sent, so the client receives fewer bytes than
    // Content-Length announced and treats the download as failed.
    let held: Buffer | null = null;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        const previous = held;
        held = chunk;
        callback(null, previous ?? undefined);
      },
      flush: (callback) => {
        if (hash.digest().equals(expected)) {
          callback(null, held ?? undefined);
          return;
        }
        void integrityFailure("hash").finally(() => {
          callback(new Error("stored file does not match its recorded hash"));
        });
      },
    });
    const source = this.storage.read(version.storageKey);
    source.on("error", (error) => verifier.destroy(error));
    return {
      stream: source.pipe(verifier),
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
    };
  }

  // --- Writing -------------------------------------------------------------------

  /**
   * Receives an upload into quarantine and runs every check. Only a file that
   * passes all of them reaches storage; anything else is deleted and the
   * refusal audited.
   */
  private async checkUpload(
    actor: Actor,
    matterId: string,
    input: UploadInput,
    ctx: RequestContext,
  ): Promise<CheckedFile> {
    const rate = await this.limiter.hit(`uploads:user:${actor.id}`, RATE_RULES.uploadsPerUser);
    if (rate.limited) throw rateLimited(rate.retryAfterSeconds);

    const max = this.settings.maxUploadBytes;
    const refuse = async (reason: string, extra: Record<string, unknown> = {}) => {
      await this.audit(
        {
          action: "document.rejected",
          outcome: "denied",
          actorUserId: actor.id,
          targetType: "matter",
          targetId: matterId,
          metadata: { reason, ...extra },
        },
        ctx,
      );
    };

    if (input.declaredLength !== null && input.declaredLength > max) {
      await refuse("too_large", { size: input.declaredLength });
      throw tooLarge();
    }
    let received;
    try {
      received = await this.storage.receive(input.body, max);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        await refuse("too_large");
        throw tooLarge();
      }
      throw error;
    }

    try {
      const detection = await detectFileType(received.path, received.size);
      if (!detection.ok) {
        await refuse(detection.reason, { size: received.size });
        throw unsupported();
      }
      let scannedWith: string;
      let result;
      try {
        scannedWith = await this.scanner.version();
        result = await this.scanner.scanFile(received.path);
      } catch (error) {
        if (error instanceof ScannerUnavailableError) {
          await refuse("scan_unavailable", { size: received.size });
          throw scannerDown();
        }
        throw error;
      }
      if (!result.clean) {
        await refuse("malware", { size: received.size, signature: result.signature });
        throw infected();
      }
      const storageKey = await this.storage.promote(received.path);
      return {
        storageKey,
        fileName: cleanFileName(input.rawFileName, detection.type),
        type: detection.type,
        sizeBytes: received.size,
        sha256: received.sha256,
        scannedWith,
      };
    } finally {
      // Gone already if promoted; otherwise the refused or failed upload is removed here.
      await this.storage.discard(received.path);
    }
  }

  private versionData(file: CheckedFile, actor: Actor) {
    return {
      storageKey: file.storageKey,
      fileName: file.fileName,
      mimeType: file.type.mimeType,
      sizeBytes: file.sizeBytes,
      sha256: new Uint8Array(file.sha256),
      scannedWith: file.scannedWith,
      scannedAt: new Date(),
      uploadedById: actor.id,
    };
  }

  async upload(
    actor: Actor,
    matterId: string,
    input: UploadInput,
    ctx: RequestContext,
  ): Promise<DocumentDetail> {
    // Authorised before a single byte is stored.
    await authorizeMatter(this.db, actor, matterId, "writeDocuments", ctx);
    const file = await this.checkUpload(actor, matterId, input, ctx);
    let documentId: string;
    try {
      const created = await this.db.document.create({
        data: {
          matterId,
          title: file.fileName,
          createdById: actor.id,
          versions: { create: { number: 1, ...this.versionData(file, actor) } },
        },
        select: { id: true },
      });
      documentId = created.id;
    } catch (error) {
      await this.storage.removeStored(file.storageKey);
      throw error;
    }
    await this.audit(
      {
        action: "document.upload",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "document",
        targetId: documentId,
        metadata: { matterId, version: 1, size: file.sizeBytes, type: file.type.kind },
      },
      ctx,
    );
    return this.get(actor, matterId, documentId, ctx);
  }

  /** Adds a new version; earlier versions stay available. */
  async addVersion(
    actor: Actor,
    matterId: string,
    documentId: string,
    input: UploadInput,
    ctx: RequestContext,
  ): Promise<DocumentDetail> {
    await authorizeMatter(this.db, actor, matterId, "writeDocuments", ctx);
    await this.findDocument(matterId, documentId);
    const file = await this.checkUpload(actor, matterId, input, ctx);
    let number: number;
    try {
      number = await this.db.$transaction(async (tx) => {
        // Serialises version numbers for this document.
        await tx.$queryRaw`SELECT id FROM document WHERE id = ${documentId}::uuid FOR NO KEY UPDATE`;
        const last = await tx.documentVersion.findFirst({
          where: { documentId },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const next = (last?.number ?? 0) + 1;
        await tx.documentVersion.create({
          data: { documentId, number: next, ...this.versionData(file, actor) },
        });
        await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
        return next;
      });
    } catch (error) {
      await this.storage.removeStored(file.storageKey);
      throw error;
    }
    await this.audit(
      {
        action: "document.version",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "document",
        targetId: documentId,
        metadata: { matterId, version: number, size: file.sizeBytes, type: file.type.kind },
      },
      ctx,
    );
    return this.get(actor, matterId, documentId, ctx);
  }

  async rename(
    actor: Actor,
    matterId: string,
    documentId: string,
    title: string,
    ctx: RequestContext,
  ): Promise<void> {
    await authorizeMatter(this.db, actor, matterId, "writeDocuments", ctx);
    await this.findDocument(matterId, documentId);
    await this.db.document.update({ where: { id: documentId }, data: { title } });
    await this.audit(
      {
        action: "document.rename",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "document",
        targetId: documentId,
        metadata: { matterId },
      },
      ctx,
    );
  }

  /** Hides a document. Its files stay in storage (legal history; retention comes later). */
  async remove(
    actor: Actor,
    matterId: string,
    documentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    await authorizeMatter(this.db, actor, matterId, "deleteDocuments", ctx);
    await this.findDocument(matterId, documentId);
    await this.db.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), deletedById: actor.id },
    });
    await this.audit(
      {
        action: "document.delete",
        outcome: "success",
        actorUserId: actor.id,
        targetType: "document",
        targetId: documentId,
        metadata: { matterId },
      },
      ctx,
    );
  }
}
