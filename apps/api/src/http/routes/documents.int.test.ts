import { documentResponseSchema, documentListResponseSchema } from "@lexora/shared";
import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest, type Server } from "node:http";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../../modules/auth/sessions.js";
import { FAKE_MALWARE_MARKER, FAKE_SIGNATURE } from "../../test/fake-clamd.js";
import { docm, docx, jpeg, odt, pdf, png, xlsx, zip } from "../../test/fixtures.js";
import {
  Browser,
  integrationContext,
  resetDatabase,
  type IntegrationContext,
} from "../../test/integration.js";
import {
  addMember,
  auditActions,
  createClient,
  createMatter,
  person,
  type Person,
} from "../../test/matters.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await integrationContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  ctx.clamd.mode = "ok";
  // Each test starts with empty storage folders.
  for (const folder of ["store", "quarantine"]) {
    const dir = join(ctx.storageDir, folder);
    await Promise.all((await readdir(dir)).map((name) => rm(join(dir, name), { force: true })));
  }
});

const LIMIT = 2 * 1024 * 1024; // the integration context's upload limit

function upload(who: Browser, path: string, content: Buffer, fileName = "contrat.pdf") {
  return who.send("post", path, content, {
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(fileName),
  });
}

/** GET with the browser's cookie, keeping the raw bytes. */
function download(who: Browser, path: string) {
  let req = request(ctx.app).get(path);
  if (who.sessionToken) req = req.set("Cookie", `${SESSION_COOKIE}=${who.sessionToken}`);
  return req.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => {
      callback(null, Buffer.concat(chunks));
    });
    res.on("error", (error: Error) => {
      callback(error, null);
    });
  });
}

const storedFiles = async (folder: "store" | "quarantine") => readdir(join(ctx.storageDir, folder));

async function team() {
  const lead = await person(ctx, "lawyer");
  const client = await createClient(lead);
  const matter = await createMatter(lead, client.id);
  return { lead, matter, base: `/api/matters/${matter.id}/documents` };
}

async function uploaded(who: Person, base: string, content = pdf(), name = "contrat.pdf") {
  const res = await upload(who.browser, base, content, name);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return documentResponseSchema.parse(res.body).document;
}

