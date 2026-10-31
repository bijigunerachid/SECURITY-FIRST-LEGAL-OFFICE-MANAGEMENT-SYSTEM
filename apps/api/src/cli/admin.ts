import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "../config/env.js";
import { createDatabase } from "../lib/database.js";
import { AlertService } from "../modules/alerts/alert-service.js";
import { CliError, createFirstAdmin, recoverAdmin, type SetupLink } from "./admin-commands.js";

const USAGE = `Lexora administrator tool (run on the server).

  create   [--email <address>] [--name <full name>]   Create the first administrator
  recover  --email <address>                          Reset a locked-out administrator
  backup-report --status ok|failed [--detail <text>]  Record a backup result (for the backup job)

Each command prints a single-use link, valid for 30 minutes, to set a password.
Give it to the person directly; do not send it by e-mail or chat.`;

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** This is a terminal tool: its output is meant for the person running it. */
function say(text = ""): void {
  process.stdout.write(`${text}
`);
}

function print(link: SetupLink): void {
  say(`\nAccount: ${link.email}`);
  say(`Set-password link (single use, expires ${link.expiresAt.toLocaleString()}):\n`);
  say(`  ${link.url}\n`);
  say(
    "Open it in a browser on the office network. A second factor must be set up at first sign-in.",
  );
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      status: { type: "string" },
      detail: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  const commands = ["create", "recover", "backup-report"];
  if (values.help || !commands.includes(command ?? "")) {
    say(USAGE);
    return values.help ? 0 : 2;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : "Failed to load configuration");
    return 1;
  }
  const db = createDatabase(config);
  try {
    if (command === "backup-report") {
      if (values.status !== "ok" && values.status !== "failed") {
        throw new CliError("--status must be ok or failed");
      }
      await new AlertService(db).reportBackup(values.status === "ok", values.detail ?? null);
      say(`Backup result recorded: ${values.status}.`);
    } else if (command === "create") {
      const email = values.email ?? (await ask("E-mail address: "));
      const displayName = values.name ?? (await ask("Full name: "));
      print(await createFirstAdmin(db, config, { email, displayName }));
    } else {
      const email = values.email ?? (await ask("E-mail address of the administrator to recover: "));
      print(await recoverAdmin(db, config, email));
    }
    return 0;
  } catch (error) {
    console.error(
      error instanceof CliError ? `Error: ${error.message}` : "Error: the command failed.",
    );
    if (!(error instanceof CliError)) console.error(error);
    return 1;
  } finally {
    await db.$disconnect();
  }
}

process.exitCode = await main();
