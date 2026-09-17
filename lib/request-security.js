import helmet from "helmet";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createSecurityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        styleSrcElem: ["'self'"],
        styleSrcAttr: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
  });
}

function requestOrigin(req) {
  const value = req.get("origin");
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return "invalid";
  }
}

function expectedOrigin(req) {
  const host = req.get("host");
  if (!host) return "invalid";
  try {
    return new URL(`${req.protocol}://${host}`).origin;
  } catch {
    return "invalid";
  }
}

/**
 * Same-origin write guard for the cookie-authenticated browser API.
 * Non-browser clients without Origin/Fetch Metadata remain supported; browsers
 * that send either signal cannot submit a cross-site state-changing request.
 */
export function requireSameOriginForWrites(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const fetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  const origin = requestOrigin(req);
  const crossSite = fetchSite === "cross-site" || (origin !== null && origin !== expectedOrigin(req));
  if (!crossSite) return next();
  res.set("Cache-Control", "no-store");
  return res.status(403).json({
    error: "A origem da requisição não é permitida.",
    code: "CSRF_ORIGIN_MISMATCH",
  });
}
