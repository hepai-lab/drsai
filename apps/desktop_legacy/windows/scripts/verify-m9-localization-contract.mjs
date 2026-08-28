import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererRoot = join(root, "..", "shared", "renderer", "src");
const sourceFiles = [...walk(rendererRoot)].filter((file) => [".ts", ".tsx"].includes(extname(file)));
const failures = [];
const localizedBranches = [];
const forbiddenTechnicalTerms = [
  /\bMCP(?:\s+server)?\b/i,
  /\bIPC\b/,
  /\bWebUI\b/i,
  /\bApproval Center\b/i,
  /\bAgent\b/,
  /\bJSON\s*(?:参数|parameter)/i,
  /\btool\s+call\b/i,
  /\bfunction\s+call\b/i,
  /\bstack\s+trace\b/i,
];
const suspiciousText = [/\uFFFD/, /\u00ef\u00bf\u00bd/, /\u00e2\u20ac/, /\{\{\s*[\w.-]+\s*\}\}/, /(?:translation|i18n)\.missing/i];

for (const file of sourceFiles) {
  const content = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  visit(source, source, file);
  if (file.endsWith(".tsx")) for (const pattern of suspiciousText) if (pattern.test(content)) failures.push(`${label(file)} contains unresolved or corrupted text matching ${pattern}`);
}

const navigation = sourceFiles.find((file) => file.endsWith(`${join("src", "navigation.ts")}`)) || join(rendererRoot, "navigation.ts");
const navigationSource = ts.createSourceFile(navigation, readFileSync(navigation, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const catalogs = ["MENU_LABELS", "sectionLabels", "rightTabLabels"].map((name) => readBilingualCatalog(navigationSource, name));
for (const catalog of catalogs) {
  if (!catalog) { failures.push(`Missing localization catalog.`); continue; }
  const missingZh = [...catalog.en].filter((key) => !catalog.zh.has(key));
  const missingEn = [...catalog.zh].filter((key) => !catalog.en.has(key));
  if (missingZh.length || missingEn.length) failures.push(`${catalog.name} key mismatch; missing zh=[${missingZh}], missing en=[${missingEn}]`);
}

const branchFailures = localizedBranches.filter((entry) => !entry.zh.trim());
for (const entry of branchFailures) failures.push(`${entry.file}:${entry.line} has an empty Chinese branch`);
const technicalFailures = localizedBranches.filter((entry) => forbiddenTechnicalTerms.some((pattern) => pattern.test(entry.zh)));
for (const entry of technicalFailures) failures.push(`${entry.file}:${entry.line} exposes an internal technical term in Chinese UI text: ${JSON.stringify(entry.zh.slice(0, 160))}`);

const catalogKeys = catalogs.reduce((sum, catalog) => sum + (catalog?.en.size || 0), 0);
const localizedTotal = localizedBranches.length + catalogKeys;
const localizedPassed = localizedTotal - branchFailures.length;
if (localizedTotal < 300) failures.push(`Localization inventory is unexpectedly small: ${localizedTotal}`);

if (failures.length) {
  console.error(`M9 localization contract failed (${localizedPassed}/${localizedTotal} localized entries covered):`);
  for (const failure of failures.slice(0, 100)) console.error(`- ${failure}`);
  if (failures.length > 100) console.error(`- ...and ${failures.length - 100} more`);
  process.exit(1);
}

console.log(`M9 localization contract passed (${localizedPassed}/${localizedTotal}; Chinese key coverage 100%; ${localizedBranches.length} inline entries + ${catalogKeys} catalog keys).`);

function visit(node, source, file) {
  if (ts.isConditionalExpression(node)) {
    const condition = node.condition.getText(source).replace(/\s+/g, " ");
    const orientation = chineseOrientation(condition);
    if (orientation) {
      const zhNode = orientation === "true" ? node.whenTrue : node.whenFalse;
      const enNode = orientation === "true" ? node.whenFalse : node.whenTrue;
      const zh = displayText(zhNode, source);
      const en = displayText(enNode, source);
      if (zh !== null && en !== null && /\p{Script=Han}/u.test(zh)) {
        localizedBranches.push({ file: label(file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, zh, en });
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, source, file));
}

function chineseOrientation(condition) {
  if (/^(?:\(?\s*)zh(?:\s*\)?)$/.test(condition) || /language\s*===\s*["']zh["']/.test(condition) || /["']zh["']\s*===\s*language/.test(condition)) return "true";
  if (/^!\s*zh$/.test(condition) || /language\s*!==\s*["']zh["']/.test(condition) || /language\s*===\s*["']en["']/.test(condition)) return "false";
  return null;
}

function displayText(node, source) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `\${…}${span.literal.text}`).join("");
  if (ts.isParenthesizedExpression(node)) return displayText(node.expression, source);
  return null;
}

function readBilingualCatalog(source, name) {
  let result = null;
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (declaration.name.getText(source) !== name || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
      const languages = Object.fromEntries(declaration.initializer.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(source).replace(/["']/g, ""), property.initializer]));
      if (!ts.isObjectLiteralExpression(languages.zh) || !ts.isObjectLiteralExpression(languages.en)) continue;
      result = { name, zh: propertyKeys(languages.zh, source), en: propertyKeys(languages.en, source) };
    }
  });
  return result;
}

function propertyKeys(object, source) { return new Set(object.properties.filter(ts.isPropertyAssignment).map((property) => property.name.getText(source))); }
function label(file) { return relative(root, file).replaceAll("\\", "/"); }
function* walk(directory) { for (const entry of readdirSync(directory)) { const path = join(directory, entry); if (statSync(path).isDirectory()) yield* walk(path); else yield path; } }
