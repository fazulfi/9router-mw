# Deploy — 9router-mw

Deployment artifacts and templates (no live secrets).

## Targets

| Item | Value |
| ---- | ----- |
| VPS | root@82.25.62.204 |
| App user | router |
| App dir | /opt/9router-mw |
| Data | /var/lib/9router-mw |
| Config | /etc/9router-mw |
| Bind | 127.0.0.1:20128 |
| Workers | always 4 via cluster.fork |
| Redis | 127.0.0.1:6381 (Docker dedicated) |
| Domain | router.budgezen.com |

## Contents (planned)

- systemd unit templates
- nginx site snippet
- env example (no secrets)
- install / update scripts
