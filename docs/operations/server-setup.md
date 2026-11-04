# Installing Lexora on the office server

For the person who installs and looks after the server. Follow the steps in
order; each ends with a check. Background: [ADR 0006](../decisions/0006-deployment-host.md)
(host), [ADR 0007](../decisions/0007-backups.md) (backups) and
[security.md](../security.md).

**Real client data may be entered only after the
[production gate](../roadmap.md#production-gate) has been passed.**

## 1. The machine

- Ubuntu Server 24.04 LTS, installed with **full-disk encryption (LUKS)**.
  Keep the disk passphrase with the backup password (sealed envelope).
- On a UPS. A fixed address on the office network (for example
  `192.168.1.10`), set in the router's DHCP reservations.
- One administrator account (for example `lexadmin`) with an SSH key from
  the administrator's computer in `~/.ssh/authorized_keys`. No other accounts.
- Docker Engine and the Compose plugin from Docker's official apt
  repository (docs.docker.com/engine/install/ubuntu).

Check: `lsblk -f` shows `crypto_LUKS`; `docker compose version` works.

## 2. Lexora's files and secrets

```sh
sudo git clone https://github.com/<owner>/<repository>.git /opt/lexora
cd /opt/lexora
sudo cp .env.prod.example .env.prod      # then edit: hostname, LAN address
sudo sh infra/server/create-secrets.sh /etc/lexora/secrets
```

- `LEXORA_HOSTNAME`: the name office computers will use (for example
  `lexora.cabinet.lan`). Add it to the office DNS (router) pointing to the
  server's address, or to each computer's hosts file.
- `LEXORA_BIND_ADDRESS`: the server's office address. Ports are published
  there only.
- Copy `/etc/lexora/secrets/mfa_encryption_key` into the password manager
  next to the backup password: a restore without it cannot read second
  factors (everyone would need a second-factor reset).

Check: `sudo ls -l /etc/lexora/secrets` shows six files in a `drwx------`
folder.

## 3. Start Lexora

```sh
cd /opt/lexora
alias lexora='sudo docker compose --env-file .env.prod -f compose.prod.yaml'
lexora build
lexora up -d db clamav
lexora --profile tools run --rm migrate      # applies the database migrations
lexora up -d
lexora ps                                    # every service "healthy" (worker: running)
lexora run --rm --no-deps api node dist/cli/admin.js create
```

The last command asks for the first administrator's e-mail and name and
prints a single-use link (30 minutes) to set a password. A second factor is
required at first sign-in.

After an update (`git pull`): `lexora build`, then the `migrate` line, then
`lexora up -d`.

## 4. Trust Lexora's certificate on office computers

Lexora's HTTPS certificate comes from its own small certificate authority
(decision D5, internal CA first). Each office computer trusts its root
certificate once:

```sh
lexora cp web:/data/caddy/pki/authorities/local/root.crt ./lexora-root.crt
```

- Windows: double-click `lexora-root.crt` → Install certificate → Local
  machine → "Trusted Root Certification Authorities".
- macOS: Keychain Access → System → import, then set "Always trust".
- Firefox uses its own store: Settings → Privacy & Security → Certificates →
  Import.

The root is valid for 10 years; its private key is in the `caddy_data`
volume and is backed up (encrypted) every night. Never share that volume.

Check: `https://lexora.cabinet.lan` opens without a warning.

## 5. Harden the host

```sh
sudo OFFICE_SUBNET=192.168.1.0/24 LAN_INTERFACE=enp3s0 \
     ADMIN_IP=192.168.1.20 SSH_USER=lexadmin infra/server/harden.sh
```

It sets automatic security updates, SSH with keys only from the
administrator's computer, the `ufw` firewall, the `DOCKER-USER` rules that
Docker would otherwise bypass, Docker's daemon defaults and the nightly
backup timer. Keep an SSH session open while it runs; test a new login
before closing it.

Then set up backups: [backups.md](backups.md).

## 6. Prove it (port scans)

From an office computer (install nmap):

```sh
nmap -Pn -p- 192.168.1.10
```

Expected: only `80/tcp` and `443/tcp` open. From the administrator's
computer, `22/tcp` too. Nothing else (in particular not 5432, 3000, 3310,
8080, 8443).

From outside the office (a phone on mobile data, or an online port
checker against the office's public address): **no port open**. Lexora is
never exposed to the internet.

Also check:

```sh
curl -sI https://lexora.cabinet.lan | grep -i strict-transport   # HSTS present
curl -sI http://lexora.cabinet.lan                               # 301 to https
sudo ufw status verbose
sudo iptables -S DOCKER-USER
```

Record the date and results in the roadmap's production-gate section.

## 7. Day to day

- Alerts appear to administrators in Lexora (menu "Alertes"); see
  [the runbooks](../runbooks/README.md) for what to do.
- The nightly backup reports its result to Lexora; a failure raises an
  alert. Rotate the USB drives as described in [backups.md](backups.md).
- Updates: Ubuntu security updates install themselves. For Lexora, follow
  the update steps in section 3 after each release is merged.
