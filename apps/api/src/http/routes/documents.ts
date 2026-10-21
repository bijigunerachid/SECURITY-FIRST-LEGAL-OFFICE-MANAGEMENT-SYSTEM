import { FILE_NAME_HEADER, downloadQuerySchema, renameDocumentRequestSchema } from "@lexora/shared";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { DocumentService, UploadInput } from "../../modules/documents/document-service.js";
import { attachmentHeader } from "../../modules/documents/file-name.js";
import type { Actor } from "../../modules/policy/matter-policy.js";
import { HttpError, notFound } from "../errors.js";
import { sessionOf } from "../middleware/auth.js";
import { requestContext } from "./auth.js";

const idSchema = z.uuid();

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

function actorOf(req: Request): Actor {
  const { user } = sessionOf(req);
  return { id: user.id, role: user.role };
}

/** The upload body and its declared name. Refuses anything but a raw file body. */
function uploadInput(req: Request): UploadInput {
  if (!req.is("application/octet-stream")) {
    throw new HttpError(415, "unsupported_media_type");
  }
  const header = req.get(FILE_NAME_HEADER);
  if (header === undefined || header === "" || header.length > 1024) {
    throw new HttpError(400, "validation_failed");
  }
  let rawFileName: string;
  try {
    rawFileName = decodeURIComponent(header);
  } catch {
    throw new HttpError(400, "validation_failed");
  }
  const length = req.get("Content-Length");
  return {
    body: req,
    declaredLength: length === undefined ? null : Number(length),
    rawFileName,
  };
}

/**
 * When an upload is refused before its body was read (no access, too
 * large, wrong type), close the connection rather than receive and discard
 * up to 25 MB the server does not want.
 */
function closeOnError(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!req.complete) res.setHeader("Connection", "close");
      next(error);
    }
  };
}

/**
 * /api/matters/:matterId/documents. Access is decided by the matter (see the
 * policy module); uploads are raw file bodies (`application/octet-stream`)
 * with the name in X-File-Name.
 */
export function documentsRouter(documents: DocumentService): Router {
  const router = Router({ mergeParams: true });
  for (const name of ["matterId", "documentId"]) {
    router.param(name, (_req, _res, next, value: string) => {
      next(idSchema.safeParse(value).success ? undefined : notFound());
    });
  }

  router.get("/", async (req, res) => {
    const list = await documents.list(actorOf(req), param(req, "matterId"), requestContext(req));
    res.json({ documents: list });
  });

  router.post(
    "/",
    closeOnError(async (req, res) => {
      const document = await documents.upload(
        actorOf(req),
        param(req, "matterId"),
        uploadInput(req),
        requestContext(req),
      );
      res.status(201).json({ document });
    }),
  );

  router.get("/:documentId", async (req, res) => {
    const document = await documents.get(
      actorOf(req),
      param(req, "matterId"),
      param(req, "documentId"),
      requestContext(req),
    );
    res.json({ document });
  });

  router.patch("/:documentId", async (req, res) => {
    const { title } = renameDocumentRequestSchema.parse(req.body);
    await documents.rename(
      actorOf(req),
      param(req, "matterId"),
      param(req, "documentId"),
      title,
      requestContext(req),
    );
    res.status(204).end();
  });

  router.delete("/:documentId", async (req, res) => {
    await documents.remove(
      actorOf(req),
      param(req, "matterId"),
      param(req, "documentId"),
      requestContext(req),
    );
    res.status(204).end();
  });

  router.post(
    "/:documentId/versions",
    closeOnError(async (req, res) => {
      const document = await documents.addVersion(
        actorOf(req),
        param(req, "matterId"),
        param(req, "documentId"),
        uploadInput(req),
        requestContext(req),
      );
      res.status(201).json({ document });
    }),
  );

  /**
   * Always an attachment (never shown inside the app's origin), with its
   * detected type, `nosniff`, and a sandbox CSP in case a browser opens it
   * anyway. `no-store` comes from the API-wide middleware.
   */
  router.get("/:documentId/download", async (req, res) => {
    const { version } = downloadQuerySchema.parse(req.query);
    const download = await documents.download(
      actorOf(req),
      param(req, "matterId"),
      param(req, "documentId"),
      version,
      requestContext(req),
    );
    res.status(200);
    res.setHeader("Content-Type", download.mimeType);
    res.setHeader("Content-Length", String(download.sizeBytes));
    res.setHeader("Content-Disposition", attachmentHeader(download.fileName));
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      await pipeline(download.stream, res);
    } catch (error) {
      // Headers are gone already: break the connection so the client sees a failed download.
      req.log.error({ err: error }, "document download interrupted");
      res.destroy();
    }
  });

  return router;
}
