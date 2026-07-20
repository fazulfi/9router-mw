import { useEffect, useRef, useState } from "react";
import { buildStreamUrl } from "../lib/api.js";
import { sanitizeRedisSnapshot } from "../lib/sanitize.js";

/**
 * Subscribe to same-origin SSE at /mw/api/v1/stream only.
 * Never opens /api/usage/stream.
 *
 * @param {{ enabled?: boolean }} [options]
 */
export function useDashboardSSE(options = {}) {
  const { enabled = true } = options;
  const [snapshot, setSnapshot] = useState(null);
  const [connection, setConnection] = useState(
    /** @type {'idle'|'connecting'|'open'|'error'|'closed'|'unauthenticated'} */ (
      "idle"
    ),
  );
  const [errorMessage, setErrorMessage] = useState(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      setConnection("idle");
      return undefined;
    }

    if (typeof EventSource === "undefined") {
      setConnection("error");
      setErrorMessage("EventSource is not available in this browser.");
      return undefined;
    }

    const url = buildStreamUrl();
    if (!url.startsWith("/mw/api/v1/stream")) {
      setConnection("error");
      setErrorMessage("Refused non-MW stream URL.");
      return undefined;
    }

    setConnection("connecting");
    setErrorMessage(null);

    const es = new EventSource(url, { withCredentials: true });
    sourceRef.current = es;

    es.onopen = () => {
      setConnection("open");
      setErrorMessage(null);
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setSnapshot(sanitizeRedisSnapshot(parsed));
        setConnection("open");
      } catch {
        // Keep prior snapshot; do not swallow into empty state silently
        setErrorMessage("Received a non-JSON stream frame.");
      }
    };

    es.onerror = () => {
      // EventSource does not expose HTTP status; readyState 2 = CLOSED
      if (es.readyState === EventSource.CLOSED) {
        setConnection("error");
        setErrorMessage(
          "Live stream closed. If you are signed out, open the main dashboard to sign in, then return here.",
        );
      } else {
        setConnection("error");
        setErrorMessage("Live stream interrupted — reconnecting when possible.");
      }
    };

    return () => {
      es.close();
      sourceRef.current = null;
      setConnection("closed");
    };
  }, [enabled]);

  return { snapshot, connection, errorMessage };
}

export default useDashboardSSE;
