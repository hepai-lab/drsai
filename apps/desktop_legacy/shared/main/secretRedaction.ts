import { redactSensitiveData } from "../api/sensitiveData";

const SECRET_PATTERNS: RegExp[] = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\b((?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|registration[_-]?token|access[_-]?grant[_-]?code|password|message|prompt|command|arguments|b64_json|content_base64|data_url|image_base64)\s*[:=]\s*)[^\s,;&]+/gi,
  /([?&](?:code|token|access_token|refresh_token|id_token|client_secret|state)=)[^&#\s]+/gi,
  /(\"(?:authorization|x-api-key|api_key|access_token|refresh_token|id_token|client_secret|registration_token|access_grant_code|password|message|prompt|command|arguments|b64_json|content_base64|data_url|image_base64)\"\s*:\s*\")[^\"]+/gi,
];

export function redactDesktopSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "$1[REDACTED]");
  return redactSensitiveData(redacted, { includePersonal: false });
}

export function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "[REDACTED]");
    url.hash = "";
    return url.toString();
  } catch { return redactDesktopSecrets(value); }
}
