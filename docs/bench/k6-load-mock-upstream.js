import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.4/index.js';

const errorRate = new Rate('errors');
const posts = new Counter('mock_posts');

export const options = {
  scenarios: {
    mock_100: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

const MOCK = __ENV.MOCK_URL || 'http://127.0.0.1:18080';

export default function () {
  const res = http.post(
    `${MOCK}/v1/chat/completions`,
    JSON.stringify({
      model: 'mock',
      messages: [{ role: 'user', content: 'ping' }],
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    },
  );
  posts.add(1);
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has choices': (r) => r.body && r.body.includes('choices'),
  });
  errorRate.add(!ok);
  sleep(0.01);
}

export function handleSummary(data) {
  const out = __ENV.K6_SUMMARY_PATH || '/tmp/k6-load-mock-upstream.json';
  return {
    [out]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
