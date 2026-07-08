#!/usr/bin/env bash
set -euo pipefail

service_name="tailscale-port-dashboard.user.service"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_dir="$(cd "${script_dir}/.." && pwd)"
bun_bin="$(command -v bun)"
unit_dir="${HOME}/.config/systemd/user"

mkdir -p "${unit_dir}"
cat >"${unit_dir}/${service_name}" <<UNIT
[Unit]
Description=Tailscale port dashboard user service
After=default.target

[Service]
Type=simple
WorkingDirectory=${service_dir}
Environment=PORT=8080
ExecStart=${bun_bin} run start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable "${service_name}"
systemctl --user restart "${service_name}"

tailscale_ip="$(tailscale ip -4 | sed -n '1p')"
for _ in {1..20}; do
  if curl -fsS "http://${tailscale_ip}:8080/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

systemctl --user --no-pager --full status "${service_name}"
