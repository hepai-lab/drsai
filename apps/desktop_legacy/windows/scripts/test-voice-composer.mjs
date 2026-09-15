import assert from "node:assert/strict";
import { insertVoiceTranscript } from "../../shared/renderer/src/voice/voiceComposer.ts";

const cases = [
  { name: "empty", input: "", transcript: "hello", selection: { start: 0, end: 0 }, expected: { value: "hello", cursor: 5 } },
  { name: "line start", input: "world", transcript: "hello ", selection: { start: 0, end: 0 }, expected: { value: "hello world", cursor: 6 } },
  { name: "middle", input: "hello world", transcript: "voice ", selection: { start: 6, end: 6 }, expected: { value: "hello voice world", cursor: 12 } },
  { name: "replace selection", input: "hello old world", transcript: "new", selection: { start: 6, end: 9 }, expected: { value: "hello new world", cursor: 9 } },
  { name: "multiline", input: "first\nthird", transcript: "second\n", selection: { start: 6, end: 6 }, expected: { value: "first\nsecond\nthird", cursor: 13 } },
  { name: "unicode UTF-16 cursor", input: "你好🙂世界", transcript: "，语音", selection: { start: 4, end: 4 }, expected: { value: "你好🙂，语音世界", cursor: 7 } },
  { name: "reversed selection", input: "abcdef", transcript: "X", selection: { start: 4, end: 2 }, expected: { value: "abcdXef", cursor: 5 } },
  { name: "out of range", input: "abc", transcript: "X", selection: { start: 99, end: 100 }, expected: { value: "abcX", cursor: 4 } },
];

for (const testCase of cases) {
  assert.deepEqual(
    insertVoiceTranscript(testCase.input, testCase.transcript, testCase.selection),
    testCase.expected,
    testCase.name,
  );
}

console.log(`Voice composer tests passed (${cases.length} cursor and selection scenarios).`);
