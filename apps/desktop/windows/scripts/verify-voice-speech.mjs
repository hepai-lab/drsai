import assert from "node:assert/strict";
import { prepareTextForSpeech, selectSpeechVoice } from "../src/renderer/src/voice/voiceSpeech.ts";

assert.equal(
  prepareTextForSpeech("## 标题\n\n- **第一项**\n- [第二项](https://example.com)\n```ts\nconst hidden = true;\n```"),
  "标题 第一项 第二项",
);
assert.equal(prepareTextForSpeech("`npm test` ~~完成~~"), "npm test 完成");
assert.equal(prepareTextForSpeech("![图](image.png)"), "");

const voices = [
  { name: "Remote zh", lang: "zh-CN", localService: false, default: true },
  { name: "Local zh", lang: "zh-CN", localService: true, default: false },
  { name: "English", lang: "en-US", localService: true, default: true },
];
assert.equal(selectSpeechVoice(voices, "zh")?.name, "Local zh");
assert.equal(selectSpeechVoice(voices, "zh", "Remote zh")?.name, "Remote zh");
assert.equal(selectSpeechVoice(voices, "en")?.name, "English");
assert.equal(selectSpeechVoice([], "zh"), null);

console.log("Voice speech verification passed (7 checks).");
