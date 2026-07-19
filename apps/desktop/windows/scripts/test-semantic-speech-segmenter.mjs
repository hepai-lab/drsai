import assert from "node:assert/strict";
const { SemanticSpeechSegmenter, filterSpeakableAssistantText } = await import("../src/renderer/src/voice/streaming/semanticSpeechSegmenter.ts");

const segmenter = new SemanticSpeechSegmenter({ firstMinChars: 5, normalMinChars: 8, maxChars: 40, firstMaxWaitMs: 500 });
assert.deepEqual(segmenter.push("你好，这是", 0), []);
assert.deepEqual(segmenter.push("第一句话。这里是", 100).map((item) => item.text), ["你好，这是第一句话。"]);
assert.deepEqual(segmenter.push("第二句话！", 200).map((item) => item.text), ["这里是第二句话！"]);
assert.deepEqual(segmenter.flush(), []);

const english = new SemanticSpeechSegmenter({ firstMinChars: 5, normalMinChars: 5, maxChars: 80, firstMaxWaitMs: 500 });
const englishSegments = english.push("Dr. Smith measured 3.14 volts. Next sentence! Visit https://example.com/a.b now.", 0);
assert.deepEqual(englishSegments.map((item) => item.text), ["Dr. Smith measured 3.14 volts.", "Next sentence!", "Visit https://example.com/a.b now."]);
assert.deepEqual(english.flush(), []);

const latency = new SemanticSpeechSegmenter({ firstMinChars: 4, normalMinChars: 10, maxChars: 50, firstMaxWaitMs: 300 });
latency.push("short phrase", 0);
assert.deepEqual(latency.poll(299), []);
assert.equal(latency.poll(300)[0].text, "short phrase");

const long = new SemanticSpeechSegmenter({ firstMinChars: 5, normalMinChars: 5, maxChars: 20, firstMaxWaitMs: 100 });
const longSegments = long.push("one two three four five six seven eight", 0);
assert.ok(longSegments[0].text.length <= 20);
assert.equal([...longSegments, ...long.flush()].map((item) => item.text).join(" "), "one two three four five six seven eight");

assert.equal(filterSpeakableAssistantText("Visible. ```json\n{\"secret\":1}\n``` End."), "Visible.   End.");
const splitCode = new SemanticSpeechSegmenter({ firstMinChars: 4, normalMinChars: 4, maxChars: 80, firstMaxWaitMs: 100 });
const splitCodeOutput = [
  ...splitCode.push("Visible before. ``", 0),
  ...splitCode.push("`json\n{\"internal\":true}", 1),
  ...splitCode.push("\n```, visible after.", 2),
  ...splitCode.flush(),
];
assert.doesNotMatch(splitCodeOutput.map((item) => item.text).join(" "), /internal|json/);
assert.match(splitCodeOutput.map((item) => item.text).join(" "), /Visible before.*visible after/i);
const randomized = "这是随机分块的一致性测试。It must preserve every speakable word without duplication or loss!";
for (let size = 1; size <= 13; size += 1) {
  const current = new SemanticSpeechSegmenter({ firstMinChars: 4, normalMinChars: 6, maxChars: 30, firstMaxWaitMs: 100 });
  const output = [];
  for (let index = 0; index < randomized.length; index += size) output.push(...current.push(randomized.slice(index, index + size), index));
  output.push(...current.flush());
  assert.equal(output.map((item) => item.text).join("").replace(/\s+/g, ""), randomized.replace(/\s+/g, ""));
  assert.deepEqual(output.map((item) => item.index), output.map((_, index) => index));
}

console.log("Semantic speech segmenter tests passed (Chinese/English, abbreviations, decimals, URLs, code filtering, first latency, max length, final flush, and random chunk consistency).");
