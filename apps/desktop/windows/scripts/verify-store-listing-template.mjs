import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const listingPath = join(root, "store", "store-listing.template.json");
const appxPath = join(root, "store", "electron-builder.appx.template.yml");

if (!existsSync(listingPath)) {
  throw new Error("Missing Store listing template: store/store-listing.template.json");
}
if (!existsSync(appxPath)) {
  throw new Error("Missing Store AppX template: store/electron-builder.appx.template.yml");
}

const listingText = readFileSync(listingPath, "utf8");
const appxText = readFileSync(appxPath, "utf8");
const listing = JSON.parse(listingText.replace(/^\uFEFF/, ""));

assertEqual(listing.productName, "OpenDrSai", "productName");
assertEqual(listing.primaryLocale, "en-US", "primaryLocale");
assertArrayIncludes(listing.additionalLocales, "zh-CN", "additionalLocales");
assertNonEmpty(listing.shortDescription, "shortDescription");
assertNonEmpty(listing.description, "description");
assertEqual(listing.privacyPolicyUrl, "__STORE_PRIVACY_POLICY_URL__", "privacyPolicyUrl placeholder");
assertEqual(listing.supportUrl, "__STORE_SUPPORT_URL__", "supportUrl placeholder");
assertEqual(listing.publisherDisplayName, "__PARTNER_CENTER_PUBLISHER_DISPLAY_NAME__", "publisherDisplayName placeholder");
assertEqual(listing.storePackageIdentityName, "__PARTNER_CENTER_PACKAGE_IDENTITY_NAME__", "storePackageIdentityName placeholder");
assertEqual(listing.storePublisherSubject, "__PARTNER_CENTER_PUBLISHER_SUBJECT__", "storePublisherSubject placeholder");

for (const snippet of [
  "__PARTNER_CENTER_APPLICATION_ID__",
  "__PARTNER_CENTER_PACKAGE_IDENTITY_NAME__",
  "__PARTNER_CENTER_PUBLISHER_SUBJECT__",
  "__PARTNER_CENTER_PUBLISHER_DISPLAY_NAME__",
  "runFullTrust",
  "internetClient",
]) {
  if (!appxText.includes(snippet)) {
    throw new Error(`Store AppX template is missing ${snippet}.`);
  }
}

if (!Array.isArray(listing.certificationNotes) || listing.certificationNotes.length < 3) {
  throw new Error("Store listing template must include certificationNotes.");
}
assertTextIncludes(listing.certificationNotes.join("\n"), [
  "AI services",
  "Authenticode signed",
  "test account or API key",
  "Do not claim medical diagnosis",
]);

if (!Array.isArray(listing.screenshotRequirements) || listing.screenshotRequirements.length < 3) {
  throw new Error("Store listing template must require at least three screenshots.");
}
for (const required of ["chat-workspace", "agent-square", "settings"]) {
  if (!listing.screenshotRequirements.some((item) => item.name === required && item.minimumSize)) {
    throw new Error(`Store listing template is missing screenshot requirement ${required}.`);
  }
}

const dataSafety = listing.dataSafetySummary || {};
assertTextIncludes(
  [
    dataSafety.localFiles,
    dataSafety.promptsAndConversations,
    dataSafety.credentials,
    dataSafety.network,
  ].join("\n"),
  ["user-selected workspace files", "AI services", "API keys", "HTTPS"],
);

console.log("Store listing and AppX templates verified.");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Expected ${label} to be ${expected}, got ${actual ?? "<missing>"}.`);
  }
}

function assertNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length < 12) {
    throw new Error(`Store listing ${label} is missing or too short.`);
  }
}

function assertArrayIncludes(value, item, label) {
  if (!Array.isArray(value) || !value.includes(item)) {
    throw new Error(`Store listing ${label} must include ${item}.`);
  }
}

function assertTextIncludes(text, snippets) {
  for (const snippet of snippets) {
    if (!text.includes(snippet)) {
      throw new Error(`Store listing template is missing ${snippet}.`);
    }
  }
}
