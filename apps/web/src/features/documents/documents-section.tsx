import {
  DEFAULT_UPLOAD_MAX_MB,
  UPLOAD_ACCEPT,
  documentListResponseSchema,
  documentResponseSchema,
  renameDocumentRequestSchema,
  type DocumentSummary,
  type MatterDetail,
} from "@lexora/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FilePlus2, History, Pencil, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Alert, Card, Dialog, Section } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useErrorMessage } from "@/features/auth/use-error-message";
import { ConfirmDialog } from "@/features/matters/matter-ui";
import { useFormat } from "@/features/matters/queries";
import { getJson, send, sendFile } from "@/lib/api";

const MAX_BYTES = DEFAULT_UPLOAD_MAX_MB * 1024 * 1024;
const ACCEPT = UPLOAD_ACCEPT.join(",");

const KIND_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.oasis.opendocument.text": "odt",
  "image/jpeg": "jpeg",
  "image/png": "png",
};

const documentsKey = (matterId: string) => ["matters", "documents", matterId] as const;
const basePath = (matterId: string) => `/api/matters/${matterId}/documents` as const;
const downloadPath = (matterId: string, documentId: string, version?: number) =>
  `${basePath(matterId)}/${documentId}/download${version === undefined ? "" : `?version=${version}`}`;

function useDocuments(matterId: string) {
  return useQuery({
    queryKey: documentsKey(matterId),
    queryFn: ({ signal }) => getJson(basePath(matterId), documentListResponseSchema, { signal }),
  });
}

function useSize() {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "ar" ? "ar-MA" : "fr-MA";
  return (bytes: number) => {
    const [value, unit] =
      bytes >= 1024 * 1024
        ? [bytes / (1024 * 1024), "megabyte"]
        : [Math.max(bytes / 1024, 0.1), "kilobyte"];
    return new Intl.NumberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(
      value,
    );
  };
}

/**
 * Checks size and extension before sending, so people get a clear message
 * at once. The server makes the real decision from the file's bytes.
 */
function useLocalCheck() {
  const { t } = useTranslation();
  return (file: File): string | null => {
    if (file.size > MAX_BYTES) return t("documents.tooLargeLocal", { name: file.name });
    const dot = file.name.lastIndexOf(".");
    const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!(UPLOAD_ACCEPT as readonly string[]).includes(extension)) {
      return t("documents.typeLocal", { name: file.name });
    }
    return null;
  };
}

