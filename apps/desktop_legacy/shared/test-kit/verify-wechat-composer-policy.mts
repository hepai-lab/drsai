import assert from "node:assert/strict";
import { decideWeChatComposerSubmit } from "../renderer/src/wechatComposerPolicy.ts";

const base = { channelSource: "wechat" as const, available: true, sending: false, hasText: true };
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "keyboard", confirmed: false }), "blocked");
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "keyboard", confirmed: true }), "blocked");
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "button", confirmed: false }), "request_confirmation");
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "button", confirmed: true }), "send_external");
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "button", confirmed: true, available: false }), "blocked");
assert.equal(decideWeChatComposerSubmit({ ...base, trigger: "button", confirmed: true, hasText: false }), "blocked");
assert.equal(decideWeChatComposerSubmit({ ...base, channelSource: undefined, trigger: "keyboard", confirmed: false }), "ordinary_submit");

console.log("WeChat composer explicit-send safety policy passed.");
