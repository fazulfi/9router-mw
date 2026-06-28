// Comprehensive endpoint tests for ALL service kinds.
// Pass: our side works correctly (200, or proper upstream error like 429/502/503).
// Fail: bug on our side (404 "not available" for listed models, 500, wrong validation).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ensureTestServer, stopTestServer, TEST_API_KEY } from "../helpers/server.js";

// Upstream API calls can be slow — 30s per test
const TIMEOUT = 30000;

const API_KEY = TEST_API_KEY;
const BASE = "http://localhost:3003";
const HEADERS = { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function getAvailableModel(kind) {
  const res = await fetch(`${BASE}/v1/models/${kind}`, { headers: HEADERS });
  const { data } = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0].id : null;
}

beforeAll(async () => {
  await ensureTestServer();
}, 120000);

afterAll(async () => {
  await stopTestServer();
});

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  let parsed = null;
  const text = await res.text();
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, body: parsed, raw: text };
}

async function postForm(path, formData) {
  const h = { Authorization: `Bearer ${API_KEY}` };
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: h, body: formData });
  let parsed = null;
  const text = await res.text();
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, body: parsed, raw: text };
}

// ok = our side works, upstream-error = upstream issue (acceptable),
// our-error = bug on our side (MUST fix)
function classify(status, body) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "upstream-error";
  if (status === 402) return "upstream-error";
  if ([502, 503, 504].includes(status)) return "upstream-error";
  if (status === 401) return "our-error";
  if (status === 403) {
    const msg = body?.error?.message || "";
    if (/not allowed/i.test(msg)) return "our-error";
    return "ok";
  }
  if (status === 404) {
    const msg = body?.error?.message || "";
    if (/not available|Only models listed/i.test(msg)) return "our-error";
    return "upstream-error";
  }
  if (status === 500) {
    const msg = body?.error?.message || "";
    if (/not a function|Cannot read|undefined/i.test(msg)) return "our-error";
    return "upstream-error";
  }
  if (status === 400) return "ok"; // validation error = correct behavior
  return "upstream-error";
}

function assertNotOurError(status, body, label) {
  const c = classify(status, body);
  expect(c, `[${label}] ${status}: ${JSON.stringify(body)?.slice(0, 250)}`).not.toBe("our-error");
}

// ─── Model listing ──────────────────────────────────────────────────
describe("Model listing per kind", () => {
  for (const kind of ["embedding", "image", "tts", "stt", "web"]) {
    it(`GET /v1/models/${kind} returns valid list`, async () => {
      const res = await fetch(`${BASE}/v1/models/${kind}`, { headers: HEADERS });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.object).toBe("list");
      expect(Array.isArray(data.data)).toBe(true);
    });
  }

  it("GET /v1/models without API key → 401", async () => {
    const res = await fetch(`${BASE}/v1/models`);
    expect(res.status).toBe(401);
  });
});

// ─── Embedding ──────────────────────────────────────────────────────
describe("Embedding (/v1/embeddings)", () => {
  it("reachable sample embedding models", async () => {
    const res = await fetch(`${BASE}/v1/models/embedding`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const sample = data.slice(0, 4);
    for (const m of sample) {
      const { status, body } = await post("/v1/embeddings", { model: m.id, input: "The quick brown fox" });
      assertNotOurError(status, body, m.id);
    }
  });

  it("missing input → 400", async () => {
    const sampleModel = await getAvailableModel("embedding");
    if (!sampleModel) return;
    const { status } = await post("/v1/embeddings", { model: sampleModel });
    expect(status).toBe(400);
  });

  it("fake model → 404", async () => {
    const { status } = await post("/v1/embeddings", { model: "fake/model", input: "test" });
    expect(status).toBe(404);
  });
});

// ─── Text to Image (/v1/images/generations) ─────────────────────────
describe("Image (/v1/images/generations)", () => {
  it("reachable sample image models", async () => {
    const sampleModel = await getAvailableModel("image");
    if (!sampleModel) return;
    const { status, body } = await post("/v1/images/generations", {
      model: sampleModel, prompt: "a simple blue circle", n: 1,
    });
    assertNotOurError(status, body, sampleModel);
  }, TIMEOUT);

  it("missing prompt → 400", async () => {
    const sampleModel = await getAvailableModel("image");
    if (!sampleModel) return;
    const { status } = await post("/v1/images/generations", { model: sampleModel });
    expect(status).toBe(400);
  });

  it("fake model → 404", async () => {
    const { status } = await post("/v1/images/generations", { model: "fake/img", prompt: "test" });
    expect(status).toBe(404);
  });
});

// ─── Text to Speech (/v1/audio/speech) ──────────────────────────────
describe("TTS (/v1/audio/speech)", () => {
  it("reachable sample TTS models", async () => {
    const res = await fetch(`${BASE}/v1/models/tts`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const sample = data.filter(m => m.id.startsWith("edge-tts/") || m.id.startsWith("google-tts/")).slice(0, 4);
    for (const m of sample) {
      const { status, body } = await post("/v1/audio/speech", { model: m.id, input: "Hello test" });
      assertNotOurError(status, body, m.id);
    }
  });

  it("missing input → 400", async () => {
    const sampleModel = await getAvailableModel("tts");
    if (!sampleModel) return;
    const { status } = await post("/v1/audio/speech", { model: sampleModel });
    expect(status).toBe(400);
  });

  it("fake model → 404", async () => {
    const { status } = await post("/v1/audio/speech", { model: "fake-tts/voice", input: "test" });
    expect(status).toBe(404);
  });
});

// ─── Speech to Text (/v1/audio/transcriptions) ──────────────────────
describe("STT (/v1/audio/transcriptions)", () => {
  it("reachable sample STT model — no 500 from our side", async () => {
    const sampleModel = await getAvailableModel("stt");
    if (!sampleModel) return;
    const fd = new FormData();
    fd.append("model", sampleModel);
    // Send a tiny silent WAV file (44 bytes header + 0 samples)
    const wav = new Uint8Array(44);
    wav.set([0x52,0x49,0x46,0x46], 0); // RIFF
    wav.set([0x57,0x41,0x56,0x45], 8); // WAVE
    fd.append("file", new Blob([wav], { type: "audio/wav" }), "test.wav");
    const { status, body } = await postForm("/v1/audio/transcriptions", fd);
    // 400/422 from upstream rejecting bad audio is fine, 500 is not
    assertNotOurError(status, body, sampleModel);
  }, TIMEOUT);

  it("missing file → 400", async () => {
    const fd = new FormData();
    fd.append("model", await getAvailableModel("stt") || "gemini/gemini-2.5-flash");
    const { status } = await postForm("/v1/audio/transcriptions", fd);
    expect(status).toBe(400);
  });

  it("missing model → 400", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["x"]), "a.wav");
    const { status } = await postForm("/v1/audio/transcriptions", fd);
    expect(status).toBe(400);
  });
});

