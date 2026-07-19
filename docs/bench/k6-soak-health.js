import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const errorRate = new Rate('errors');

// Default 10m soak @ 100 VU (plan allows 100–200; full 30m via SOAK_DURATION=30m)
const DURATION = __ENV.SOAK_DURATION || '10m';
const VUS = Number(__ENV.SOAK_VUS || 100);

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:20128';

export default function () {
  const res = http.get(`${BASE}/api/health`, { timeout: '10s' });
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'ok true': (r) => {
      try {
        return r.json('ok') === true;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
  sleep(0.05);
}

export function handleSummary(data) {
  const out = __ENV.K6_SUMMARY_PATH || '/tmp/k6-soak-health.json';
  return {
    [out]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
