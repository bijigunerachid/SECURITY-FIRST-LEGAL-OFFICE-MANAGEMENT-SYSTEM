import { displayNameSchema, emailSchema } from "@lexora/shared";
import type { Config } from "../config/env.js";
import type { Database } from "../lib/database.js";
import { AuthService } from "../modules/auth/auth-service.js";

/**
 * Administrator provisioning and recovery, run on the server only (there is
 * no web endpoint for either). Neither command handles a password: each
 * prints a single-use link, valid 30 minutes, to set one in the browser,
 * where the normal password policy and second-factor set-up apply.
 */

const CLI_CONTEXT = { requestId: "cli", ipAddress: "local" };

export interface SetupLink {
  email: string;
  url: string;
  expiresAt: Date;
}

export class CliError extends Error {}

const linkFor = (config: Pick<Config, "appOrigin">, token: string) =>
  // The token is in the fragment (#), which browsers never send to servers or in Referer headers.
  `${config.appOrigin}/set-password#token=${token}`;

/** Creates the first administrator. Refuses if an active administrator already exists. */
export async function createFirstAdmin(
  db: Database,
  config: ConstructorParameters<typeof AuthService>[1] & Pick<Config, "appOrigin">,
  input: { email: string; displayName: string },
): Promise<SetupLink> {
  const email = emailSchema.safeParse(input.email);
  const displayName = displayNameSchema.safeParse(input.displayName);
  if (!email.success) throw new CliError("That is not a valid e-mail address.");
  if (!displayName.success) throw new CliError("The name must be 1 to 120 characters.");

  const admins = await db.user.count({ where: { role: "admin", disabledAt: null } });
  if (admins > 0) {
    throw new CliError(
      "An active administrator already exists. Create further accounts from the web app, " +
        "or use `recover` if every administrator is locked out.",
    );
  }
  const auth = new AuthService(db, config);
  const { setup } = await auth.createUser(
    { email: email.data, displayName: displayName.data, role: "admin" },
    null,
    CLI_CONTEXT,
  );
  return { email: email.data, url: linkFor(config, setup.token), expiresAt: setup.expiresAt };
}

/**
 * Recovers a locked-out administrator: removes their second factor, signs
 * them out everywhere and issues a new password link. They must set up a
 * second factor again at the next sign-in.
 */
export async function recoverAdmin(
  db: Database,
  config: ConstructorParameters<typeof AuthService>[1] & Pick<Config, "appOrigin">,
  rawEmail: string,
): Promise<SetupLink> {
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) throw new CliError("That is not a valid e-mail address.");
  const user = await db.user.findUnique({ where: { email: email.data } });
  if (user?.role !== "admin") {
    throw new CliError("No administrator account has that e-mail address.");
  }
  const auth = new AuthService(db, config);
  await db.$transaction([
    db.totpFactor.deleteMany({ where: { userId: user.id } }),
    db.recoveryCode.deleteMany({ where: { userId: user.id } }),
    db.user.update({ where: { id: user.id }, data: { disabledAt: null } }),
  ]);
  await auth.sessions.revokeAllForUser(user.id);
  const issued = await auth.issuePasswordToken(user.id, null);
  await auth.audit(
    {
      action: "admin.recover",
      outcome: "success",
      targetType: "user",
      targetId: user.id,
      metadata: { via: "cli" },
    },
    CLI_CONTEXT,
  );
  return { email: email.data, url: linkFor(config, issued.token), expiresAt: issued.expiresAt };
}