// ─── Web Search (/v1/search) ────────────────────────────────────────
describe("Web Search (/v1/search)", () => {
  it("searxng web search", async () => {
    const { status, body } = await post("/v1/search", {
      model: "searxng", query: "What is artificial intelligence?", max_results: 3,
    });
    assertNotOurError(status, body, "searxng-web");
  });

  it("searxng news search", async () => {
    const { status, body } = await post("/v1/search", {
      model: "searxng", query: "latest technology news", search_type: "news", max_results: 3,
    });
    assertNotOurError(status, body, "searxng-news");
  });

  it("missing query → 400", async () => {
    const { status } = await post("/v1/search", { model: "searxng" });
    expect(status).toBe(400);
  });

  it("fake model → 400 or 404", async () => {
    const { status } = await post("/v1/search", { model: "fake/search", query: "test" });
    expect([400, 404]).toContain(status);
  });
});

// ─── Cross-kind: every listed model is reachable ────────────────────
describe("Cross-kind: every listed model reachable", () => {
  it("all embedding models reachable", async () => {
    const res = await fetch(`${BASE}/v1/models/embedding`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    // Sample 5 to avoid rate limits on slow upstream
    const sample = data.slice(0, 5);
    for (const m of sample) {
      const { status, body } = await post("/v1/embeddings", { model: m.id, input: "test" });
      assertNotOurError(status, body, `emb:${m.id}`);
    }
  }, TIMEOUT);

  it("all image models reachable", async () => {
    const res = await fetch(`${BASE}/v1/models/image`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const sample = data.slice(0, 3);
    for (const m of sample) {
      const { status, body } = await post("/v1/images/generations", { model: m.id, prompt: "a dot" });
      assertNotOurError(status, body, `img:${m.id}`);
    }
  }, TIMEOUT);

  it("all TTS edge-tts + google-tts models reachable (sample)", async () => {
    const res = await fetch(`${BASE}/v1/models/tts`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const sample = data.filter(m => m.id.startsWith("edge-tts/") || m.id.startsWith("google-tts/")).slice(0, 8);
    for (const m of sample) {
      const { status, body } = await post("/v1/audio/speech", { model: m.id, input: "hi" });
      assertNotOurError(status, body, `tts:${m.id}`);
    }
  }, TIMEOUT);

  it("all STT models reachable", async () => {
    const res = await fetch(`${BASE}/v1/models/stt`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    const sample = data.slice(0, 3);
    for (const m of sample) {
      const fd = new FormData();
      fd.append("model", m.id);
      const wav = new Uint8Array(44);
      wav.set([0x52,0x49,0x46,0x46], 0);
      wav.set([0x57,0x41,0x56,0x45], 8);
      fd.append("file", new Blob([wav], { type: "audio/wav" }), "t.wav");
      const { status, body } = await postForm("/v1/audio/transcriptions", fd);
      assertNotOurError(status, body, `stt:${m.id}`);
    }
  }, TIMEOUT);

  it("all web search models reachable", async () => {
    const res = await fetch(`${BASE}/v1/models/web`, { headers: HEADERS });
    const { data } = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    for (const m of data) {
      const modelId = m.owned_by || m.id.split("/")[0];
      const { status, body } = await post("/v1/search", { model: modelId, query: "test", max_results: 1 });
      assertNotOurError(status, body, `web:${m.id}`);
    }
  }, TIMEOUT);
});
