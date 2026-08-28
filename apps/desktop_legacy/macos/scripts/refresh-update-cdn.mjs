#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";

const execute = process.argv.includes("--execute");
const channel = requiredArg("--channel");
assert.match(channel, /^(?:beta|stable)$/, "--channel must be beta or stable");
const url = `https://download-opendrsai.ihep.ac.cn/channels/${channel}/macos/arm64/latest-mac.yml`;
const binary = process.env.OPENDRSAI_ALIYUN_BIN?.trim() || "aliyun";
const region = process.env.OPENDRSAI_ALIYUN_REGION?.trim() || "cn-hangzhou";

const plan = {
  schemaVersion: 1,
  service: "cdn",
  operation: "RefreshObjectCaches",
  channel,
  objectType: "File",
  objectPath: url,
  execute,
};
console.log(JSON.stringify(plan, null, 2));
if (!execute) process.exit(0);

assert.ok(process.env.ALIBABA_CLOUD_ACCESS_KEY_ID, "ALIBABA_CLOUD_ACCESS_KEY_ID is required");
assert.ok(process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET, "ALIBABA_CLOUD_ACCESS_KEY_SECRET is required");
const result = spawnSync(
  binary,
  [
    "cdn",
    "RefreshObjectCaches",
    "--ObjectPath",
    url,
    "--ObjectType",
    "File",
    "--Force",
    "true",
    "--secure",
    "--mode",
    "AK",
    "--region",
    region,
  ],
  { encoding: "utf8", env: process.env, timeout: 60_000 },
);
if (result.error || result.status !== 0) {
  throw new Error(`Alibaba Cloud CDN refresh failed: ${(result.stderr || result.stdout || result.error?.message || "no output").trim()}`);
}
const response = JSON.parse(result.stdout);
assert.ok(response.RefreshTaskId, "CDN refresh response omits RefreshTaskId");
console.log(JSON.stringify({ ...plan, refreshTaskId: String(response.RefreshTaskId), requestId: response.RequestId }, null, 2));

function requiredArg(flag) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : null;
  assert.ok(value, `${flag} is required`);
  return value;
}
