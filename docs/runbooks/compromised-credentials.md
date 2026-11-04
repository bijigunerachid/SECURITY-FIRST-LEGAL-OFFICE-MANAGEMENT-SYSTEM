# A password, second factor or computer may be compromised

Signs: an alert for repeated failed sign-ins or refused accesses, a person
who did not sign in but appears in the audit log, a lost phone with the
authenticator, a phishing e-mail someone answered, a stolen laptop.

## 1. An account

1. Call the person (not by e-mail) and ask whether it was them.
2. If not, or if unsure, in **Utilisateurs → Gérer**:
   - **Déconnecter partout** (signs the account out everywhere);
   - **Réinitialiser la double authentification** if the phone or authenticator may
     be in someone else's hands;
   - **Nouveau lien de mot de passe**, handed over in person, so the person sets a
     new password.
   - If the person has left or cannot be reached: **Désactiver le compte**.
3. In **Journal d'audit**, filter on the person (link "Journal" on the
   users page) for the last days: what was read, downloaded or exported?
   Note matters and documents concerned.
4. Resolve the alert with a note of what was found and done.

## 2. Someone probing other matters

The alert "Accès refusés répétés" names the account. Look at the refused
attempts in the audit log (which matters were tried). Talk to the person;
a curious colleague and a stolen session look the same from here. If not
explained, treat it as section 1.

## 3. An administrator account

Administrators can manage accounts and open emergency access, so act
faster:

1. From another administrator account, use **Réinitialiser la double
   authentification** (it also closes the sessions) on the account
   concerned, then issue a **Nouveau lien de mot de passe**.
2. If no other administrator can act: on the server,
   `lexora run --rm --no-deps api node dist/cli/admin.js recover --email <address>`.
3. In the audit log, review everything the account did: accounts created
   or changed, emergency accesses (`matter.break_glass`), exports.
   Undo unauthorised account changes.

## 4. The server's own secrets

If a secret file, the `.env.prod` file or a database password may have
leaked (copied to a USB stick, pasted in an e-mail...):

1. Create new secrets in a new folder, change the database passwords to the
   new ones (`ALTER ROLE lexora_app PASSWORD ...` and the same for
   `lexora_owner`, run as `postgres` in the `db` container), point
   `LEXORA_SECRETS_DIR` to the new folder and `lexora up -d`.
2. The second-factor key cannot simply be replaced: if it leaked, reset
   every second factor after switching to a new key.

## Afterwards

Record the incident. If client data may have been seen by someone outside
the office, assess with the legal adviser (law 09-08, CNDP).
