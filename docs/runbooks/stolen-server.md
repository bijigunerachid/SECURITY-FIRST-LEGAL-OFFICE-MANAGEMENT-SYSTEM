# The server or a backup drive is lost or stolen

What protects the data: the server's disk is encrypted (LUKS) and the
backups are encrypted (restic). Without the disk passphrase and the restic
password, which never travel with the machine or the drives, the data
cannot be read. The risk is that a secret travelled with them.

## Immediately (first hour)

1. Write down when it was last seen and what was taken (server, which USB
   drive, any paper with passwords).
2. Report the theft to the police; keep the reference.
3. Check that the restic password envelope and the password manager are
   still in place.

## If the server was taken

1. Treat every secret on it as known: database passwords, the second-factor
   encryption key, the HTTPS certificate authority, session tokens.
2. Install a new server and restore the latest backup
   ([backups.md](../operations/backups.md), "Restore"), **with new secrets**
   (`create-secrets.sh` on an empty folder). Second factors: restore the old
   `mfa_encryption_key` from the password manager only if the server's disk
   was encrypted and its passphrase not taken with it; otherwise use a new
   key and reset every second factor (Utilisateurs → Gérer → Réinitialiser
   la double authentification).
3. New certificate authority: remove the restored `caddy-pki` and let Caddy
   create a new one; install the new root on every office computer and
   **remove the old root** from them.
4. Ask everyone to change their password at first sign-in (an administrator
   issues a password link to each person).
5. Check the audit log after restore (_Vérifier maintenant_).

## If a backup drive was taken

1. Change the restic password: `restic key add` with a new password, then
   `restic key remove` the old key, on the server's repository and the
   remaining drive. Update the envelope and the password manager.
2. Start a new drive for the rotation.
3. If the restic password may also have been exposed, follow "If the
   server was taken" (the drive holds everything).

## Afterwards

- Data-breach assessment with the office's legal adviser (law 09-08, CNDP).
- Record what happened, what was done, and what will change.
