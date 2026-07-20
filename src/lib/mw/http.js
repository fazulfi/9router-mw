/**
 * Generic JSON helpers for MW dashboard API — never leak raw stack/Redis/SQLite messages.
 */

export function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
}

export function unauthorizedJson() {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

export function serviceUnavailableJson(message = "Service unavailable") {
  return jsonResponse({ error: message }, 503);
}

export function failedToLoadJson(message = "Failed to load") {
  return jsonResponse({ error: message }, 500);
}

export function badRequestJson(message = "Bad request") {
  return jsonResponse({ error: message }, 400);
}
