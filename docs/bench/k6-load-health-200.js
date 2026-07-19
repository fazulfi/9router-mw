import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const errorRate = new Rate('errors');
const ttfb = new Trend('ttfb');

export const options = {
  scenarios: {
    ramp_200: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '30s', target: 200 },
        { duration: '2m', target: 200 }, // hold
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:20128';

export default function () {
  const res = http.get(`${BASE}/api/health`, { timeout: '10s' });
  ttfb.add(res.timings.waiting);
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'ok true': (r) => {
      try {
        return r.json('ok') === true;
      } catch {
        return false;
      }
    },
    'has workerId': (r) => {
      try {
        return r.json('workerId') != null;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
  sleep(0.02);
}

export function handleSummary(data) {
  const out = __ENV.K6_SUMMARY_PATH || '/tmp/k6-load-health-200.json';
  return {
    [out]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