/** A hidden file input opened by a visible button (keyboard and screen-reader friendly). */
function FilePicker({
  label,
  ariaLabel,
  disabled,
  onFile,
  icon,
  variant = "outline",
}: {
  label: string;
  ariaLabel?: string;
  disabled: boolean;
  onFile: (file: File) => void;
  icon: React.ReactNode;
  variant?: "outline" | "primary";
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => input.current?.click()}
      >
        {icon}
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function HistoryDialog({
  matterId,
  document,
  onClose,
}: {
  matterId: string;
  document: DocumentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const size = useSize();
  const errorMessage = useErrorMessage();
  const detail = useQuery({
    queryKey: [...documentsKey(matterId), document.id],
    queryFn: ({ signal }) =>
      getJson(`${basePath(matterId)}/${document.id}`, documentResponseSchema, { signal }),
  });
  return (
    <Dialog open onClose={onClose} title={t("documents.historyTitle", { name: document.title })}>
      <div className="space-y-4">
        {detail.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
        {detail.isError && <Alert tone="danger">{errorMessage(detail.error)}</Alert>}
        {detail.data && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {detail.data.document.versions.map((version) => (
              <li
                key={version.number}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {t("documents.version", { number: version.number })}
                  </p>
                  <p className="break-words text-muted">
                    {version.fileName} · {size(version.sizeBytes)} ·{" "}
                    {version.uploadedBy.displayName} · {format.date(version.createdAt.slice(0, 10))}
                  </p>
                </div>
                <a
                  href={downloadPath(matterId, document.id, version.number)}
                  download
                  className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-muted"
                  aria-label={`${t("documents.download")} – ${t("documents.version", { number: version.number })}`}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t("documents.download")}
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RenameDialog({
  matterId,
  document,
  onClose,
  onDone,
}: {
  matterId: string;
  document: DocumentSummary;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [title, setTitle] = useState(document.title);
  const [invalid, setInvalid] = useState(false);
  const rename = useMutation({
    mutationFn: () => send("PATCH", `${basePath(matterId)}/${document.id}`, { title }),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const ok = renameDocumentRequestSchema.safeParse({ title }).success;
    setInvalid(!ok);
    if (ok) rename.mutate();
  };
  return (
    <Dialog open onClose={onClose} title={t("documents.renameTitle")}>
      <form noValidate className="space-y-4" onSubmit={submit}>
        {rename.isError && <Alert tone="danger">{errorMessage(rename.error)}</Alert>}
        <Field label={t("documents.titleLabel")} error={invalid ? t("form.invalid") : undefined}>
          {(props) => (
            <Input
              {...props}
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={rename.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type Dialogs =
  | { kind: "history"; document: DocumentSummary }
  | { kind: "rename"; document: DocumentSummary }
  | { kind: "remove"; document: DocumentSummary }
  | null;

export function DocumentsSection({ matter }: { matter: MatterDetail }) {
  const { t } = useTranslation();
  const format = useFormat();
  const size = useSize();
  const errorMessage = useErrorMessage();
  const localCheck = useLocalCheck();
  const queryClient = useQueryClient();
  const documents = useDocuments(matter.id);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { writeDocuments, deleteDocuments } = matter.permissions;
  const refresh = () => queryClient.invalidateQueries({ queryKey: documentsKey(matter.id) });

  const upload = useMutation({
    mutationFn: ({ file, documentId }: { file: File; documentId?: string }) =>
      sendFile(
        documentId ? `${basePath(matter.id)}/${documentId}/versions` : basePath(matter.id),
        file,
        file.name,
        documentResponseSchema,
      ),
    onMutate: () => {
      setDone(null);
    },
    onSuccess: async (_result, { file }) => {
      setDone(t("documents.uploaded", { name: file.name }));
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (document: DocumentSummary) =>
      send("DELETE", `${basePath(matter.id)}/${document.id}`),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });

  const start = (file: File, documentId?: string) => {
    const problem = localCheck(file);
    setLocalError(problem);
    if (!problem) upload.mutate({ file, ...(documentId ? { documentId } : {}) });
  };

  return (
    <Section
      title={t("documents.title")}
      actions={
        writeDocuments && (
          <FilePicker
            label={t("documents.add")}
            variant="primary"
            disabled={upload.isPending}
            icon={<Upload className="size-4" aria-hidden="true" />}
            onFile={(file) => {
              start(file);
            }}
          />
        )
      }
    >
      {writeDocuments && <p className="text-xs text-muted">{t("documents.addHint")}</p>}
      {upload.isPending && (
        <p className="text-sm text-muted" role="status">
          {t("documents.uploading", { name: upload.variables.file.name })}
        </p>
      )}
      {done && !upload.isPending && <Alert tone="success">{done}</Alert>}
      {localError && <Alert tone="danger">{localError}</Alert>}
      {upload.isError && !localError && <Alert tone="danger">{errorMessage(upload.error)}</Alert>}

      {documents.isPending && <p className="text-sm text-muted">{t("common.loading")}</p>}
      {documents.isError && <Alert tone="danger">{errorMessage(documents.error)}</Alert>}
      {documents.data?.documents.length === 0 && (
        <p className="text-sm text-muted">{t("documents.empty")}</p>
      )}
      {documents.data && documents.data.documents.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-border">
            {documents.data.documents.map((document) => (
              <li key={document.id} className="space-y-3 p-4 sm:px-6">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium break-words">{document.title}</p>
                  <p className="text-sm text-muted">
                    {t("documents.meta", {
                      type: t(`documents.types.${KIND_BY_MIME[document.latest.mimeType] ?? "pdf"}`),
                      size: size(document.latest.sizeBytes),
                      person: document.latest.uploadedBy.displayName,
                      date: format.date(document.latest.createdAt.slice(0, 10)),
                    })}
                    {document.versionCount > 1 && (
                      <> · {t("documents.versionCount", { count: document.versionCount })}</>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={downloadPath(matter.id, document.id)}
                    download
                    aria-label={t("documents.downloadNamed", { name: document.title })}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    {t("documents.download")}
                  </a>
                  {document.versionCount > 1 && (
                    <Button
                      variant="outline"
                      aria-label={t("documents.historyNamed", { name: document.title })}
                      onClick={() => {
                        setDialog({ kind: "history", document });
                      }}
                    >
                      <History className="size-4" aria-hidden="true" />
                      {t("documents.history")}
                    </Button>
                  )}
                  {writeDocuments && (
                    <>
                      <FilePicker
                        label={t("documents.newVersion")}
                        ariaLabel={t("documents.newVersionNamed", { name: document.title })}
                        disabled={upload.isPending}
                        icon={<FilePlus2 className="size-4" aria-hidden="true" />}
                        onFile={(file) => {
                          start(file, document.id);
                        }}
                      />
                      <Button
                        variant="outline"
                        aria-label={t("documents.renameNamed", { name: document.title })}
                        onClick={() => {
                          setDialog({ kind: "rename", document });
                        }}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                        {t("documents.rename")}
                      </Button>
                    </>
                  )}
                  {deleteDocuments && (
                    <Button
                      variant="outline"
                      className="text-danger"
                      aria-label={t("documents.removeNamed", { name: document.title })}
                      onClick={() => {
                        setDialog({ kind: "remove", document });
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("documents.remove")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {dialog?.kind === "history" && (
        <HistoryDialog
          matterId={matter.id}
          document={dialog.document}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          matterId={matter.id}
          document={dialog.document}
          onDone={refresh}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={dialog?.kind === "remove"}
        title={t("documents.removeTitle")}
        message={t("documents.confirmRemove", { name: dialog?.document.title ?? "" })}
        error={remove.isError ? errorMessage(remove.error) : null}
        pending={remove.isPending}
        onConfirm={() => {
          if (dialog?.kind === "remove") remove.mutate(dialog.document);
        }}
        onClose={() => {
          setDialog(null);
          remove.reset();
        }}
      />
    </Section>
  );
}
