process.env.OPENDRSAI_E2E_OIDC_EXTERNAL_ISSUER ||= "https://ai-dev.ihep.ac.cn/api";
process.env.OPENDRSAI_OIDC_DISCOVERY_URL ||= "https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration";
process.env.OPENDRSAI_E2E_OIDC_USE_SOURCE ||= "1";
process.env.OPENDRSAI_E2E_OIDC_INTERACTIVE ||= "1";

await import("./verify-e2e-oidc-login.mjs");
