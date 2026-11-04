# Backups and restore

Design: [ADR 0007](../decisions/0007-backups.md). Targets: lose at most one
day of work (RPO 24 h), be back within one working day (RTO, decision D7).

## What is saved, and where

Every night at 02:30 `infra/server/backup.sh` saves:

- the database (`pg_dump`, everything Lexora knows, including the audit log);
- the document files, with a SHA-256 list of every file;
- the HTTPS certificate authority's keys (so office computers keep trusting
  Lexora after a restore).

into an encrypted **restic** repository on a second disk in the server, then:

1. checks the repository (`restic check`);
2. keeps 14 daily, 8 weekly and 12 monthly snapshots;
3. **restores the new snapshot** into an isolated database without network
   and a temporary folder, and checks every document file against its hash
   and every document the database knows against the files saved;
4. reports the result to Lexora. A failure raises a critical alert for
   administrators; so does a day without a successful backup.

Not in the backup on purpose: the secret files in `/etc/lexora/secrets`
(passwords and the second-factor encryption key). Keep a copy of
`mfa_encryption_key` in the password manager with the backup password.

## One-time setup

```sh
sudo mkdir -p /srv/backup/lexora              # on the second disk
sudo install -m 600 /dev/null /root/.lexora-restic-password
sudo nano /root/.lexora-restic-password       # a long passphrase, from the password manager
sudo RESTIC_REPOSITORY=/srv/backup/lexora RESTIC_PASSWORD_FILE=/root/.lexora-restic-password restic init
sudo install -m 600 /dev/null /etc/lexora/backup.env
sudo tee /etc/lexora/backup.env >/dev/null <<'EOF'
LEXORA_DIR=/opt/lexora
RESTIC_REPOSITORY=/srv/backup/lexora
RESTIC_PASSWORD_FILE=/root/.lexora-restic-password
EOF
sudo systemctl start lexora-backup.service    # first run now
journalctl -u lexora-backup.service -n 30     # ends with "backup verified"
```

The restic password is **never** written on a backup drive. It is kept in
the password manager and in a sealed envelope held by a named person.
Without it the backups cannot be read by anyone, including the office.

## USB drives (off-site copies)

Two encrypted USB drives, used in turn; one is always away from the office.
Once a week:

```sh
sudo mount /dev/sdX1 /mnt/usb                 # the drive in the office this week
sudo RESTIC_REPOSITORY=/mnt/usb/lexora RESTIC_PASSWORD_FILE=/root/.lexora-restic-password \
  restic copy --from-repo /srv/backup/lexora --from-password-file /root/.lexora-restic-password
sudo RESTIC_REPOSITORY=/mnt/usb/lexora RESTIC_PASSWORD_FILE=/root/.lexora-restic-password restic check
sudo umount /mnt/usb                          # unplug and take it off-site; bring the other one back
```

(First use of a drive: `restic init` on `/mnt/usb/lexora` with the same
password file, then `restic copy`.)

## Restore (after a loss)

Practise this once before real data is entered (production gate, item 2),
then once a year.

1. Install a server as in [server-setup.md](server-setup.md), sections 1–3,
   **without** creating the first administrator. Put back the old secret
   files if you have them; otherwise create new ones and restore the
   `mfa_encryption_key` from the password manager.
2. Stop Lexora but keep the database running:
   `lexora stop api worker web` .
3. Get the latest snapshot:
   `sudo restic -r <repository> restore latest --target /root/restore`
   (from the second disk, or from a USB drive).
4. Database (restored **as the schema owner**, so every table belongs to
   it and the application role's exact rights, including the
   hardening revokes, come back from the dump):
   ```sh
   lexora exec -T db dropdb -U postgres lexora
   lexora exec -T db createdb -U postgres -O lexora_owner lexora
   lexora exec -T db psql -U postgres -d lexora -c "ALTER SCHEMA public OWNER TO lexora_owner; REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT CONNECT ON DATABASE lexora TO lexora_app"
   lexora exec -T db pg_restore -U lexora_owner -d lexora --no-owner --exit-on-error < /root/restore/.../lexora.dump
   lexora --profile tools run --rm migrate      # "No pending migrations" for a same-version restore
   ```
   (Rehearsed on 2026-10-31 on the local trial: audit events identical,
   the application role still unable to delete audit events or change
   payments, the API healthy on the restored database.)
5. Documents and the certificate authority:
   ```sh
   lexora run --rm --no-deps --entrypoint tar -v /root/restore/...:/restore:ro api \
     -C /var/lib/lexora/documents -xf /restore/documents.tar
   lexora run --rm --no-deps --entrypoint tar -v /root/restore/...:/restore:ro web \
     -C /data -xf /restore/caddy-pki.tar
   ```
6. `lexora up -d`, sign in, open a few matters and documents, then in
   _Journal d'audit_ run _Vérifier maintenant_: the chain must be intact.
7. Record the date, how long it took and what was checked.

Delete `/root/restore` afterwards: it holds client data unencrypted.
