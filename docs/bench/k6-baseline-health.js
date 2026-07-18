import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration');

export const options = {
  scenarios: {
    baseline_single: {
      executor: 'constant-vus',
      vus: 20,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:20128';

export default function () {
  const res = http.get(`${BASE}/api/health`);
  healthDuration.add(res.timings.duration);
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'body ok': (r) => r.body && r.body.includes('"ok":true'),
  });
  errorRate.add(!ok);
  sleep(0.05);
}

export function handleSummary(data) {
  return {
    '/tmp/k6-baseline-single.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
