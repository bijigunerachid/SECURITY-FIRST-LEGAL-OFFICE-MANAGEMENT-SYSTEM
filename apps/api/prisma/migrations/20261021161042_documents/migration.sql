-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "matter_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_id" UUID,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "storage_key" UUID NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" BYTEA NOT NULL,
    "scanned_with" VARCHAR(64) NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_matter_id_idx" ON "document"("matter_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_storage_key_key" ON "document_version"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_document_id_number_key" ON "document_version"("document_id", "number");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written hardening (not expressible in schema.prisma). Reviewed.
-- ---------------------------------------------------------------------------

ALTER TABLE "document"
  ADD CONSTRAINT "document_title_not_blank" CHECK (btrim("title") <> ''),
  -- Hidden by someone, at some time: both or neither.
  ADD CONSTRAINT "document_deleted_pair" CHECK (("deleted_at" IS NULL) = ("deleted_by_id" IS NULL));

ALTER TABLE "document_version"
  ADD CONSTRAINT "document_version_number_positive" CHECK ("number" >= 1),
  ADD CONSTRAINT "document_version_size_range" CHECK ("size_bytes" BETWEEN 1 AND 104857600),
  ADD CONSTRAINT "document_version_sha256_length" CHECK (octet_length("sha256") = 32),
  ADD CONSTRAINT "document_version_file_name_not_blank" CHECK (btrim("file_name") <> ''),
  -- Only the types the upload check accepts (decision D8).
  ADD CONSTRAINT "document_version_mime_type_allowed" CHECK ("mime_type" IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'image/jpeg',
    'image/png'
  ));

-- Documents are hidden, never deleted; versions are written once.
REVOKE DELETE, TRUNCATE ON TABLE "document", "document_version" FROM lexora_app;
REVOKE UPDATE ON TABLE "document_version" FROM lexora_app;
-- A document can only be renamed, hidden (deleted_at, deleted_by_id) or touched (updated_at).
REVOKE UPDATE ON TABLE "document" FROM lexora_app;
GRANT UPDATE ("title", "deleted_at", "deleted_by_id", "updated_at") ON TABLE "document" TO lexora_app;
