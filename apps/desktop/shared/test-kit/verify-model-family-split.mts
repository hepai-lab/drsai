/**
 * Verifies the catalog family split and the flat entry order the Desktop model
 * table depends on. The table is a CSS grid whose rows use `subgrid`, so the
 * order helper must emit a FLAT list (separator + rows) and must never group
 * rows into a wrapper element.
 */
import {
  classifyModelFamily,
  orderModelEntriesByFamily,
  supportsImageGenerationModel,
} from "../renderer/src/modelCatalogRecovery";

const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name} ${detail}`);
  }
}

// ── 1. family classification ──
const chat = { alias: "deepseek-v4-pro", operations: ["chat", "tool_calling", "reasoning"], input_modalities: ["text"], output_modalities: ["text"] };
const multimodal = { alias: "gpt-5.6-luna", operations: ["chat", "tool_calling"], input_modalities: ["text", "image"], output_modalities: ["text"] };
const imageGen = { alias: "GPT Image 2", operations: ["image_generation", "image_edit"], input_modalities: ["text", "image"], output_modalities: ["image"] };
const audio = { alias: "whisper-1", operations: ["speech_to_text"], input_modalities: ["audio"], output_modalities: ["text"] };

check("chat model -> chat", classifyModelFamily(chat) === "chat");
check("image-input chat -> multimodal_input", classifyModelFamily(multimodal) === "multimodal_input");
check("image generator -> image_generation", classifyModelFamily(imageGen) === "image_generation");
check("audio model -> audio", classifyModelFamily(audio) === "audio");

// ── 2. the two families never overlap ──
check(
  "image generator is not offered as a primary model",
  classifyModelFamily(imageGen) !== "chat" && classifyModelFamily(imageGen) !== "multimodal_input",
);
check(
  "multimodal-input model is not offered as an image generator",
  supportsImageGenerationModel(multimodal as never) === false,
);
check("image generator is offered as an image generator", supportsImageGenerationModel(imageGen as never) === true);

// ── 3. entry order is flat, ordered, and complete ──
const entries = orderModelEntriesByFamily([
  { id: "whisper-1", family: "audio" },
  { id: "gpt-image-2", family: "image_generation" },
  { id: "deepseek-v4-pro", family: "chat" },
  { id: "gpt-5.6-luna", family: "multimodal_input" },
  { id: "deepseek-v4-flash", family: "chat" },
]);

const kinds = entries.map((entry) => (entry.kind === "family" ? `F:${entry.family}` : `M:${entry.model}`));
console.log("     order =", kinds.join(" | "));

check("no wrapper element in the output (flat union type)", entries.every((entry) => entry.kind === "family" || entry.kind === "model"));
check("family order is chat -> multimodal -> image -> audio", kinds.join(",") === [
  "F:chat", "M:deepseek-v4-flash", "M:deepseek-v4-pro",
  "F:multimodal_input", "M:gpt-5.6-luna",
  "F:image_generation", "M:gpt-image-2",
  "F:audio", "M:whisper-1",
].join(","), `got ${kinds.join(",")}`);
check(
  "every separator is followed by rows and counts match",
  entries.filter((entry) => entry.kind === "family").every((separator) => {
    const index = entries.indexOf(separator as never);
    const next = entries[index + 1];
    return next?.kind === "model";
  }),
);
check("total rows preserved", entries.filter((entry) => entry.kind === "model").length === 5);

// ── 4. empty families emit no separator ──
const onlyChat = orderModelEntriesByFamily([{ id: "a", family: "chat" }]);
check("empty families emit no header", onlyChat.length === 2 && onlyChat[0].kind === "family");

console.log();
if (failures.length) {
  console.log("FAILURES: " + failures.join(", "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
