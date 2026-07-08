#!/usr/bin/env bash
set -euo pipefail

service_name="tailscale-port-dashboard.service"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_dir="$(cd "${script_dir}/.." && pwd)"
bun_bin="$(command -v bun)"
service_user="${SUDO_USER:-${USER}}"
unit_file="$(mktemp)"

cleanup() {
  rm -f "${unit_file}"
}
trap cleanup EXIT

cat >"${unit_file}" <<UNIT
[Unit]
Description=Tailscale port dashboard
After=network-online.target tailscaled.service
Wants=network-online.target tailscaled.service
Requires=tailscaled.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=${service_user}
WorkingDirectory=${service_dir}
Environment=PORT=80
Environment=REQUIRE_TAILSCALE_BIND=true
ExecStart=${bun_bin} run start
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT

sudo install -m 0644 "${unit_file}" "/etc/systemd/system/${service_name}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${service_name}"
sudo systemctl --no-pager --full status "${service_name}"
