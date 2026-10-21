import { z } from "zod";
import { personRefSchema } from "./matters.js";

/**
 * Contracts for matter documents. Uploads are sent as the raw file body
 * (`application/octet-stream`) with the file name in the `X-File-Name`
 * header (percent-encoded UTF-8); everything else is JSON.
 */

/** Decision D8. The server decides the type from the file's bytes; this list is for the file picker. */
export const UPLOAD_ACCEPT = [".pdf", ".docx", ".xlsx", ".odt", ".jpg", ".jpeg", ".png"] as const;
export const DEFAULT_UPLOAD_MAX_MB = 25;
export const FILE_NAME_HEADER = "X-File-Name";

export const documentVersionSchema = z.strictObject({
  number: z.number().int().min(1),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(1),
  /** Hex SHA-256 of the file, to check a downloaded copy. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedBy: personRefSchema,
  createdAt: z.iso.datetime(),
});
export type DocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  latest: documentVersionSchema,
  versionCount: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentListResponseSchema = z.strictObject({
  documents: z.array(documentSummarySchema),
});

export const documentDetailSchema = z.strictObject({
  ...documentSummarySchema.shape,
  /** Newest first. */
  versions: z.array(documentVersionSchema),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const documentResponseSchema = z.strictObject({ document: documentDetailSchema });

export const renameDocumentRequestSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v), { message: "unsupported characters" }),
});

export const downloadQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(1).max(100_000).optional(),
});
