import { strict as assert } from "node:assert";
import {
  MACOS_UPDATE_CDN_URL,
  MACOS_UPDATE_GITHUB_OWNER,
  MACOS_UPDATE_GITHUB_REPO,
  validateFallbackCandidate,
  validateHttpsUpdateFeed,
  runtimeMetadataMatchesInstalled,
} from "../src/main/updateFeedPolicy.ts";

assert.equal(MACOS_UPDATE_CDN_URL, "https://download-opendrsai.ihep.ac.cn/channels/stable/macos/arm64/");
assert.equal(MACOS_UPDATE_GITHUB_OWNER, "hepai-lab");
assert.equal(MACOS_UPDATE_GITHUB_REPO, "drsai");
assert.equal(validateHttpsUpdateFeed(MACOS_UPDATE_CDN_URL), MACOS_UPDATE_CDN_URL);
assert.throws(() => validateHttpsUpdateFeed("http://download-opendrsai.ihep.ac.cn/"));
assert.throws(() => validateHttpsUpdateFeed("https://user:secret@download-opendrsai.ihep.ac.cn/"));
assert.throws(() => validateHttpsUpdateFeed("https://example.invalid/", "download-opendrsai.ihep.ac.cn"));
validateFallbackCandidate({ version: "1.5.2", sha512: "same" }, { version: "1.5.2", sha512: "same" });
validateFallbackCandidate({ version: "1.5.2", sha512: null }, { version: "1.5.2", sha512: "fallback" });
assert.throws(() => validateFallbackCandidate({ version: "1.5.2", sha512: "a" }, { version: "1.5.3", sha512: "a" }), /selected CDN version/);
assert.throws(() => validateFallbackCandidate({ version: "1.5.2", sha512: "a" }, { version: "1.5.2", sha512: "b" }), /digests differ/);
const runtimeSha = "a".repeat(64);
assert.equal(runtimeMetadataMatchesInstalled({ opendrsaiRuntimeVersion: "1.5.2", opendrsaiRuntimeSha256: runtimeSha }, { version: "1.5.2", archiveSha256: runtimeSha, healthy: true }), true);
assert.equal(runtimeMetadataMatchesInstalled({ opendrsaiRuntimeVersion: "1.5.2", opendrsaiRuntimeSha256: runtimeSha }, { version: "1.5.1", archiveSha256: runtimeSha, healthy: true }), false);
assert.equal(runtimeMetadataMatchesInstalled({ opendrsaiRuntimeVersion: "1.5.2", opendrsaiRuntimeSha256: "invalid" }, { version: "1.5.2", archiveSha256: "invalid", healthy: true }), false);
assert.equal(runtimeMetadataMatchesInstalled({}, { version: "1.5.2", archiveSha256: runtimeSha, healthy: true }), false);
assert.equal(runtimeMetadataMatchesInstalled({ opendrsaiRuntimeVersion: "1.5.2", opendrsaiRuntimeSha256: runtimeSha }, { version: "1.5.2", archiveSha256: runtimeSha, healthy: false }), false);

console.log("macOS update feed policy verification passed.");
