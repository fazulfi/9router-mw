import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { CodeBuddyExecutor } = await import("../../open-sse/executors/codebuddy-cn.js");

const credentials = { apiKey: "ck_test" };

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseRequestBody(callIndex) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1].body);
}

describe("CodeBuddy CN executor", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("passes through content-filter 400 response as-is", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: "抱歉，系统检测到您当前输入的信息存在敏感内容，我无法响应您的请求，请检查后重新输入。",
        },
      }, 400));

    const executor = new CodeBuddyExecutor();
    const result = await executor.execute({
      model: "glm-5.2",
      body: {
        model: "glm-5.2",
        messages: [
          { role: "system", content: "danger-full-access secret execution policy" },
          { role: "developer", content: "browser automation policy" },
          { role: "user", content: "tesd" },
        ],
        tools: [{ type: "function", function: { name: "shell", parameters: {} } }],
        stream: true,
      },
      stream: true,
      credentials,
    });

    // No retry logic for 400 responses — passes through as-is
    expect(result.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
