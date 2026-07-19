# Runbook — Deploy 9router-mw

## Preconditions

- User `router`, dirs `/opt/9router-mw`, `/var/lib/9router-mw`, `/etc/9router-mw`
- Redis `9router-mw-redis` on `127.0.0.1:6381` (password in `/etc/9router-mw/env`)
- Volume `/var/lib/9router-mw/redis` owned **999:999** (Redis container UID)
- DNS `example.com` → VPS (Cloudflare; optional grey-cloud for long SSE)

## Deploy new release

1. Push to `origin/master` (or tag).
2. On VPS as root, use phase deploy scripts:
 - F6 pattern: `docs/deploy/f6-deploy-hotpath.sh` with `RELEASE_ID=0.5.35-mw.N`
3. Verify:
 - `systemctl is-active 9router-mw`
 - `curl -s http://127.0.0.1:20128/api/health` → `ok`, 4 workers, redis ok, hotpath undici+wal
 - Foreign redis 6379/6380 still healthy

## Env keys (no secrets in git)

See `docs/deploy/env.example`. Required prod:

- `WORKERS=4`, `HOSTNAME=127.0.0.1`, `PORT=20128`
- `REDIS_*` port **6381 only**
- `LOG_LEVEL=warn`, `ENABLE_REQUEST_LOGS=false`
- `NODE_OPTIONS=--dns-result-order=ipv4first`
- `MW_REQUIRE_NATIVE_SQLITE=1`

## Never

- Touch ggl/app redis
- Open 20128/6381 publicly
- Enable MITM in production
