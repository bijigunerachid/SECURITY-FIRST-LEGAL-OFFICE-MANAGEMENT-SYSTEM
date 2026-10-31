// Resets the TEST database and creates the synthetic end-to-end accounts in
// e2e-accounts.json. Refuses to touch any database whose name does not end
// in "_test".
//
//   npm run seed:e2e -w @lexora/api
import { readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/lib/database.js";
import { hashPassword } from "../src/modules/auth/passwords.js";
import { encryptTotpSecret } from "../src/modules/auth/totp.js";

interface Accounts {
  password: string;
  totpSecret: string;
  accounts: Record<
    string,
    { email: string; name: string; role: "admin" | "lawyer" | "assistant"; mfa: boolean }
  >;
}

const data = JSON.parse(
  readFileSync(new URL("./e2e-accounts.json", import.meta.url), "utf8"),
) as Accounts;
const config = loadConfig();
const ownerUrl = process.env["MIGRATION_DATABASE_URL"] ?? "";

for (const url of [config.databaseUrl, ownerUrl]) {
  if (!new URL(url).pathname.endsWith("_test")) {
    console.error("seed-e2e: refusing to run against a database whose name does not end in _test.");
    process.exit(1);
  }
}

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
await owner.query(
  'TRUNCATE "security_alert", "payment", "invoice_line", "invoice", "invoice_counter", "fee_agreement", "notification", "matter_task", "hearing", "document_version", "document", "break_glass_grant", "party", "matter_member", "matter", "matter_counter", "client", "audit_event", "rate_limit_bucket", "password_token", "recovery_code", "totp_factor", "session", "app_user" RESTART IDENTITY CASCADE',
);
// Synthetic office details (not a real office), so invoices can be issued in tests.
await owner.query(
  `UPDATE billing_settings SET office_name = 'Cabinet de démonstration Lexora',
     address = '1 rue de l''Exemple, Rabat', ice = '000000000000001', tax_id = '1',
     professional_tax_id = NULL, bar_association = 'Rabat', bank_name = 'Banque de démonstration',
     rib = '000000000000000000000001', vat_rate_basis_points = 2000, payment_term_days = 30,
     phone = NULL, email = NULL, invoice_note = NULL`,
);
await owner.end();

// Uploaded test documents go with the database rows that described them.
// The folders stay (the running API created them); only their files go.
if (config.nodeEnv === "test") {
  for (const folder of ["store", "quarantine"]) {
    const dir = join(config.documents.storageDir, folder);
    const names = await readdir(dir).catch(() => []);
    await Promise.all(names.map((name) => rm(join(dir, name), { force: true })));
  }
}

const db = createDatabase(config);
const passwordHash = await hashPassword(data.password, config.argon2);
for (const account of Object.values(data.accounts)) {
  const user = await db.user.create({
    data: { email: account.email, displayName: account.name, role: account.role, passwordHash },
  });
  if (account.mfa) {
    const sealed = encryptTotpSecret(data.totpSecret, user.id, config.mfaEncryptionKey);
    await db.totpFactor.create({
      data: {
        userId: user.id,
        secretCiphertext: new Uint8Array(sealed.ciphertext),
        keyId: sealed.keyId,
        confirmedAt: new Date(),
      },
    });
  }
}
await db.$disconnect();
console.error(`seed-e2e: created ${Object.keys(data.accounts).length} test accounts.`);
