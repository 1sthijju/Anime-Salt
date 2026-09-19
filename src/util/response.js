// ==========================================================================
// JSON response helpers — no side effects
// ==========================================================================

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=60",
      "Access-Control-Allow-Origin": "*",
      ...extra,
    },
  });
}

export function jsonSuccess(data, extra = {}) {
  return json({ success: true, data }, 200, extra);
}

export function jsonError(message, status = 500) {
  return json({ success: false, error: message }, status);
}

export function textResponse(body, contentType = "text/plain; charset=utf-8") {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    },
  });
}
