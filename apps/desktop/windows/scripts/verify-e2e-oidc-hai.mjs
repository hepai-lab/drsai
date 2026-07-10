process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER ||= "http://localhost:8081/api";
process.env.OPENDRSAI_E2E_OIDC_USE_SOURCE ||= "1";

await import("./verify-e2e-oidc-login.mjs");
