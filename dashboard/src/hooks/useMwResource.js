import { useCallback, useEffect, useState } from "react";
import { mapPageViewState } from "../lib/state.js";

/**
 * Generic GET resource loader for MW pages.
 * @param {(opts: { signal?: AbortSignal }) => Promise<object>} fetcher
 * @param {unknown[]} [deps]
 */
export function useMwResource(fetcher, deps = []) {
  const [loadState, setLoadState] = useState("loading");
  const [result, setResult] = useState(null);

  const reload = useCallback(
    async (signal) => {
      setLoadState("loading");
      try {
        const next = await fetcher({ signal });
        if (signal?.aborted) return;
        setResult(next);
        setLoadState("ready");
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (signal?.aborted) return;
        setResult({
          ok: false,
          kind: "error",
          message: err?.message || "Failed to load",
          data: null,
          empty: true,
          degraded: false,
        });
        setLoadState("ready");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  const view = mapPageViewState(result, loadState);

  return {
    loadState,
    result,
    data: result?.data ?? null,
    view,
    reload: () => reload(),
  };
}
