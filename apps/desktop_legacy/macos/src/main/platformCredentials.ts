import { createNativeMacosCredentialService } from "./native/nativeCredentialService";
import { createLegacyMacosCredentialService } from "./native/legacyCredentialService";
import { nativeHelperExecutablePath } from "./native/nativeHelperPath";
export { createLegacyMacosCredentialService as createMacosCredentialService } from "./native/legacyCredentialService";

const LEGACY_MACOS_CREDENTIAL_SERVICE = createLegacyMacosCredentialService();
export const MACOS_CREDENTIAL_SERVICE = createNativeMacosCredentialService({
  helperPath: nativeHelperExecutablePath,
  fallback: LEGACY_MACOS_CREDENTIAL_SERVICE,
});
