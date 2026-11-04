#!/usr/bin/env bash
# Hardens the office server for Lexora (ADR 0006). Ubuntu Server 24.04 LTS,
# run once as root after Docker is installed, from the Lexora folder:
#
#   sudo OFFICE_SUBNET=192.168.1.0/24 LAN_INTERFACE=enp3s0 \
#        ADMIN_IP=192.168.1.20 SSH_USER=lexadmin infra/server/harden.sh
#
# What it does (each step is idempotent):
# - automatic security updates;
# - SSH: keys only, no root login, only SSH_USER, from ADMIN_IP only (firewall);
# - ufw: deny all incoming except 443 and 80 from the office subnet and SSH
#   from the administrator's machine;
# - DOCKER-USER chain: Docker's own rules bypass ufw, so traffic forwarded
#   to containers is filtered here too (only 443/80 from the office subnet);
# - Docker daemon defaults: no new privileges, log rotation, live restore;
# - the nightly backup timer (systemd), see infra/server/systemd.
#
# Check the result with the port scans in docs/operations/server-setup.md.
set -Eeuo pipefail

: "${OFFICE_SUBNET:?set OFFICE_SUBNET, e.g. 192.168.1.0/24}"
: "${LAN_INTERFACE:?set LAN_INTERFACE (ip -br link), e.g. enp3s0}"
: "${ADMIN_IP:?set ADMIN_IP, the administrator machine allowed to use SSH}"
: "${SSH_USER:?set SSH_USER, the only account allowed to log in over SSH}"
here="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo)" >&2
  exit 1
fi
if [ ! -s "/home/$SSH_USER/.ssh/authorized_keys" ]; then
  echo "refusing: /home/$SSH_USER/.ssh/authorized_keys is empty; password logins are about to be turned off" >&2
  exit 1
fi

echo "== Automatic security updates"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades ufw restic
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "== SSH: keys only"
cat >/etc/ssh/sshd_config.d/50-lexora.conf <<EOF
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
AllowTcpForwarding no
MaxAuthTries 3
AllowUsers $SSH_USER
EOF
sshd -t
systemctl reload ssh

echo "== Firewall (ufw)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow in on "$LAN_INTERFACE" from "$ADMIN_IP" to any port 22 proto tcp comment "SSH from the administrator"
ufw allow in on "$LAN_INTERFACE" from "$OFFICE_SUBNET" to any port 443 proto tcp comment "Lexora HTTPS"
ufw allow in on "$LAN_INTERFACE" from "$OFFICE_SUBNET" to any port 80 proto tcp comment "Lexora redirect to HTTPS"

echo "== DOCKER-USER chain (traffic to containers)"
# Rules ufw loads at start, after its own. Packets to containers have already
# been translated to the container's port, so the original port is matched
# through connection tracking.
marker="# --- Lexora DOCKER-USER rules ---"
if ! grep -qF "$marker" /etc/ufw/after.rules; then
  cat >>/etc/ufw/after.rules <<EOF

$marker
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
-A DOCKER-USER -i $LAN_INTERFACE -s $OFFICE_SUBNET -p tcp -m conntrack --ctorigdstport 443 -j RETURN
-A DOCKER-USER -i $LAN_INTERFACE -s $OFFICE_SUBNET -p tcp -m conntrack --ctorigdstport 80 -j RETURN
-A DOCKER-USER -i $LAN_INTERFACE -j DROP
-A DOCKER-USER -j RETURN
COMMIT
EOF
fi
ufw --force enable
ufw status verbose

echo "== Docker daemon defaults"
install -d -m 755 /etc/docker
if [ ! -s /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'EOF'
{
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false,
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
  systemctl restart docker
else
  echo "kept existing /etc/docker/daemon.json: check it matches docs/operations/server-setup.md"
fi

echo "== Nightly backup timer"
install -m 644 "$here/systemd/lexora-backup.service" /etc/systemd/system/
install -m 644 "$here/systemd/lexora-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lexora-backup.timer
systemctl list-timers lexora-backup.timer --no-pager

echo "Done. Now run the port scans in docs/operations/server-setup.md (section 'Prove it')."
