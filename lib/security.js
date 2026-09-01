export const contentSecurityPolicyDirectives = Object.freeze({
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  connectSrc: ["'self'", "https://api.mercadolibre.com"],
  fontSrc: ["'self'", "data:"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  imgSrc: ["'self'", "data:", "https:"],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  styleSrcElem: ["'self'"],
  styleSrcAttr: ["'none'"],
});
