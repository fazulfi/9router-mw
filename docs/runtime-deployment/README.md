# Runtime staging and promotion SOP

Use this runbook for every runtime feature merged from an upstream pull
request. The release is built once on the VPS, tested with isolated staging
resources, and promoted without moving the production consumer endpoint.

## Invariants

- All install and build commands run on the VPS. Never build a staging or
  production artifact on a workstation.
- Production clients always use `127.0.0.1:20128`.
- Staging uses `127.0.0.1:20130` and isolated Redis on `127.0.0.1:6383`.
- Production Redis remains on `127.0.0.1:6381`.
- Nginx owns the stable production listener on port `20128`.
- Runtime slots `20131` and `20132` are private backends. They must never be
  written to bot or provider configuration.
- Promotion copies the exact artifact tested in staging. It never rebuilds.
- Production is never restarted in place during promotion.
- Staging intentionally clones the production database (read-only snapshot) and
  reuses `API_KEY_SECRET` so that authenticated provider smoke tests reproduce the
  exact execution path of real user requests. Staging has its own secrets for all
  other purposes, uses isolated Redis and port, and never writes to production data.
- Deployment must not restart or prune unrelated services or containers.

## One-time topology bootstrap

Zero downtime with a fixed production endpoint requires Nginx to own port
`20128`, with the Node runtime behind it on private slot `20131` or `20132`.
Run the bootstrap once on the VPS during an approved deployment window:

```bash
sudo .docs/runtime-deployment/bootstrap-fixed-runtime-proxy.sh
```

The bootstrap starts the currently deployed artifact on slot `20131`, verifies
all four workers, preserves local traffic with a temporary loopback redirect,
moves the `20128` listener from Node to Nginx, verifies the stable endpoint,
and removes the redirect. It rolls back automatically if any gate fails.

Do not run the normal workflow until all of these are true:

```bash
sudo .docs/runtime-deployment/runtime-release.sh status
sudo ss -ltnp | grep ':20128'
sudo systemctl is-active nginx
curl -fsS http://127.0.0.1:20128/api/health
```

The process owning `20128` must be Nginx. A healthy Node runtime must own one
private slot.

## Release eligibility

A release may use this workflow only when:

1. The upstream change is integrated into the MW fork.
2. An immutable tag or full 40-character commit SHA identifies the source.
3. Old and new versions may safely overlap against the production database.
4. Database changes follow an expand/contract migration sequence.
5. Rollback does not require discarding valid writes made by the new version.
6. A feature-specific staging acceptance test is defined before promotion.
7. The authenticated provider smoke test (reproducing a real user request through
   the exact handler path) passes in staging, candidate, and stable endpoint.

A destructive or one-way migration requires a separate maintenance plan.
Never pass a floating branch name to the deployment script.

## Standard workflow

### 1. Record the release

Record the upstream PR, MW integration commit, immutable source ref, expected
behavior, migration assessment, and feature-specific acceptance test.

### 2. Preflight production

Run on the VPS:

```bash
sudo .docs/runtime-deployment/runtime-release.sh status
```

Stop if production is not green. The health contract requires:

- `ok: true` and exactly four workers;
- worker IDs 1, 2, 3, and 4 observed across repeated requests;
- Redis connected and ready;
- Undici enabled;
- `better-sqlite3` with WAL journal mode;
- Nginx, active runtime, and configured gateway services active.

### 3. Build isolated staging on the VPS

```bash
sudo .docs/runtime-deployment/runtime-release.sh stage <tag-or-full-commit-sha>
```

The command fetches the immutable ref into
`/opt/9router-mw-staging/builds`, runs `npm install` and `npm run build` there,
assembles an immutable standalone artifact, records its commit and SHA-256,
generates staging-only credentials, and starts isolated staging on port
`20130` with Redis on `6383`.

No build output from a local workstation is accepted by this workflow.

### 4. Test and approve staging

The build output automatically gates on:
- Health contract (`ok:true`, 4 workers, Redis OK/ready, undici, better-sqlite3/WAL)
- All four unique worker IDs sampled across 300 requests
- Authenticated provider request through the exact handler path (uses cloned
  production database and shared `API_KEY_SECRET`, read-only)

Verify manually after automated gates pass:

```bash
sudo .docs/runtime-deployment/runtime-release.sh status
```

Record approval only after automated and manual evidence passes:

```bash
sudo .docs/runtime-deployment/runtime-release.sh approve <release-id> '<evidence-reference>'
```

### 5. Promote the tested artifact

```bash
sudo .docs/runtime-deployment/runtime-release.sh promote <release-id>
```

Promotion performs these gates in order:

1. Revalidate staging health, worker IDs, authenticated provider smoke, approval,
   and artifact checksum.
2. Revalidate the current production endpoint.
3. Create an online SQLite backup.
4. Copy the exact staged artifact into an immutable production release path.
5. Start it on the inactive private runtime slot with production configuration.
6. Validate the candidate directly, including all four worker IDs and an
   authenticated provider request against the candidate.
7. Atomically switch the Nginx upstream and run `nginx -t` before reload.
8. Validate repeated requests through stable endpoint `20128` and run an
   authenticated provider request through the stable endpoint.
9. Drain and stop the previous runtime only after all gates pass.
10. Run one final authenticated provider request through the stable endpoint.

Hiyuki, Suisui, and other consumers remain on port `20128` throughout.

### 6. Observe

Observe for at least five minutes:

```bash
sudo .docs/runtime-deployment/runtime-release.sh status
sudo journalctl -u '9router-mw-slot@*.service' --since '-5 minutes' --no-pager
sudo journalctl -u wwma-gateway-hiyuki.service --since '-5 minutes' --no-pager
sudo journalctl -u wwma-gateway-suisui.service --since '-5 minutes' --no-pager
```

Require no HTTP 5xx increase, retry storm, repeated database locks, or broken
streams. When provider behavior changed, complete one authenticated minimal
request through the stable endpoint without printing credentials.

### 7. Clean staging

After the observation window passes:

```bash
sudo .docs/runtime-deployment/runtime-release.sh cleanup <release-id>
```

Keep the previous production artifact and database backup through at least the
next successful observation window.

## Rollback

Promotion automatically restores the previous Nginx upstream and runtime when
a pre-commit gate fails. Manual rollback to the retained slot is:

```bash
sudo .docs/runtime-deployment/runtime-release.sh rollback
```

The script does not restore the database automatically because doing so can
remove valid writes. Escalate if the new version wrote incompatible data.

## Stop conditions

Abort when production preflight, immutable ref resolution, build, staging,
worker sampling, Redis, Undici, SQLite/WAL, acceptance, authenticated provider
smoke (on staging, candidate, OR stable endpoint), candidate health, `nginx -t`,
stable endpoint checks, or gateway health fails.

If the authenticated smoke fails during promotion, rollback is automatic. If it
fails during staging, the release must not be approved.

## Forbidden actions

- Do not build locally and upload build output.
- Do not build under `/opt/9router-mw/releases`.
- Do not restart the active runtime to promote.
- Do not point clients at staging or private runtime slots.
- Do not change bot/provider URLs during deployment.
- Do not overwrite or delete the active release.
- Do not delete the rollback release before observation completes.
- Do not run global Docker prune, volume deletion, or broad process kills.
- Do not report success without command evidence.

## Required deployment record

Retain the source ref and resolved commit, artifact SHA-256, staging acceptance
evidence, database backup path, old and new private slots, `nginx -t` result,
repeated `20128` health result, four observed worker IDs, authenticated smoke
result when applicable, observation result, and retained rollback target.
