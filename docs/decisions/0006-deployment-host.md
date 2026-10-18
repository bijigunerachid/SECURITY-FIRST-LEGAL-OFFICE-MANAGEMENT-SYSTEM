# 0006 — Dedicated Linux server with Docker Engine

Status: Accepted (2026-10-18). Hardware to be confirmed (decision D1).

## Context

The office needs one server inside its network. Docker Desktop is meant for
development workstations, and Windows Server does not support it. The
current development machine is a Windows 11 workstation.

## Decision

- Production runs on a dedicated machine with Ubuntu Server 24.04 LTS (or
  another supported LTS distribution), Docker Engine and the Compose plugin.
- Full-disk encryption (LUKS), a UPS, and automatic security updates.
- Only port 443 (plus 80, which only redirects) is reachable, from the office
  subnet only. SSH uses keys only, from the administrator's machine only.
- Docker adds its own iptables rules, which bypass `ufw`. Published ports are
  therefore bound to the server's LAN address, and filtering is added in the
  `DOCKER-USER` chain. A port scan proves the result.
- Nothing is exposed to the internet. Any future remote access needs a
  separately reviewed VPN design.

## Consequences

- The office must provide or buy suitable hardware.
- An installation and hardening guide is written in Phase 9.
- How the encrypted disk is unlocked after a reboot (passphrase at the
  console, or TPM) is decided at installation, balancing security against
  unattended restarts.