describe("uploading", () => {
  it("checks, scans and stores a PDF under a random name, then lists it", async () => {
    const { lead, base } = await team();
    const content = pdf("Bail commercial");
    const before = ctx.clamd.scans;
    const document = await uploaded(lead, base, content, "Bail commercial.pdf");

    expect(document).toMatchObject({
      title: "Bail commercial.pdf",
      versionCount: 1,
      latest: {
        number: 1,
        fileName: "Bail commercial.pdf",
        mimeType: "application/pdf",
        sizeBytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        uploadedBy: { id: lead.user.id },
      },
    });
    expect(ctx.clamd.scans).toBe(before + 1);
    const stored = await storedFiles("store");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readFile(join(ctx.storageDir, "store", stored[0] ?? ""))).toEqual(content);
    expect(await storedFiles("quarantine")).toEqual([]);

    const list = documentListResponseSchema.parse((await lead.browser.send("get", base)).body);
    expect(list.documents.map((d) => d.id)).toEqual([document.id]);

    const audit = (await auditActions(ctx)).find((e) => e.action === "document.upload");
    expect(audit?.metadata).toEqual({
      matterId: expect.any(String),
      version: 1,
      size: content.length,
      type: "pdf",
    });
    // File names often contain client names: never in the audit log.
    expect(JSON.stringify(await auditActions(ctx))).not.toContain("Bail commercial");
  });

  it.each([
    ["Word", docx(), "note.docx"],
    ["Excel", xlsx(), "chiffres.xlsx"],
    ["OpenDocument", odt(), "lettre.odt"],
    ["JPEG", jpeg(), "photo.jpg"],
    ["PNG", png(), "scan.png"],
  ])("accepts %s files", async (_label, content, name) => {
    const { lead, base } = await team();
    expect((await upload(lead.browser, base, content, name)).status).toBe(201);
  });

  it("cleans the file name and keeps the detected extension", async () => {
    const { lead, base } = await team();
    const traversal = await uploaded(lead, base, pdf(), "../../etc/passwd.pdf");
    expect(traversal.latest.fileName).toBe("passwd.pdf");
    const disguised = await uploaded(lead, base, pdf(), "virement.exe");
    expect(disguised.latest.fileName).toBe("virement.exe.pdf");
  });

  it.each([
    [
      "an executable named .pdf",
      Buffer.concat([Buffer.from("MZ"), Buffer.alloc(500)]),
      "unsupported_type",
    ],
    ["HTML named .pdf", Buffer.from("<html><script>alert(1)</script></html>"), "unsupported_type"],
    ["a Word file with macros", docm(), "macros"],
    [
      "an archive with encrypted entries",
      docx([{ name: "x", data: "y", encrypted: true }]),
      "encrypted",
    ],
    ["a damaged archive", zip([{ name: "a", data: "b" }], { zip64Marker: true }), "malformed"],
    ["an empty file", Buffer.alloc(0), "unsupported_type"],
  ])("refuses %s and keeps nothing", async (_label, content, reason) => {
    const { lead, base } = await team();
    const res = await upload(lead.browser, base, content);
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("unsupported_file_type");
    expect(await storedFiles("store")).toEqual([]);
    expect(await storedFiles("quarantine")).toEqual([]);
    expect(await ctx.db.document.count()).toBe(0);
    const refusal = (await auditActions(ctx)).find((e) => e.action === "document.rejected");
    expect(refusal).toMatchObject({ outcome: "denied", metadata: { reason } });
  });

  it("refuses a file the scanner flags, and records the signature", async () => {
    const { lead, base } = await team();
    const infected = Buffer.concat([pdf(), Buffer.from(FAKE_MALWARE_MARKER)]);
    const res = await upload(lead.browser, base, infected);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("malware_detected");
    expect(await storedFiles("store")).toEqual([]);
    expect(await storedFiles("quarantine")).toEqual([]);
    const refusal = (await auditActions(ctx)).find((e) => e.action === "document.rejected");
    expect(refusal?.metadata).toMatchObject({ reason: "malware", signature: FAKE_SIGNATURE });
  });

  it.each(["error", "close", "hang"] as const)(
    "stores nothing when the scanner fails (%s): fail closed",
    async (mode) => {
      const { lead, base } = await team();
      ctx.clamd.mode = mode;
      const res = await upload(lead.browser, base, pdf());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("scan_unavailable");
      expect(await storedFiles("store")).toEqual([]);
      expect(await storedFiles("quarantine")).toEqual([]);
      expect(await ctx.db.document.count()).toBe(0);
    },
  );

  it("refuses files over the limit, whether announced or not", async () => {
    const { lead, base } = await team();
    const big = Buffer.concat([pdf(), Buffer.alloc(LIMIT)]);
    // Refused from the announced size before the body is read; the server then
    // closes the connection, so the client sees either the 413 or a reset.
    const announced = await upload(lead.browser, base, big).then(
      (res) => res.status,
      (error: unknown) => ((error as { code?: string }).code === "ECONNRESET" ? "reset" : error),
    );
    expect([413, "reset"]).toContain(announced);

    // Without Content-Length (chunked), the limit is enforced while streaming.
    const server: Server = ctx.app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      // The server answers 413 and closes the connection while the client is
      // still sending, so the client may see the answer or a reset: both mean refused.
      const outcome = await new Promise<number | "reset">((resolve) => {
        const req = httpRequest(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: base,
            headers: {
              Origin: ctx.config.appOrigin,
              Cookie: `${SESSION_COOKIE}=${lead.browser.sessionToken ?? ""}`,
              "X-CSRF-Token": lead.browser.csrfToken ?? "",
              "Content-Type": "application/octet-stream",
              "Transfer-Encoding": "chunked",
              "X-File-Name": "big.pdf",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", () => {
          resolve("reset");
        });
        for (let i = 0; i < 40; i += 1) req.write(Buffer.alloc(64 * 1024));
        req.end();
      });
      expect([413, "reset"]).toContain(outcome);
    } finally {
      server.close();
    }
    expect(await storedFiles("store")).toEqual([]);
    expect(await storedFiles("quarantine")).toEqual([]);
    const refusals = (await auditActions(ctx)).filter((e) => e.action === "document.rejected");
    expect(refusals.map((e) => (e.metadata as { reason: string }).reason)).toEqual([
      "too_large",
      "too_large",
    ]);
  });

  it("accepts uploads only as a raw file body with a name", async () => {
    const { lead, base } = await team();
    expect((await lead.browser.send("post", base, { file: "x" })).status).toBe(415);
    const unnamed = await lead.browser.send("post", base, pdf(), {
      "Content-Type": "application/octet-stream",
    });
    expect(unnamed.status).toBe(400);
    const badName = await lead.browser.send("post", base, pdf(), {
      "Content-Type": "application/octet-stream",
      "X-File-Name": "%E0%A4%A",
    });
    expect(badName.status).toBe(400);
    // Raw bodies are refused everywhere else.
    const elsewhere = await lead.browser.send("post", "/api/clients", pdf(), {
      "Content-Type": "application/octet-stream",
    });
    expect(elsewhere.status).toBe(415);
  });

  it("requires the session's CSRF token", async () => {
    const { lead, base } = await team();
    const forged = new Browser(ctx);
    forged.sessionToken = lead.browser.sessionToken;
    expect((await upload(forged, base, pdf())).status).toBe(403);
    expect(await storedFiles("quarantine")).toEqual([]);
  });
});

