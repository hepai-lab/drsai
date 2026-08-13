import assert from "node:assert/strict";
import {
  citationIdsForMarkdown,
  citationMarkerNumbers,
  citationPartId,
  locatorLabel,
  projectCitationParts,
} from "../../shared/api/citations.ts";
import type { CitationPart } from "../../shared/api/structuredConversation.ts";

/**
 * A grounded answer is only checkable if the reader can get from a sentence to
 * the passage behind it and back. These checks cover that relation, the
 * stability of the ids it depends on, and the refusal case where the answer
 * cites a searched scope rather than a supporting passage.
 */

const checks: Record<string, boolean> = {};

const runtimeCitation = {
  citation_id: "kb:runtime:1",
  knowledge_base_id: "regression.opendrsai-runtime",
  knowledge_base_revision: 1,
  document_path: "opendrsai_runtime_overview_v1.md",
  document_sha256: "133ef969",
  title: "OpenDrSai Runtime overview",
  excerpt: "Replay always creates a new Run.",
  relation: "supports_claim",
  locator: { kind: "heading", heading_path: ["OpenDrSai Runtime", "Replay"], line_start: 9, line_end: 11 },
};

const parts = projectCitationParts("item-1", [runtimeCitation], "completed", "item-1");
assert.equal(parts.length, 1);
const [citation] = parts as [CitationPart];
assert.equal(citation.kind, "citation");
assert.equal(citation.citationId, "kb:runtime:1");
assert.equal(citation.path, "opendrsai_runtime_overview_v1.md");
assert.equal(citation.locator, "OpenDrSai Runtime > Replay");
assert.equal(citation.excerpt, "Replay always creates a new Run.");
checks.citationCarriesAnOpenableTargetAndPosition = true;

// The reader has to be able to go from the source back to the sentence that
// used it, not only from the sentence to the source.
assert.equal(citation.markdownPartId, "item-1");
checks.citationLinksBackToItsParagraph = true;

assert.deepEqual(citationMarkerNumbers("A [E1] and B [E2]. Again [E1]."), [1, 2]);
checks.markerParsingIsOrderedAndDeduplicated = true;

const markdown = "Replay always creates a new Run [E1].";
assert.deepEqual(citationIdsForMarkdown(markdown, parts), ["kb:runtime:1"]);
checks.markdownReferencesOnlyTheCitationItUsed = true;

// Ids must survive re-projection, otherwise the jump back to the source breaks
// after a reload.
assert.equal(citationPartId("item-1", 1, runtimeCitation), "kb:runtime:1");
assert.equal(citationPartId("item-1", 2, {}), "item-1:c2");
assert.equal(citationPartId("item-1", 2, {}), citationPartId("item-1", 2, {}));
checks.citationIdsAreStableAcrossProjections = true;

// A refusal names the scope it searched and carries no markers; dropping the
// link there would leave a correct refusal looking unsourced.
const scopeParts = projectCitationParts("item-2", [{
  document_path: "opendrsai_runtime_overview_v1.md",
  relation: "searched_scope",
  title: "OpenDrSai Runtime overview",
}], "completed", "item-2");
const refusal = "知识库中并未包含本地 Gateway 的默认端口信息。";
assert.equal(scopeParts.length, 1);
assert.deepEqual(citationIdsForMarkdown(refusal, scopeParts), ["item-2:c1"]);
checks.refusalStillCitesTheScopeItSearched = true;

// A citation that resolves to nothing openable is worse than none: it reads as
// sourced while pointing nowhere.
assert.deepEqual(projectCitationParts("item-3", [{ title: "No target" }], "completed", "item-3"), []);
assert.deepEqual(projectCitationParts("item-3", undefined, "completed", "item-3"), []);
assert.deepEqual(projectCitationParts("item-3", [null, 7, "x"], "completed", "item-3"), []);
checks.unresolvableCitationsAreDropped = true;

assert.equal(locatorLabel({ locator: { kind: "page", page: 4 } }), "p.4");
assert.equal(locatorLabel({ locator: { kind: "slide", slide: 3 } }), "slide 3");
assert.equal(locatorLabel({ locator: { kind: "sheet", sheet: "Metrics" } }), "Metrics");
assert.equal(locatorLabel({ locator: { kind: "line", line_start: 12, line_end: 18 } }), "L12-18");
assert.equal(locatorLabel({ locator: { kind: "line", line_start: 12 } }), "L12");
assert.equal(locatorLabel({}), "");
checks.everyLocatorKindRendersAPosition = true;

const passed = Object.keys(checks).length;
console.log(`Citation projection passed (${passed}/${passed}; openable target, bidirectional relation, stable ids, refusal scope).`);
