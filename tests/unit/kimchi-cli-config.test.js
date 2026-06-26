import { describe, it, expect } from "vitest";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

// Aligned to the official Kimchi CLI catalog: https://models.dev/api.json (provider moonshotai)
describe("Kimchi CLI-aligned config", () => {
  describe("upstream model id", () => {
    it("keeps user-facing Kimi ids unchanged for upstream llm.kimchi.dev", () => {
      expect(getModelUpstreamId("kimchi", "kimi-k2.7")).toBe("kimi-k2.7");
      expect(getModelUpstreamId("kimchi", "kimi-k2.6")).toBe("kimi-k2.6");
      expect(getModelUpstreamId("kimchi", "kimi-k2.5")).toBe("kimi-k2.5");
    });
  });

  describe("capabilities", () => {
    it("kimi-k2.7 inherits kimi-k2.7-code caps from CLI", () => {
      const caps = getCapabilitiesForModel("kimchi", "kimi-k2.7");
      expect(caps.vision).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("kimi");
      expect(caps.thinkingCanDisable).toBe(false);
      expect(caps.contextWindow).toBe(262144);
      expect(caps.maxOutput).toBe(262144);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.supportsTemperature).toBe(false);
    });

    it("kimi-k2.6 matches CLI (toggle + temperature supported)", () => {
      const caps = getCapabilitiesForModel("kimchi", "kimi-k2.6");
      expect(caps.vision).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingCanDisable).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.supportsTemperature).toBe(true);
    });

    it("kimi-k2.5 matches CLI (no temperature, toggle supported)", () => {
      const caps = getCapabilitiesForModel("kimchi", "kimi-k2.5");
      expect(caps.vision).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingCanDisable).toBe(true);
      expect(caps.structuredOutput).toBe(true);
      expect(caps.supportsTemperature).toBe(false);
    });

    it("preview/thinking models have CLI context/output limits", () => {
      const c0711 = getCapabilitiesForModel("kimchi", "kimi-k2-0711-preview");
      expect(c0711.contextWindow).toBe(131072);
      expect(c0711.maxOutput).toBe(16384);
    });
  });

  describe("param stripping", () => {
    it("keeps temperature for kimi-k2.6", () => {
      const body = { temperature: 0.7, messages: [] };
      stripUnsupportedParams("kimchi", "kimi-k2.6", body);
      expect(body.temperature).toBe(0.7);
    });

    it("drops temperature for kimi-k2.5", () => {
      const body = { temperature: 0.7, messages: [] };
      stripUnsupportedParams("kimchi", "kimi-k2.5", body);
      expect(body.temperature).toBeUndefined();
    });

    it("drops temperature for kimi-k2.7 (CLI temperature:false)", () => {
      const body = { temperature: 0.7, messages: [] };
      stripUnsupportedParams("kimchi", "kimi-k2.7", body);
      expect(body.temperature).toBeUndefined();
    });

    it("drops temperature for kimi-k2.7-code-highspeed", () => {
      const body = { temperature: 0.7, messages: [] };
      stripUnsupportedParams("kimchi", "kimi-k2.7-code-highspeed", body);
      expect(body.temperature).toBeUndefined();
    });

    it("still drops non-temperature sampling knobs for all Kimchi models", () => {
      const body = { top_p: 0.9, presence_penalty: 0.5, frequency_penalty: 0.5, messages: [] };
      stripUnsupportedParams("kimchi", "kimi-k2.6", body);
      expect(body.top_p).toBeUndefined();
      expect(body.presence_penalty).toBeUndefined();
      expect(body.frequency_penalty).toBeUndefined();
    });
  });
});
