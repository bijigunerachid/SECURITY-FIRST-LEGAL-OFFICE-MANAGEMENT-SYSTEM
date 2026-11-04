# Ransomware or a break-in on the server

Signs: files renamed or unreadable, a ransom note, the alert "Journal
d'audit modifié", unknown processes or accounts on the server, Lexora
suddenly failing in many places.

## Immediately

1. **Unplug the server's network cable.** Do not shut it down yet if you
   can avoid it (memory may hold evidence); never pay or contact the
   attackers.
2. **Unplug the backup disk** if it is a separate drive, and make sure no
   USB backup drive is connected. The off-site drive must stay off-site.
3. Tell the office and stop using Lexora. Note the time and what you saw.
4. Call the office's IT support or a security professional before touching
   anything else.

## Find a clean backup

The audit log's hash chain and the nightly restore test help here:

1. On a **separate, clean machine**, restore the most recent snapshot from
   the off-site USB drive into an isolated test
   ([backups.md](../operations/backups.md), "Restore"), and check the audit
   chain (_Vérifier maintenant_).
2. If the chain is broken or the data looks wrong, try older snapshots
   until one is clean. Record which snapshot you keep and why.

## Rebuild

1. Reinstall the server from scratch (new disk encryption passphrase, new
   SSH keys) following [server-setup.md](../operations/server-setup.md).
   Do not reuse anything from the attacked system except the clean backup.
2. Restore with **new secrets**, a new certificate authority and password
   links for everyone, as in [stolen-server.md](stolen-server.md).
3. Find how the attacker got in before reconnecting (outdated software,
   exposed port, stolen credentials) and fix it; run the port scans again.

## Afterwards

Work lost since the restored snapshot must be re-entered from paper or
e-mails. Assess the breach with the legal adviser (law 09-08, CNDP), and
record the incident.