describe("versions, downloads and deletion", () => {
  it("downloads as an attachment with safe headers and the exact bytes", async () => {
    const { lead, base } = await team();
    const content = pdf("Original");
    const document = await uploaded(lead, base, content, "Décision (appel).pdf");
    const res = await download(lead.browser, `${base}/${document.id}/download`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(content);
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-length": String(content.length),
      "content-disposition":
        "attachment; filename=\"Decision (appel).pdf\"; filename*=UTF-8''D%C3%A9cision%20%28appel%29.pdf",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    expect((await auditActions(ctx)).filter((e) => e.action === "document.download")).toHaveLength(
      1,
    );
  });

  it("keeps every version and serves the one asked for", async () => {
    const { lead, base } = await team();
    const first = pdf("Version 1");
    const second = pdf("Version 2");
    const document = await uploaded(lead, base, first);
    const res = await upload(lead.browser, `${base}/${document.id}/versions`, second, "v2.pdf");
    expect(res.status).toBe(201);
    const detail = documentResponseSchema.parse(res.body).document;
    expect(detail.versionCount).toBe(2);
    expect(detail.versions.map((v) => v.number)).toEqual([2, 1]);
    expect(detail.title).toBe("contrat.pdf");

    expect((await download(lead.browser, `${base}/${document.id}/download`)).body).toEqual(second);
    expect(
      (await download(lead.browser, `${base}/${document.id}/download?version=1`)).body,
    ).toEqual(first);
    expect((await download(lead.browser, `${base}/${document.id}/download?version=9`)).status).toBe(
      404,
    );
  });

  it("hides deleted documents but keeps their files", async () => {
    const { lead, base } = await team();
    const document = await uploaded(lead, base);
    expect((await lead.browser.send("delete", `${base}/${document.id}`)).status).toBe(204);
    expect(
      documentListResponseSchema.parse((await lead.browser.send("get", base)).body).documents,
    ).toEqual([]);
    expect((await lead.browser.send("get", `${base}/${document.id}`)).status).toBe(404);
    expect((await download(lead.browser, `${base}/${document.id}/download`)).status).toBe(404);
    expect(await storedFiles("store")).toHaveLength(1);
  });

  it("never delivers a stored file that no longer matches its hash", async () => {
    const { lead, base } = await team();
    const content = pdf("Intact");
    const document = await uploaded(lead, base, content);
    const [key] = await storedFiles("store");
    // Same size, different bytes: only the hash can tell.
    const tampered = Buffer.from(content);
    tampered[tampered.length - 2] = 0x41;
    await writeFile(join(ctx.storageDir, "store", key ?? ""), tampered);

    const outcome = await download(lead.browser, `${base}/${document.id}/download`).then(
      (res) => (res.body as Buffer).length,
      () => "broken",
    );
    // Either the transfer broke off, or it ended short: never the full tampered file.
    expect(outcome === "broken" || (typeof outcome === "number" && outcome < content.length)).toBe(
      true,
    );
    expect((await auditActions(ctx)).filter((e) => e.action === "document.integrity")).toEqual([
      expect.objectContaining({ outcome: "failure", metadata: { version: 1, detail: "hash" } }),
    ]);
  });

  it("renames a document", async () => {
    const { lead, base } = await team();
    const document = await uploaded(lead, base);
    expect(
      (await lead.browser.send("patch", `${base}/${document.id}`, { title: "Bail signé" })).status,
    ).toBe(204);
    expect((await lead.browser.send("patch", `${base}/${document.id}`, { title: "" })).status).toBe(
      400,
    );
    expect(
      (await lead.browser.send("patch", `${base}/${document.id}`, { matterId: "x" })).status,
    ).toBe(400);
    const detail = documentResponseSchema.parse(
      (await lead.browser.send("get", `${base}/${document.id}`)).body,
    );
    expect(detail.document.title).toBe("Bail signé");
  });
});

describe("access", () => {
  /**
   * Every kind of user against every document endpoint. Refused uploads must
   * not reach storage or the scanner: access is checked before the body is
   * read.
   */
  async function grid(who: (w: { lead: Person; matterId: string }) => Browser | Promise<Browser>) {
    const { lead, matter, base } = await team();
    const document = await uploaded(lead, base);
    const browser = await who({ lead, matterId: matter.id });
    const filesBefore = await storedFiles("store");
    const scansBefore = ctx.clamd.scans;
    const doc = `${base}/${document.id}`;
    const statuses = {
      list: (await browser.send("get", base)).status,
      upload: (await upload(browser, base, pdf())).status,
      read: (await browser.send("get", doc)).status,
      rename: (await browser.send("patch", doc, { title: "Nouveau titre" })).status,
      download: (await download(browser, `${doc}/download`)).status,
      version: (await upload(browser, `${doc}/versions`, pdf())).status,
      remove: (await browser.send("delete", doc)).status,
    };
    const added = statuses.upload === 201 || statuses.version === 201;
    if (!added) {
      expect(await storedFiles("store")).toEqual(filesBefore);
      expect(ctx.clamd.scans).toBe(scansBefore);
    }
    expect(await storedFiles("quarantine")).toEqual([]);
    return statuses;
  }

  const ALL = {
    list: 200,
    upload: 201,
    read: 200,
    rename: 204,
    download: 200,
    version: 201,
    remove: 204,
  };
  const NONE = {
    list: 404,
    upload: 404,
    read: 404,
    rename: 404,
    download: 404,
    version: 404,
    remove: 404,
  };

  it("lead lawyer and lawyer on the team: everything", async () => {
    expect(await grid(({ lead }) => lead.browser)).toEqual(ALL);
    expect(
      await grid(async ({ lead, matterId }) => {
        const colleague = await person(ctx, "lawyer");
        await addMember(lead, matterId, colleague);
        return colleague.browser;
      }),
    ).toEqual(ALL);
  });

  it("assistant on the team: everything but deletion", async () => {
    expect(
      await grid(async ({ lead, matterId }) => {
        const assistant = await person(ctx, "assistant");
        await addMember(lead, matterId, assistant);
        return assistant.browser;
      }),
    ).toEqual({ ...ALL, remove: 403 });
  });

  it.each(["lawyer", "assistant", "admin"] as const)(
    "%s outside the team: nothing, and nothing stored",
    async (role) => {
      expect(await grid(async () => (await person(ctx, role)).browser)).toEqual(NONE);
    },
  );

  it("administrator with break-glass access: reads and downloads only", async () => {
    expect(
      await grid(async ({ matterId }) => {
        const admin = await person(ctx, "admin", { reauth: true });
        const matter = await ctx.db.matter.findUniqueOrThrow({ where: { id: matterId } });
        await admin.browser.send("post", "/api/break-glass", {
          reference: matter.reference,
          reason: "Avocat injoignable, audience demain matin.",
        });
        return admin.browser;
      }),
    ).toEqual({
      ...NONE,
      list: 200,
      read: 200,
      download: 200,
      upload: 403,
      rename: 403,
      version: 403,
      remove: 403,
    });
    const reads = (await auditActions(ctx)).filter((e) => e.action === "document.download");
    expect(reads.at(-1)?.metadata).toMatchObject({ breakGlass: true });
  });

  it("signed out: 401", async () => {
    expect(await grid(() => new Browser(ctx))).toEqual(
      Object.fromEntries(Object.keys(ALL).map((k) => [k, 401])),
    );
  });

  it("refuses a document ID from another matter, even to a member of both", async () => {
    const { lead, base } = await team();
    const client = await createClient(lead, { name: "Autre client" });
    const other = await createMatter(lead, client.id);
    const foreign = await uploaded(lead, `/api/matters/${other.id}/documents`);
    for (const res of [
      await lead.browser.send("get", `${base}/${foreign.id}`),
      await download(lead.browser, `${base}/${foreign.id}/download`),
      await lead.browser.send("delete", `${base}/${foreign.id}`),
      await upload(lead.browser, `${base}/${foreign.id}/versions`, pdf()),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await ctx.db.document.count({ where: { deletedAt: null } })).toBe(1);
  });
});
