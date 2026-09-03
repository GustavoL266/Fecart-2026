const DIAGNOSTIC_URL = "https://api.fiscalhub.com.br/api/v1/ncm/84713012";

function resultForStatus(status) {
  if (status >= 200 && status < 300) {
    return { configured: true, provider: "FiscalHub", status, authorized: true };
  }
  if (status === 401) {
    return { configured: true, provider: "FiscalHub", status, authorized: false, error: "UNAUTHORIZED" };
  }
  if (status === 403) {
    return { configured: true, provider: "FiscalHub", status, authorized: true, permission: false, error: "FORBIDDEN" };
  }
  const error = status === 400
    ? "BAD_REQUEST"
    : status === 404
      ? "NOT_FOUND"
      : status >= 500
        ? "UPSTREAM_ERROR"
        : "UNEXPECTED_STATUS";
  return { configured: true, provider: "FiscalHub", status, authorized: null, error };
}

// TEMPORARY DIAGNOSTIC: remove this file and the marked route/import in server.js after validation.
export async function diagnoseFiscalHub({
  apiKey = process.env.FISCALHUB_API_KEY,
  fetchImpl = globalThis.fetch,
  logger = console,
  timeoutMs = 10_000,
} = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  const configured = normalizedApiKey.length > 0;
  logger.info?.(`[FiscalHub Diagnostic] configured=${configured}`);
  if (!configured) return { configured: false, provider: "FiscalHub", status: null };

  try {
    const response = await fetchImpl(DIAGNOSTIC_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Api-Key": normalizedApiKey,
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    logger.info?.(`[FiscalHub Diagnostic] status=${response.status}`);
    return resultForStatus(response.status);
  } catch (error) {
    const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    logger.info?.("[FiscalHub Diagnostic] status=null");
    return {
      configured: true,
      provider: "FiscalHub",
      status: null,
      authorized: null,
      error: isTimeout ? "TIMEOUT" : "UNAVAILABLE",
    };
  }
}
