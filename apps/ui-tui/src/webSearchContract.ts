/** Frozen public Web Search contract shared with Desktop and Android. */
export const WEB_SEARCH_CONTRACT_SCHEMA = 'opendrsai.web-search/1' as const
export const MANAGED_WEB_SEARCH_MODEL = 'hepai/tavily-web-search-v1' as const
export const WEB_SEARCH_FUNCTIONS = ['search', 'extract'] as const
export const WEB_SEARCH_PROVIDER_MODES = ['auto', 'managed', 'byok', 'none'] as const
export const WEB_SEARCH_ERROR_CODES = [
  'login_required', 'permission_denied', 'rate_limited', 'quota_exhausted',
  'worker_unavailable', 'provider_authentication_failed', 'provider_rate_limited',
  'provider_quota_exhausted', 'provider_timeout', 'provider_unavailable',
  'provider_invalid_response', 'unsafe_web_url', 'invalid_request',
] as const

export type WebSearchErrorCode = typeof WEB_SEARCH_ERROR_CODES[number]
export type WebSearchRecoveryAction = 'login' | 'account_or_byok' | 'retry' | 'retry_or_byok' | 'contact_admin' | 'change_url' | 'edit_request'

const RECOVERY: Readonly<Record<WebSearchErrorCode, { retryable: boolean; action: WebSearchRecoveryAction }>> = {
  login_required: { retryable: false, action: 'login' },
  permission_denied: { retryable: false, action: 'account_or_byok' },
  rate_limited: { retryable: true, action: 'retry' },
  quota_exhausted: { retryable: false, action: 'account_or_byok' },
  worker_unavailable: { retryable: true, action: 'retry_or_byok' },
  provider_authentication_failed: { retryable: false, action: 'contact_admin' },
  provider_rate_limited: { retryable: true, action: 'retry' },
  provider_quota_exhausted: { retryable: false, action: 'contact_admin' },
  provider_timeout: { retryable: true, action: 'retry' },
  provider_unavailable: { retryable: true, action: 'retry' },
  provider_invalid_response: { retryable: true, action: 'retry' },
  unsafe_web_url: { retryable: false, action: 'change_url' },
  invalid_request: { retryable: false, action: 'edit_request' },
}

export function webSearchRecovery(code: string): { retryable: boolean; action: WebSearchRecoveryAction } | null {
  return Object.prototype.hasOwnProperty.call(RECOVERY, code) ? RECOVERY[code as WebSearchErrorCode] : null
}
