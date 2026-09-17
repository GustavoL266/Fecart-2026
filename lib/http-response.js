const DEFAULT_MAX_BYTES = 100_000;

export class ResponseBodyError extends Error {
  constructor(code) {
    super(code === "RESPONSE_TOO_LARGE" ? "Response body exceeded the configured limit." : "Response body is not valid JSON.");
    this.name = "ResponseBodyError";
    this.code = code;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export async function readLimitedJsonResponse(response, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    void response.body?.cancel?.().catch(() => {});
    throw new ResponseBodyError("RESPONSE_TOO_LARGE");
  }

  const reader = response.body?.getReader?.();
  let text = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) throw new ResponseBodyError("RESPONSE_TOO_LARGE");
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else if (typeof response.text === "function") {
    text = await response.text();
    if (byteLength(text) > maxBytes) throw new ResponseBodyError("RESPONSE_TOO_LARGE");
  } else if (typeof response.json === "function") {
    // Test doubles and older fetch-compatible clients may not expose a stream.
    return response.json();
  } else {
    throw new ResponseBodyError("INVALID_JSON_RESPONSE");
  }

  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    throw new ResponseBodyError("INVALID_JSON_RESPONSE");
  }
}
