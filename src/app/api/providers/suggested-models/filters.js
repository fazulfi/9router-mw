// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// NVIDIA NIM does not return pricing/is_free fields, so whitelist free models
// from the local registry. Source of truth: open-sse/providers/registry/nvidia.js
const NVIDIA_FREE_MODEL_IDS = new Set([
  "minimaxai/minimax-m2.7",
  "minimaxai/minimax-m3",
  "z-ai/glm-5.1",
  "z-ai/glm-5.2",
  "deepseek-ai/deepseek-v4-pro",
  "deepseek-ai/deepseek-v4-flash",
  "moonshotai/kimi-k2.6",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nv-embedqa-e5-v5",
  // Common free-tier NIM models
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.2-3b-instruct",
  "meta/llama-3.3-70b-instruct",
  "google/gemma-2-2b-it",
  "google/gemma-2-9b-it",
  "google/gemma-3-1b-it",
  "google/gemma-3-4b-it",
  "google/gemma-3-12b-it",
  "google/gemma-3-27b-it",
  "google/gemma-3n-e2b-it",
  "google/gemma-3n-e4b-it",
  "mistralai/mistral-7b-instruct-v0.3",
  "mistralai/mistral-nemo-12b-2x1",
  "mistralai/mixtral-8x7b-instruct-v0.1",
  "microsoft/phi-3-medium-4k-instruct",
  "microsoft/phi-3-small-8k-instruct",
  "microsoft/phi-3-mini-4k-instruct",
]);

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .reduce((acc, m) => {
        if (m.pricing?.prompt === "0" && m.pricing?.completion === "0" && m.context_length >= 200000) {
          acc.push({ id: m.id, name: m.name, contextLength: m.context_length });
        }
        return acc;
      }, [])
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models.reduce((acc, m) => {
      if (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) {
        acc.push({ id: m.id, name: m.id });
      }
      return acc;
    }, []),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : []).reduce((acc, m) => {
      if (m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo")) {
        acc.push({ id: m.id, name: m.name || m.id });
      }
      return acc;
    }, []),

  // NVIDIA NIM: filter only free-tier models by ID whitelist.
  // The NVIDIA /v1/models endpoint does not expose pricing/is_free fields,
  // so we cannot filter server-side. Whitelist is the source of truth.
  "nvidia": (models) =>
    (Array.isArray(models) ? models : []).reduce((acc, m) => {
      if (m.id && NVIDIA_FREE_MODEL_IDS.has(m.id)) {
        acc.push({ id: m.id, name: m.id });
      }
      return acc;
    }, []),
};
