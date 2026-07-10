import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const { gzipSync } = require("node:zlib");

function assert(condition, message) {
  if (!condition) {
    console.error(`Channel adapter runtime fixture verification failed: ${message}`);
    process.exit(1);
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function writeText(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
}

function writeHdf5Like(filePath) {
  const buffer = Buffer.alloc(64);
  Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).copy(buffer, 0);
  Buffer.from("fixture-dataset").copy(buffer, 16);
  writeFileSync(filePath, buffer);
}

function writeNetcdfFixture(filePath) {
  const buffer = Buffer.alloc(96);
  Buffer.from("CDF", "ascii").copy(buffer, 0);
  buffer[3] = 1;
  Buffer.from("runtime_temperature runtime_latitude", "utf8").copy(buffer, 16);
  writeFileSync(filePath, buffer);
}

function writeMatlabMatFixture(filePath) {
  const buffer = Buffer.alloc(160);
  Buffer.from("MATLAB 5.0 MAT-file, Platform: PCWIN64, Created by OpenDrSai runtime fixture", "latin1").copy(buffer, 0);
  buffer.writeUInt16LE(0x0100, 124);
  Buffer.from("IM", "ascii").copy(buffer, 126);
  Buffer.from("runtime_matrix", "utf8").copy(buffer, 132);
  writeFileSync(filePath, buffer);
}

function writeGlbFixture(filePath) {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "OpenDrSai runtime fixture" },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: "RuntimeGlbMesh", primitives: [{ attributes: { POSITION: 0 } }] }],
    materials: [{ name: "RuntimeMaterial" }],
    accessors: [{ componentType: 5126, count: 3, type: "VEC3" }],
    buffers: [{ byteLength: 0 }],
  });
  const jsonBuffer = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " "), "utf8");
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBuffer.length, 8);
  header.writeUInt32LE(jsonBuffer.length, 12);
  header.write("JSON", 16, "ascii");
  writeFileSync(filePath, Buffer.concat([header, jsonBuffer]));
}

function writePdfFixture(filePath) {
  writeText(filePath, [
    "%PDF-1.7",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /Annots [4 0 R] /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Annot /Subtype /Link /A << /S /URI /URI (https://example.test) >> >> endobj",
    "5 0 obj << /Length 48 >> stream",
    "BT /F1 12 Tf 72 720 Td (Runtime PDF fixture) Tj ET",
    "endstream endobj",
    "6 0 obj << /Title (Runtime Fixture PDF) /Author (OpenDrSai) >> endobj",
    "trailer << /Root 1 0 R /Info 6 0 R >>",
    "%%EOF",
  ].join("\n"));
}

function zipLocalEntry(name, contents) {
  const nameBuffer = Buffer.from(name, "utf8");
  const data = Buffer.from(contents, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer, data]);
}

function writeZipFixture(filePath) {
  writeFileSync(filePath, Buffer.concat([
    zipLocalEntry("reports/", ""),
    zipLocalEntry("reports/summary.txt", "runtime fixture archive summary"),
    zipLocalEntry("nested/report.zip", "PK\u0003\u0004nested archive marker"),
  ]));
}

function writeOfficeZipFixture(filePath, entries) {
  writeFileSync(filePath, Buffer.concat(entries.map(([name, contents]) => zipLocalEntry(name, contents))));
}

function writeDocxFixture(filePath) {
  writeOfficeZipFixture(filePath, [
    ["word/document.xml", '<w:document><w:body><w:p><w:r><w:t>Runtime DOCX fixture body</w:t></w:r></w:p></w:body></w:document>'],
    ["word/comments.xml", '<w:comments><w:comment><w:p><w:r><w:t>Runtime DOCX review comment</w:t></w:r></w:p></w:comment></w:comments>'],
  ]);
}

function writeXlsxFixture(filePath, macroEnabled = false) {
  writeOfficeZipFixture(filePath, [
    ["xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Runtime Data" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/sharedStrings.xml", '<sst><si><t>Runtime Item</t></si><si><t>Runtime Value</t></si><si><t>Macro Cached Value</t></si></sst>'],
    ["xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${macroEnabled ? "Runtime XLSM cached row" : "Runtime XLSX cached row"}</t></is></c><c r="B2"><v>42</v></c></row><row r="3"><c r="C3"><f>SUM(B2:B2)</f><v>42</v></c><c r="D3"><f>HYPERLINK(&quot;https://example.test/report?token=secret-fixture&quot;,&quot;report&quot;)</f><v>report</v></c></row></sheetData></worksheet>`],
    ...(macroEnabled ? [["xl/vbaProject.bin", "bounded-vba-project-placeholder"]] : []),
  ]);
}

function writePptxFixture(filePath) {
  writeOfficeZipFixture(filePath, [
    ["ppt/slides/slide1.xml", '<p:sld><p:cSld><p:spTree><a:t>Runtime PPTX slide title</a:t><a:t>Runtime slide body</a:t></p:spTree></p:cSld></p:sld>'],
    ["ppt/notesSlides/notesSlide1.xml", "<p:notes><a:t>Runtime speaker note</a:t></p:notes>"],
  ]);
}

function writeOpenDocumentFixture(filePath) {
  writeOfficeZipFixture(filePath, [
    ["mimetype", "application/vnd.oasis.opendocument.text"],
    ["content.xml", "<office:document-content><office:body><office:text><text:p>Runtime OpenDocument body</text:p></office:text></office:body></office:document-content>"],
  ]);
}

function writeLegacyOfficeFixture(filePath, label) {
  const buffer = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0);
  Buffer.from(label, "utf16le").copy(buffer, 256);
  writeFileSync(filePath, buffer);
}

function writeEvtxFixture(filePath) {
  const buffer = Buffer.alloc(512);
  Buffer.from("ElfFile\0", "binary").copy(buffer, 0);
  buffer.writeBigUInt64LE(1n, 8);
  buffer.writeBigUInt64LE(1n, 16);
  buffer.writeBigUInt64LE(42n, 24);
  buffer.writeUInt32LE(128, 32);
  buffer.writeUInt16LE(3, 36);
  buffer.writeUInt16LE(1, 38);
  buffer.writeUInt16LE(4096, 40);
  buffer.writeUInt32LE(0, 120);
  buffer.writeUInt32LE(0x12345678, 124);
  Buffer.from("ElfChnk\0", "binary").copy(buffer, 128);
  Buffer.from([0x2a, 0x2a, 0x00, 0x00]).copy(buffer, 256);
  writeFileSync(filePath, buffer);
}

function writeEtlFixture(filePath) {
  const buffer = Buffer.alloc(256);
  Buffer.from("MSNT").copy(buffer, 0);
  Buffer.from("Runtime ETL provider {12345678-1234-1234-1234-1234567890ab}", "utf8").copy(buffer, 48);
  Buffer.from("RuntimeSession", "utf16le").copy(buffer, 144);
  writeFileSync(filePath, buffer);
}

function writeMsiFixture(filePath) {
  const buffer = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0);
  buffer.writeUInt16LE(0x003e, 24);
  buffer.writeUInt16LE(0x0003, 26);
  buffer.writeUInt16LE(0xfffe, 28);
  buffer.writeUInt16LE(9, 30);
  buffer.writeUInt16LE(6, 32);
  buffer.writeUInt32LE(1, 40);
  buffer.writeUInt32LE(1, 44);
  buffer.writeInt32LE(1, 48);
  buffer.writeUInt32LE(4096, 60);
  Buffer.from("Product", "utf16le").copy(buffer, 512);
  buffer.writeUInt16LE(("Product".length + 1) * 2, 512 + 64);
  Buffer.from("Runtime Installer Product", "utf16le").copy(buffer, 700);
  writeFileSync(filePath, buffer);
}

function writeCatFixture(filePath) {
  const pkcs7SignedDataOid = Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x30, 0x82, 0x01, 0x00]),
    pkcs7SignedDataOid,
    Buffer.from(" RuntimeCatalog runtime.inf runtime.sys Microsoft Windows Driver Catalog ", "utf16le"),
  ]));
}

function writeOutlookMsgFixture(filePath) {
  const buffer = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buffer, 0);
  Buffer.from("Subject: Runtime Outlook Fixture\0From: Runtime Sender\0Body: bounded MSG preview", "utf16le").copy(buffer, 256);
  writeFileSync(filePath, buffer);
}

function writeWindowsShortcutFixture(filePath) {
  const buffer = Buffer.alloc(320);
  buffer.writeUInt32LE(0x4c, 0);
  Buffer.from([0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]).copy(buffer, 4);
  buffer.writeUInt32LE(0x00000004 | 0x00000020, 20);
  buffer.writeUInt32LE(0x00000020, 24);
  buffer.writeUInt32LE(4096, 52);
  buffer.writeUInt32LE(1, 60);
  Buffer.from("C:\\Runtime\\fixture.exe", "utf8").copy(buffer, 80);
  Buffer.from("Runtime Shortcut Target\0C:\\Runtime\\fixture.exe", "utf16le").copy(buffer, 128);
  writeFileSync(filePath, buffer);
}

function writeMinidumpFixture(filePath) {
  const buffer = Buffer.alloc(128);
  Buffer.from("MDMP").copy(buffer, 0);
  buffer.writeUInt32LE(0xa793, 4);
  buffer.writeUInt32LE(2, 8);
  buffer.writeUInt32LE(32, 12);
  buffer.writeUInt32LE(0x1234, 16);
  buffer.writeUInt32LE(1783597943, 20);
  buffer.writeBigUInt64LE(1n, 24);
  buffer.writeUInt32LE(3, 32);
  buffer.writeUInt32LE(24, 36);
  buffer.writeUInt32LE(80, 40);
  buffer.writeUInt32LE(7, 44);
  buffer.writeUInt32LE(32, 48);
  buffer.writeUInt32LE(96, 52);
  writeFileSync(filePath, buffer);
}

function writeWasmFixture(filePath) {
  writeFileSync(filePath, Buffer.from([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    0x00, 0x08, 0x07,
    0x72, 0x75, 0x6e, 0x74, 0x69, 0x6d, 0x65,
  ]));
}

function writePeFixture(filePath) {
  const buffer = Buffer.alloc(512);
  Buffer.from("MZ").copy(buffer, 0);
  buffer.writeUInt32LE(0x80, 0x3c);
  Buffer.from("PE\0\0").copy(buffer, 0x80);
  buffer.writeUInt16LE(0x8664, 0x84);
  buffer.writeUInt16LE(1, 0x86);
  buffer.writeUInt16LE(0xf0, 0x94);
  buffer.writeUInt16LE(0x20b, 0x98);
  buffer.writeUInt16LE(3, 0xf4);
  buffer.writeUInt32LE(0x2000, 0x110);
  Buffer.from(".text\0\0\0").copy(buffer, 0x188);
  writeFileSync(filePath, buffer);
}

function writeJavaArchiveFixture(filePath) {
  writeFileSync(filePath, Buffer.concat([
    zipLocalEntry("META-INF/MANIFEST.MF", [
      "Manifest-Version: 1.0",
      "Main-Class: org.opendrsai.runtime.Main",
      "Automatic-Module-Name: org.opendrsai.runtime.fixture",
      "Implementation-Version: 1.0.0",
      "",
    ].join("\n")),
    zipLocalEntry("org/opendrsai/runtime/Main.class", "runtime class placeholder"),
    zipLocalEntry("lib/runtime-helper.jar", "PK\u0003\u0004nested jar marker"),
  ]));
}

function writeJavaClassFixture(filePath) {
  const utf8Entries = [
    "org/opendrsai/runtime/RuntimeFixture",
    "java/lang/Object",
    "run",
    "()V",
  ].map((value) => {
    const data = Buffer.from(value, "utf8");
    const entry = Buffer.alloc(3 + data.length);
    entry[0] = 1;
    entry.writeUInt16BE(data.length, 1);
    data.copy(entry, 3);
    return entry;
  });
  const header = Buffer.alloc(10);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(61, 6);
  header.writeUInt16BE(utf8Entries.length + 1, 8);
  writeFileSync(filePath, Buffer.concat([header, ...utf8Entries]));
}

function writeMobileAppPackageFixture(filePath, kind) {
  if (kind === "ipa") {
    writeFileSync(filePath, Buffer.concat([
      zipLocalEntry("Payload/RuntimeFixture.app/Info.plist", [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<plist><dict><key>CFBundleIdentifier</key><string>org.opendrsai.runtime.ipa</string></dict></plist>",
      ].join("\n")),
      zipLocalEntry("Payload/RuntimeFixture.app/RuntimeFixture", "runtime ipa executable placeholder"),
      zipLocalEntry("Payload/RuntimeFixture.app/Assets.car", "runtime ipa asset catalog placeholder"),
      zipLocalEntry("Payload/RuntimeFixture.app/Frameworks/RuntimeKit.framework/RuntimeKit", "runtime framework placeholder"),
      zipLocalEntry("Payload/RuntimeFixture.app/PlugIns/RuntimeShare.appex/Info.plist", "runtime plugin plist placeholder"),
      zipLocalEntry("Payload/RuntimeFixture.app/embedded.mobileprovision", "runtime provisioning placeholder"),
      zipLocalEntry("Payload/RuntimeFixture.app/_CodeSignature/CodeResources", "runtime signature placeholder"),
    ]));
    return;
  }

  const modulePrefix = kind === "aab" ? "base/" : "";
  writeFileSync(filePath, Buffer.concat([
    zipLocalEntry(`${modulePrefix}manifest/AndroidManifest.xml`, "<manifest package=\"org.opendrsai.runtime.package\" />"),
    zipLocalEntry(`${modulePrefix}dex/classes.dex`, "runtime dex placeholder"),
    zipLocalEntry(`${modulePrefix}res/drawable/runtime.xml`, "<shape />"),
    zipLocalEntry(`${modulePrefix}assets/runtime.txt`, "runtime asset placeholder"),
    zipLocalEntry(`${modulePrefix}lib/arm64-v8a/libruntime.so`, "runtime native library placeholder"),
    zipLocalEntry(`${modulePrefix}resources.arsc`, "runtime resource table placeholder"),
    zipLocalEntry("META-INF/RUNTIME.SF", "runtime signature file placeholder"),
    zipLocalEntry("META-INF/RUNTIME.RSA", "runtime certificate placeholder"),
    ...(kind === "aab" ? [zipLocalEntry("feature-chat/manifest/AndroidManifest.xml", "<manifest split=\"feature-chat\" />")] : []),
  ]));
}

function writeStlFixture(filePath) {
  writeText(filePath, [
    "solid RuntimeSolid",
    "  facet normal 0 0 1",
    "    outer loop",
    "      vertex 0 0 0",
    "      vertex 1 0 0",
    "      vertex 0 1 0",
    "    endloop",
    "  endfacet",
    "endsolid RuntimeSolid",
  ].join("\n"));
}

function writeTtfFixture(filePath) {
  const familyName = Buffer.from("Runtime Fixture Font", "utf16le");
  const nameTable = Buffer.alloc(18 + familyName.length);
  nameTable.writeUInt16BE(0, 0);
  nameTable.writeUInt16BE(1, 2);
  nameTable.writeUInt16BE(18, 4);
  nameTable.writeUInt16BE(3, 6);
  nameTable.writeUInt16BE(1, 8);
  nameTable.writeUInt16BE(0x0409, 10);
  nameTable.writeUInt16BE(1, 12);
  nameTable.writeUInt16BE(familyName.length, 14);
  nameTable.writeUInt16BE(0, 16);
  for (let index = 0; index < familyName.length; index += 2) {
    nameTable[18 + index] = familyName[index + 1];
    nameTable[18 + index + 1] = familyName[index];
  }

  const header = Buffer.alloc(28);
  Buffer.from([0x00, 0x01, 0x00, 0x00]).copy(header, 0);
  header.writeUInt16BE(1, 4);
  Buffer.from("name").copy(header, 12);
  header.writeUInt32BE(28, 20);
  header.writeUInt32BE(nameTable.length, 24);
  writeFileSync(filePath, Buffer.concat([header, nameTable]));
}

function writeWoffFixture(filePath) {
  const familyName = Buffer.from("Runtime WOFF Fixture Font", "utf16le");
  const nameTable = Buffer.alloc(18 + familyName.length);
  nameTable.writeUInt16BE(0, 0);
  nameTable.writeUInt16BE(1, 2);
  nameTable.writeUInt16BE(18, 4);
  nameTable.writeUInt16BE(3, 6);
  nameTable.writeUInt16BE(1, 8);
  nameTable.writeUInt16BE(0x0409, 10);
  nameTable.writeUInt16BE(1, 12);
  nameTable.writeUInt16BE(familyName.length, 14);
  nameTable.writeUInt16BE(0, 16);
  for (let index = 0; index < familyName.length; index += 2) {
    nameTable[18 + index] = familyName[index + 1];
    nameTable[18 + index + 1] = familyName[index];
  }

  const header = Buffer.alloc(44);
  Buffer.from("wOFF").copy(header, 0);
  Buffer.from([0x00, 0x01, 0x00, 0x00]).copy(header, 4);
  header.writeUInt32BE(44 + 20 + nameTable.length, 8);
  header.writeUInt16BE(1, 12);
  header.writeUInt16BE(0, 14);
  header.writeUInt32BE(12 + 16 + nameTable.length, 16);
  header.writeUInt16BE(1, 40);
  const tableRecord = Buffer.alloc(20);
  Buffer.from("name").copy(tableRecord, 0);
  tableRecord.writeUInt32BE(44 + 20, 4);
  tableRecord.writeUInt32BE(nameTable.length, 8);
  tableRecord.writeUInt32BE(nameTable.length, 12);
  writeFileSync(filePath, Buffer.concat([header, tableRecord, nameTable]));
}

function writeWoff2Fixture(filePath) {
  const buffer = Buffer.alloc(48);
  Buffer.from("wOF2").copy(buffer, 0);
  Buffer.from([0x00, 0x01, 0x00, 0x00]).copy(buffer, 4);
  buffer.writeUInt32BE(buffer.length, 8);
  buffer.writeUInt16BE(1, 12);
  buffer.writeUInt16BE(0, 14);
  buffer.writeUInt32BE(16, 16);
  buffer.writeUInt32BE(16, 20);
  buffer.writeUInt32BE(0, 24);
  buffer.writeUInt16BE(1, 28);
  buffer.writeUInt16BE(2, 30);
  writeFileSync(filePath, buffer);
}

function writeSqliteFixture(filePath) {
  const buffer = Buffer.alloc(4096);
  Buffer.from("SQLite format 3\0", "binary").copy(buffer, 0);
  buffer.writeUInt16BE(4096, 16);
  buffer[18] = 1;
  buffer[19] = 1;
  buffer.writeUInt32BE(1, 28);
  buffer.writeUInt32BE(1, 56);
  Buffer.from(
    "CREATE TABLE runtime_users (id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES runtime_orgs(id), email TEXT UNIQUE); CREATE INDEX idx_runtime_users_org ON runtime_users(org_id);",
    "utf8",
  ).copy(buffer, 256);
  writeFileSync(filePath, buffer);
}

function writeParquetFixture(filePath) {
  const metadata = Buffer.from("schema: runtime_events user_id event_name", "utf8");
  const footerLength = Buffer.alloc(4);
  footerLength.writeUInt32LE(metadata.length, 0);
  writeFileSync(filePath, Buffer.concat([Buffer.from("PAR1"), metadata, footerLength, Buffer.from("PAR1")]));
}

function writeArrowFixture(filePath) {
  const body = Buffer.from("runtime_arrow_schema runtime_metric", "utf8");
  const footerLength = Buffer.alloc(4);
  footerLength.writeInt32LE(body.length, 0);
  writeFileSync(filePath, Buffer.concat([Buffer.from("ARROW1\0\0"), body, footerLength, Buffer.from("ARROW1")]));
}

function writeFeatherFixture(filePath) {
  const body = Buffer.from("runtime_feather_schema runtime_column", "utf8");
  writeFileSync(filePath, Buffer.concat([Buffer.from("FEA1"), body]));
}

function writePcapFixture(filePath) {
  const packet = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const buffer = Buffer.alloc(24 + 16 + packet.length);
  buffer.writeUInt32LE(0xa1b2c3d4, 0);
  buffer.writeUInt16LE(2, 4);
  buffer.writeUInt16LE(4, 6);
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(0, 12);
  buffer.writeUInt32LE(65535, 16);
  buffer.writeUInt32LE(1, 20);
  buffer.writeUInt32LE(1783598400, 24);
  buffer.writeUInt32LE(123456, 28);
  buffer.writeUInt32LE(packet.length, 32);
  buffer.writeUInt32LE(packet.length, 36);
  packet.copy(buffer, 40);
  writeFileSync(filePath, buffer);
}

function pcapNgBlock(type, body) {
  const padding = Buffer.alloc((4 - (body.length % 4)) % 4);
  const length = 12 + body.length + padding.length;
  const header = Buffer.alloc(8);
  header.writeUInt32LE(type, 0);
  header.writeUInt32LE(length, 4);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32LE(length, 0);
  return Buffer.concat([header, body, padding, trailer]);
}

function writePcapNgFixture(filePath) {
  const sectionBody = Buffer.alloc(16);
  sectionBody.writeUInt32LE(0x1a2b3c4d, 0);
  sectionBody.writeUInt16LE(1, 4);
  sectionBody.writeUInt16LE(0, 6);
  sectionBody.writeBigInt64LE(-1n, 8);
  const interfaceBody = Buffer.alloc(8);
  interfaceBody.writeUInt16LE(1, 0);
  interfaceBody.writeUInt16LE(0, 2);
  interfaceBody.writeUInt32LE(65535, 4);
  const packetBody = Buffer.alloc(20);
  packetBody.writeUInt32LE(0, 0);
  packetBody.writeUInt32LE(0, 4);
  packetBody.writeUInt32LE(1783598400, 8);
  packetBody.writeUInt32LE(4, 12);
  packetBody.writeUInt32LE(4, 16);
  writeFileSync(filePath, Buffer.concat([
    pcapNgBlock(0x0a0d0d0a, sectionBody),
    pcapNgBlock(0x00000001, interfaceBody),
    pcapNgBlock(0x00000006, packetBody),
  ]));
}

function writeFlacFixture(filePath) {
  const streamInfo = Buffer.alloc(34);
  streamInfo.writeUInt16BE(4096, 0);
  streamInfo.writeUInt16BE(4096, 2);
  const sampleRate = 48000;
  const channels = 2;
  const bitsPerSample = 24;
  const totalSamples = sampleRate * 3;
  const packed =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels - 1) << 41n) |
    (BigInt(bitsPerSample - 1) << 36n) |
    BigInt(totalSamples);
  streamInfo.writeBigUInt64BE(packed, 10);
  const metadataHeader = Buffer.from([0x80, 0x00, 0x00, streamInfo.length]);
  writeFileSync(filePath, Buffer.concat([Buffer.from("fLaC", "ascii"), metadataHeader, streamInfo]));
}

function mp4Box(type, contents) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + contents.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, contents]);
}

function writeM4aFixture(filePath) {
  const ftyp = mp4Box("ftyp", Buffer.concat([
    Buffer.from("M4A ", "ascii"),
    Buffer.alloc(4),
    Buffer.from("M4A mp42", "ascii"),
  ]));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(48000, 12);
  mvhd.writeUInt32BE(144000, 16);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(48000, 12);
  mdhd.writeUInt32BE(144000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("soun", 8, "ascii");
  const mdia = mp4Box("mdia", Buffer.concat([mp4Box("mdhd", mdhd), mp4Box("hdlr", hdlr)]));
  const trak = mp4Box("trak", mdia);
  const moov = mp4Box("moov", Buffer.concat([mp4Box("mvhd", mvhd), trak]));
  writeFileSync(filePath, Buffer.concat([ftyp, moov]));
}

function writeOggFixture(filePath) {
  const packet = Buffer.alloc(30);
  packet[0] = 1;
  packet.write("vorbis", 1, "ascii");
  packet.writeUInt32LE(0, 7);
  packet[11] = 2;
  packet.writeUInt32LE(44100, 12);
  packet.writeInt32LE(192000, 20);
  const header = Buffer.alloc(27);
  header.write("OggS", 0, "ascii");
  header[26] = 1;
  writeFileSync(filePath, Buffer.concat([header, Buffer.from([packet.length]), packet]));
}

async function loadChannelAdapters(tempRoot) {
  const source = read("src/main/channelAdapters.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "channelAdapters.ts",
  }).outputText;
  const moduleDir = join(tempRoot, "compiled-main");
  mkdirSync(moduleDir, { recursive: true });
  writeText(join(moduleDir, "paths.js"), `exports.DRSAI_HOME = ${JSON.stringify(join(tempRoot, "drsai-home"))};\n`);
  writeText(join(moduleDir, "channelAdapters.cjs"), transpiled);
  return import(pathToFileURL(join(moduleDir, "channelAdapters.cjs")).href);
}

function summaryFor(result, title) {
  const item = result.items.find((candidate) => candidate.title === title);
  assert(item, `missing imported item for ${title}`);
  return item.summary;
}

const packageJson = read("package.json");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes('"verify:channel-adapter-runtime-fixtures": "node scripts/verify-channel-adapter-runtime-fixtures.mjs"'),
  "package script is not registered",
);
assert(checklist.includes("runtime-fixture-contract-agent"), "checklist omits runtime fixture contract agent record");
assert(checklist.includes("Channel Adapter Runtime Fixture Verification"), "checklist omits runtime fixture verification addendum");
assert(checklist.includes("npm run verify:channel-adapter-runtime-fixtures"), "checklist omits runtime fixture verification command");
assert(roadmap.includes("channel adapter runtime fixture verification"), "roadmap omits runtime fixture verification evidence");
assert(roadmap.includes("npm run verify:channel-adapter-runtime-fixtures"), "roadmap omits runtime fixture verification command");
assert(checklist.includes("runtime-route-golden-agent"), "checklist omits runtime route golden fixture agent record");
assert(checklist.includes("broader golden preview fixture suites"), "checklist omits runtime golden fixture coverage evidence");
assert(roadmap.includes("runtime route golden fixtures"), "roadmap omits runtime route golden fixture evidence");
assert(checklist.includes("runtime-document-archive-golden-agent"), "checklist omits runtime document/archive golden fixture agent record");
assert(roadmap.includes("runtime document/archive golden fixtures"), "roadmap omits runtime document/archive golden fixture evidence");
assert(checklist.includes("runtime-package-manifest-golden-agent"), "checklist omits runtime package/config golden fixture agent record");
assert(checklist.includes("runtime package/config golden fixtures"), "checklist omits runtime package/config golden fixture evidence");
assert(roadmap.includes("runtime package/config golden fixtures"), "roadmap omits runtime package/config golden fixture evidence");
assert(checklist.includes("runtime-python-dependency-golden-agent"), "checklist omits runtime Python dependency golden fixture agent record");
assert(checklist.includes("runtime Python dependency manifest golden fixtures"), "checklist omits runtime Python dependency fixture evidence");
assert(roadmap.includes("runtime Python dependency golden fixtures"), "roadmap omits runtime Python dependency fixture evidence");
assert(checklist.includes("runtime-personal-info-golden-agent"), "checklist omits runtime personal-info golden fixture agent record");
assert(checklist.includes("runtime personal-info golden fixtures"), "checklist omits runtime personal-info golden fixture evidence");
assert(roadmap.includes("runtime personal-info golden fixtures"), "roadmap omits runtime personal-info golden fixture evidence");
assert(checklist.includes("runtime-windows-diagnostics-golden-agent"), "checklist omits runtime Windows diagnostics golden fixture agent record");
assert(checklist.includes("runtime Windows diagnostics/installer golden fixtures"), "checklist omits runtime Windows diagnostics/installer golden fixture evidence");
assert(roadmap.includes("runtime Windows diagnostics/installer golden fixtures"), "roadmap omits runtime Windows diagnostics/installer golden fixture evidence");
assert(checklist.includes("runtime Windows telemetry golden fixtures"), "checklist omits runtime Windows telemetry golden fixture evidence");
assert(roadmap.includes("runtime Windows telemetry golden fixtures"), "roadmap omits runtime Windows telemetry fixture evidence");
assert(checklist.includes("runtime-security-artifact-golden-agent"), "checklist omits runtime security artifact golden fixture agent record");
assert(checklist.includes("runtime security/SBOM/binary artifact golden fixtures"), "checklist omits runtime security/SBOM/binary artifact fixture evidence");
assert(roadmap.includes("runtime security/SBOM/binary artifact golden fixtures"), "roadmap omits runtime security/SBOM/binary artifact fixture evidence");
assert(checklist.includes("security-scan-report-input-agent"), "checklist omits security scan report input agent record");
assert(checklist.includes("Security scan report input"), "checklist omits security scan report input evidence");
assert(roadmap.includes("Security scan report input"), "roadmap omits security scan report input evidence");
assert(checklist.includes("runtime-ops-design-golden-agent"), "checklist omits runtime ops/design golden fixture agent record");
assert(checklist.includes("runtime ops/design golden fixtures"), "checklist omits runtime ops/design golden fixture evidence");
assert(roadmap.includes("runtime ops/design golden fixtures"), "roadmap omits runtime ops/design golden fixture evidence");
assert(checklist.includes("runtime-windows-native-golden-agent"), "checklist omits runtime Windows-native golden fixture agent record");
assert(checklist.includes("runtime Windows-native golden fixtures"), "checklist omits runtime Windows-native golden fixture evidence");
assert(roadmap.includes("runtime Windows-native golden fixtures"), "roadmap omits runtime Windows-native golden fixture evidence");
assert(checklist.includes("runtime-office-workbook-golden-agent"), "checklist omits runtime Office/workbook golden fixture agent record");
assert(checklist.includes("runtime Office/workbook golden fixtures"), "checklist omits runtime Office/workbook golden fixture evidence");
assert(roadmap.includes("runtime Office/workbook golden fixtures"), "roadmap omits runtime Office/workbook fixture evidence");
assert(checklist.includes("runtime-data-network-golden-agent"), "checklist omits runtime data/network golden fixture agent record");
assert(checklist.includes("runtime data/network golden fixtures"), "checklist omits runtime data/network golden fixture evidence");
assert(roadmap.includes("runtime data/network golden fixtures"), "roadmap omits runtime data/network fixture evidence");
assert(checklist.includes("runtime-test-report-golden-agent"), "checklist omits runtime test report golden fixture agent record");
assert(checklist.includes("runtime test report golden fixtures"), "checklist omits runtime test report fixture evidence");
assert(roadmap.includes("runtime test report golden fixtures"), "roadmap omits runtime test report fixture evidence");
assert(checklist.includes("runtime-content-media-golden-agent"), "checklist omits runtime content/media golden fixture agent record");
assert(checklist.includes("runtime content/media golden fixtures"), "checklist omits runtime content/media fixture evidence");
assert(roadmap.includes("runtime content/media golden fixtures"), "roadmap omits runtime content/media fixture evidence");
assert(checklist.includes("runtime-font-container-variant-agent"), "checklist omits runtime font container variant agent record");
assert(checklist.includes("runtime WOFF/WOFF2 font golden fixtures"), "checklist omits runtime WOFF/WOFF2 font fixture evidence");
assert(roadmap.includes("runtime WOFF/WOFF2 font golden fixtures"), "roadmap omits runtime WOFF/WOFF2 font fixture evidence");
assert(checklist.includes("runtime-link-shortcut-golden-agent"), "checklist omits runtime link shortcut golden fixture agent record");
assert(checklist.includes("link shortcut URL/host/redaction evidence"), "checklist omits runtime link shortcut golden fixture evidence");
assert(roadmap.includes("link shortcut URL/host previews with token redaction"), "roadmap omits runtime link shortcut fixture evidence");
assert(checklist.includes("runtime-mobile-manifest-golden-agent"), "checklist omits runtime mobile manifest golden fixture agent record");
assert(checklist.includes("runtime mobile manifest golden fixtures"), "checklist omits runtime mobile manifest fixture evidence");
assert(roadmap.includes("runtime mobile manifest golden fixtures"), "roadmap omits runtime mobile manifest fixture evidence");
assert(checklist.includes("runtime-mobile-app-package-golden-agent"), "checklist omits runtime mobile app package golden fixture agent record");
assert(checklist.includes("runtime mobile app package golden fixtures"), "checklist omits runtime mobile app package fixture evidence");
assert(roadmap.includes("runtime mobile app package golden fixtures"), "roadmap omits runtime mobile app package fixture evidence");
assert(checklist.includes("web-crawl-metadata-input-agent"), "checklist omits web crawl metadata input agent record");
assert(checklist.includes("Web crawl metadata input"), "checklist omits web crawl metadata input evidence");
assert(roadmap.includes("Web crawl metadata input"), "roadmap omits web crawl metadata input evidence");
assert(checklist.includes("runtime-3d-model-golden-agent"), "checklist omits runtime 3D model golden fixture agent record");
assert(checklist.includes("runtime 3D model golden fixtures"), "checklist omits runtime 3D model fixture evidence");
assert(roadmap.includes("runtime 3D model golden fixtures"), "roadmap omits runtime 3D model fixture evidence");
assert(checklist.includes("runtime-scheduled-task-golden-agent"), "checklist omits runtime scheduled task golden fixture agent record");
assert(checklist.includes("runtime scheduled task golden fixture"), "checklist omits runtime scheduled task golden fixture evidence");
assert(roadmap.includes("runtime scheduled task golden fixture"), "roadmap omits runtime scheduled task fixture evidence");
assert(checklist.includes("runtime extended audio golden fixtures"), "checklist omits runtime extended audio fixture evidence");
assert(roadmap.includes("runtime extended audio golden fixtures"), "roadmap omits runtime extended audio fixture evidence");
assert(checklist.includes("runtime static analysis XML golden fixture"), "checklist omits runtime static analysis XML fixture evidence");
assert(roadmap.includes("runtime static analysis XML golden fixture"), "roadmap omits runtime static analysis XML fixture evidence");
assert(checklist.includes("runtime-ci-workflow-golden-agent"), "checklist omits runtime CI/CD workflow golden fixture agent record");
assert(checklist.includes("runtime CI/CD workflow golden fixtures"), "checklist omits runtime CI/CD workflow fixture evidence");
assert(roadmap.includes("runtime CI/CD workflow golden fixtures"), "roadmap omits runtime CI/CD workflow fixture evidence");
assert(checklist.includes("runtime-repository-governance-golden-agent"), "checklist omits runtime repository governance golden fixture agent record");
assert(checklist.includes("runtime repository governance golden fixtures"), "checklist omits runtime repository governance fixture evidence");
assert(roadmap.includes("runtime repository governance golden fixtures"), "roadmap omits runtime repository governance fixture evidence");
assert(checklist.includes("runtime-lockfile-golden-agent"), "checklist omits runtime lockfile golden fixture agent record");
assert(checklist.includes("runtime dependency lockfile golden fixtures"), "checklist omits runtime dependency lockfile fixture evidence");
assert(roadmap.includes("runtime dependency lockfile golden fixtures"), "roadmap omits runtime dependency lockfile fixture evidence");
assert(checklist.includes("runtime-msbuild-solution-golden-agent"), "checklist omits runtime MSBuild/Solution golden fixture agent record");
assert(checklist.includes("runtime MSBuild/Solution golden fixtures"), "checklist omits runtime MSBuild/Solution fixture evidence");
assert(roadmap.includes("runtime MSBuild/Solution golden fixtures"), "roadmap omits runtime MSBuild/Solution fixture evidence");
assert(checklist.includes("runtime-metrics-extension-golden-agent"), "checklist omits runtime .metrics golden fixture agent record");
assert(checklist.includes("Runtime .metrics Golden Fixture"), "checklist omits runtime .metrics fixture evidence");
assert(roadmap.includes("runtime .metrics golden fixture"), "roadmap omits runtime .metrics fixture evidence");
assert(checklist.includes("runtime-package-config-variant-golden-agent"), "checklist omits runtime package/config variant golden fixture agent record");
assert(checklist.includes("runtime package/config variant golden fixtures"), "checklist omits runtime package/config variant fixture evidence");
assert(roadmap.includes("runtime package/config variant golden fixtures"), "roadmap omits runtime package/config variant fixture evidence");
assert(checklist.includes("runtime-lcov-coverage-golden-agent"), "checklist omits runtime LCOV coverage golden fixture agent record");
assert(checklist.includes("runtime LCOV coverage golden fixture"), "checklist omits runtime LCOV coverage fixture evidence");
assert(roadmap.includes("runtime LCOV coverage golden fixture"), "roadmap omits runtime LCOV coverage fixture evidence");
assert(checklist.includes("coverage-clover-golden-agent"), "checklist omits Clover coverage golden fixture agent record");
assert(checklist.includes("runtime Clover coverage golden fixture"), "checklist omits Clover coverage fixture evidence");
assert(roadmap.includes("runtime Clover coverage golden fixture"), "roadmap omits Clover coverage fixture evidence");
assert(checklist.includes("runtime-scientific-columnar-variant-agent"), "checklist omits runtime scientific/container and Feather variant fixture agent record");
assert(checklist.includes("runtime scientific/container and Feather variant golden fixtures"), "checklist omits runtime scientific/container and Feather variant fixture evidence");
assert(roadmap.includes("runtime scientific/container and Feather variant golden fixtures"), "roadmap omits runtime scientific/container and Feather variant fixture evidence");
assert(checklist.includes("runtime-env-config-golden-agent"), "checklist omits runtime .env config golden fixture agent record");
assert(checklist.includes("runtime .env configuration golden fixture"), "checklist omits runtime .env config fixture evidence");
assert(roadmap.includes("runtime .env configuration golden fixture"), "roadmap omits runtime .env config fixture evidence");
assert(checklist.includes("runtime-delimited-data-golden-agent"), "checklist omits runtime delimited data golden fixture agent record");
assert(checklist.includes("runtime CSV/TSV structured data golden fixtures"), "checklist omits runtime delimited data fixture evidence");
assert(roadmap.includes("runtime CSV/TSV structured data golden fixtures"), "roadmap omits runtime delimited data fixture evidence");

const tempRoot = mkdtempSync(join(tmpdir(), "drsai-channel-fixtures-"));
try {
  const workspace = join(tempRoot, "workspace");
  mkdirSync(workspace, { recursive: true });
  const githubWorkflowDir = join(workspace, ".github", "workflows");
  const codeownersPath = join(workspace, "CODEOWNERS");
  const editorconfigPath = join(workspace, ".editorconfig");
  const gitattributesPath = join(workspace, ".gitattributes");
  const gitignorePath = join(workspace, ".gitignore");
  const licensePath = join(workspace, "LICENSE");
  const noticePath = join(workspace, "NOTICE");
  const dotenvPath = join(workspace, ".env.runtime");
  const packagePath = join(workspace, "package.json");
  const yarnrcPath = join(workspace, ".yarnrc.yml");
  const packageLockPath = join(workspace, "package-lock.json");
  const pnpmLockPath = join(workspace, "pnpm-lock.yaml");
  const yarnLockPath = join(workspace, "yarn.lock");
  const cargoLockPath = join(workspace, "Cargo.lock");
  const goSumPath = join(workspace, "go.sum");
  const coveragePath = join(workspace, "coverage.xml");
  const lcovPath = join(workspace, "lcov.info");
  const cloverPath = join(workspace, "clover.xml");
  const checkstylePath = join(workspace, "runtime.checkstyle.xml");
  const junitPath = join(workspace, "runtime.junit.xml");
  const trxPath = join(workspace, "runtime.trx");
  const tapPath = join(workspace, "runtime.tap");
  const playwrightJsonPath = join(workspace, "runtime.playwright.json");
  const stylePath = join(workspace, "style.css");
  const metricsPath = join(workspace, "runtime.prom");
  const metricsExtensionPath = join(workspace, "runtime.metrics");
  const openMetricsPath = join(workspace, "runtime.openmetrics");
  const powershellPath = join(workspace, "runtime.ps1");
  const batchPath = join(workspace, "runtime.cmd");
  const hdf5Path = join(workspace, "sample.h5");
  const netcdfPath = join(workspace, "runtime.nc");
  const matPath = join(workspace, "runtime.mat");
  const githubActionsPath = join(githubWorkflowDir, "runtime.yml");
  const gitlabCiPath = join(workspace, ".gitlab-ci.yml");
  const azurePipelinesPath = join(workspace, "azure-pipelines.yml");
  const composePath = join(workspace, "docker-compose.yaml");
  const cmakePath = join(workspace, "CMakeLists.txt");
  const compileCommandsPath = join(workspace, "compile_commands.json");
  const gradlePropertiesPath = join(workspace, "gradle.properties");
  const solutionPath = join(workspace, "RuntimeFixture.sln");
  const csprojPath = join(workspace, "RuntimeFixture.csproj");
  const mavenDir = join(workspace, ".mvn");
  const mavenConfigPath = join(mavenDir, "maven.config");
  const jvmConfigPath = join(mavenDir, "jvm.config");
  const dotnetGlobalPath = join(workspace, "global.json");
  const nugetConfigPath = join(workspace, "nuget.config");
  const packagesConfigPath = join(workspace, "packages.config");
  const nuspecPath = join(workspace, "RuntimeFixture.nuspec");
  const goModPath = join(workspace, "go.mod");
  const requirementsPath = join(workspace, "requirements-dev.txt");
  const pdfPath = join(workspace, "fixture.pdf");
  const zipPath = join(workspace, "fixture.zip");
  const stlPath = join(workspace, "fixture.stl");
  const objPath = join(workspace, "runtime.obj");
  const gltfPath = join(workspace, "runtime.gltf");
  const glbPath = join(workspace, "runtime.glb");
  const cargoPath = join(workspace, "Cargo.toml");
  const pyprojectPath = join(workspace, "pyproject.toml");
  const pipfilePath = join(workspace, "Pipfile");
  const pythonEnvironmentPath = join(workspace, "environment.yml");
  const uvLockPath = join(workspace, "uv.lock");
  const pubspecPath = join(workspace, "pubspec.yaml");
  const pubspecLockPath = join(workspace, "pubspec.lock");
  const packageSwiftPath = join(workspace, "Package.swift");
  const composerPath = join(workspace, "composer.json");
  const gemfilePath = join(workspace, "Gemfile");
  const gemspecPath = join(workspace, "runtime_fixture.gemspec");
  const npmrcPath = join(workspace, ".npmrc");
  const mixPath = join(workspace, "mix.exs");
  const stackPath = join(workspace, "stack.yaml");
  const cabalPath = join(workspace, "runtime-fixture.cabal");
  const emlPath = join(workspace, "message.eml");
  const mboxPath = join(workspace, "mailbox.mbox");
  const vcardPath = join(workspace, "contact.vcf");
  const icsPath = join(workspace, "calendar.ics");
  const icalPath = join(workspace, "calendar.ical");
  const evtxPath = join(workspace, "runtime.evtx");
  const etlPath = join(workspace, "runtime.etl");
  const etwManifestPath = join(workspace, "runtime.man");
  const blgPath = join(workspace, "runtime.blg");
  const werPath = join(workspace, "runtime.wer");
  const msiPath = join(workspace, "runtime.msi");
  const appxManifestPath = join(workspace, "Package.appxmanifest");
  const taskPath = join(workspace, "RuntimeFixture.task");
  const infPath = join(workspace, "runtime.inf");
  const catPath = join(workspace, "runtime.cat");
  const openApiPath = join(workspace, "openapi.yaml");
  const insomniaPath = join(workspace, "insomnia.json");
  const postmanEnvironmentPath = join(workspace, "runtime.postman_environment.json");
  const brunoPath = join(workspace, "runtime.bru");
  const graphqlPath = join(workspace, "schema.graphql");
  const restClientPath = join(workspace, "runtime.http");
  const restClientRestPath = join(workspace, "runtime.rest");
  const protoPath = join(workspace, "runtime.proto");
  const dockerfilePath = join(workspace, "Dockerfile");
  const chartPath = join(workspace, "Chart.yaml");
  const kustomizationPath = join(workspace, "kustomization.yaml");
  const sarifPath = join(workspace, "results.sarif");
  const securityAuditPath = join(workspace, "npm-audit.json");
  const cyclonedxPath = join(workspace, "cyclonedx.json");
  const spdxPath = join(workspace, "runtime.spdx");
  const syftPath = join(workspace, "syft.json");
  const pemPath = join(workspace, "runtime.crt");
  const checksumPath = join(workspace, "checksums.sha256");
  const wasmPath = join(workspace, "runtime.wasm");
  const exePath = join(workspace, "runtime.exe");
  const jarPath = join(workspace, "runtime.jar");
  const classPath = join(workspace, "RuntimeFixture.class");
  const geojsonPath = join(workspace, "runtime.geojson");
  const terraformPath = join(workspace, "runtime.tf");
  const terraformPlanPath = join(workspace, "runtime.tfplan.json");
  const cloudFormationPath = join(workspace, "runtime.cloudformation.yaml");
  const armTemplatePath = join(workspace, "runtime.arm-template.json");
  const bicepPath = join(workspace, "runtime.bicep");
  const ansiblePath = join(workspace, "runtime-playbook.yaml");
  const dxfPath = join(workspace, "runtime.dxf");
  const mermaidPath = join(workspace, "runtime.mmd");
  const graphvizPath = join(workspace, "runtime.dot");
  const scssPath = join(workspace, "runtime.scss");
  const msgPath = join(workspace, "runtime.msg");
  const lnkPath = join(workspace, "runtime.lnk");
  const regPath = join(workspace, "runtime.reg");
  const wprpPath = join(workspace, "runtime.wprp");
  const dmpPath = join(workspace, "runtime.dmp");
  const docxPath = join(workspace, "runtime.docx");
  const xlsxPath = join(workspace, "runtime.xlsx");
  const xlsmPath = join(workspace, "runtime.xlsm");
  const pptxPath = join(workspace, "runtime.pptx");
  const odtPath = join(workspace, "runtime.odt");
  const docPath = join(workspace, "runtime.doc");
  const xlsPath = join(workspace, "runtime.xls");
  const sqlitePath = join(workspace, "runtime.sqlite");
  const sqlPath = join(workspace, "schema.sql");
  const csvPath = join(workspace, "runtime.csv");
  const tsvPath = join(workspace, "runtime.tsv");
  const jsonlPath = join(workspace, "events.jsonl");
  const harPath = join(workspace, "runtime.har");
  const devtoolsTracePath = join(workspace, "runtime.trace.json");
  const lighthousePath = join(workspace, "runtime.lighthouse.json");
  const pcapPath = join(workspace, "runtime.pcap");
  const pcapngPath = join(workspace, "runtime.pcapng");
  const notebookPath = join(workspace, "runtime.ipynb");
  const parquetPath = join(workspace, "runtime.parquet");
  const arrowPath = join(workspace, "runtime.arrow");
  const featherPath = join(workspace, "runtime.feather");
  const epubPath = join(workspace, "runtime.epub");
  const ttfPath = join(workspace, "runtime.ttf");
  const woffPath = join(workspace, "runtime.woff");
  const woff2Path = join(workspace, "runtime.woff2");
  const bookmarksPath = join(workspace, "bookmarks.html");
  const urlShortcutPath = join(workspace, "runtime.url");
  const weblocPath = join(workspace, "runtime.webloc");
  const rssPath = join(workspace, "feed.rss");
  const atomPath = join(workspace, "feed.atom");
  const robotsPath = join(workspace, "robots.txt");
  const sitemapPath = join(workspace, "sitemap.xml");
  const sitemapGzipPath = join(workspace, "sitemap.xml.gz");
  const srtPath = join(workspace, "captions.srt");
  const vttPath = join(workspace, "captions.vtt");
  const androidManifestPath = join(workspace, "AndroidManifest.xml");
  const infoPlistPath = join(workspace, "Info.plist");
  const apkPath = join(workspace, "runtime.apk");
  const aabPath = join(workspace, "runtime.aab");
  const ipaPath = join(workspace, "runtime.ipa");
  const flacPath = join(workspace, "runtime.flac");
  const m4aPath = join(workspace, "runtime.m4a");
  const oggPath = join(workspace, "runtime.ogg");

  writeText(codeownersPath, [
    "# Runtime ownership fixture",
    "* @opendrsai/core",
    "/apps/desktop/windows/ @opendrsai/windows @opendrsai/release",
    "docs/** @opendrsai/docs",
  ].join("\n"));
  writeText(editorconfigPath, [
    "root = true",
    "",
    "[*]",
    "indent_style = space",
    "indent_size = 2",
    "",
    "[*.md]",
    "trim_trailing_whitespace = false",
  ].join("\n"));
  writeText(gitattributesPath, [
    "*.ps1 text eol=crlf",
    "*.png binary",
    "release/** export-ignore",
  ].join("\n"));
  writeText(gitignorePath, [
    "node_modules/",
    "release/",
    "*.local",
  ].join("\n"));
  writeText(licensePath, [
    "MIT License",
    "",
    "Copyright (c) 2026 OpenDrSai Runtime Fixture",
    "",
    "Permission is hereby granted, free of charge, to any person obtaining a copy.",
  ].join("\n"));
  writeText(noticePath, [
    "OpenDrSai Runtime Fixture Notice",
    "Copyright 2026 OpenDrSai Runtime Fixture Contributors.",
    "This notice is a bounded local governance fixture.",
  ].join("\n"));
  writeText(dotenvPath, [
    "RUNTIME_MODE=review",
    "API_TOKEN=secret-env-token",
    "PUBLIC_URL=https://example.test/runtime?token=secret-env-query",
    "DUPLICATE_KEY=first",
    "DUPLICATE_KEY=second",
  ].join("\n"));
  writeText(packagePath, JSON.stringify({
    name: "runtime-fixture-app",
    version: "1.0.0",
    type: "module",
    packageManager: "pnpm@9.12.0",
    scripts: { test: "vitest" },
    dependencies: { react: "19.2.1" },
    devDependencies: { vite: "^7.3.6" },
    workspaces: ["packages/*"],
    exports: { ".": "./src/index.ts" },
    engines: { node: ">=22" },
  }, null, 2));
  writeText(yarnrcPath, [
    "nodeLinker: pnp",
    "npmRegistryServer: https://registry.yarnpkg.com",
    "npmScopes:",
    "  runtime:",
    "    npmRegistryServer: https://npm.example.test?token=secret-yarn-token",
  ].join("\n"));
  writeText(packageLockPath, JSON.stringify({
    name: "runtime-fixture-app",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "runtime-fixture-app",
        dependencies: {
          react: "19.2.1",
          "@opendrsai/runtime-helper": "1.0.0",
        },
      },
      "node_modules/react": {
        version: "19.2.1",
        dependencies: {
          scheduler: "^0.27.0",
        },
      },
      "node_modules/@opendrsai/runtime-helper": {
        version: "1.0.0",
        optionalDependencies: {
          "runtime-optional": "^1.0.0",
        },
      },
    },
  }, null, 2));
  writeText(pnpmLockPath, [
    "lockfileVersion: '9.0'",
    "importers:",
    "  .:",
    "    dependencies:",
    "      react:",
    "        specifier: 19.2.1",
    "        version: 19.2.1",
    "packages:",
    "  /react@19.2.1:",
    "    resolution: {integrity: sha512-runtime}",
    "    dependencies:",
    "      scheduler: 0.27.0",
    "  /scheduler@0.27.0:",
    "    resolution: {integrity: sha512-runtime-scheduler}",
  ].join("\n"));
  writeText(yarnLockPath, [
    "# yarn lockfile v1",
    "",
    'react@^19.2.1:',
    '  version "19.2.1"',
    "  dependencies:",
    '    scheduler "^0.27.0"',
    "",
    'scheduler@^0.27.0:',
    '  version "0.27.0"',
  ].join("\n"));
  writeText(cargoLockPath, [
    "# This file is automatically @generated by Cargo.",
    "[[package]]",
    'name = "runtime-crate"',
    'version = "0.1.0"',
    'dependencies = ["serde", "tokio"]',
    "",
    "[[package]]",
    'name = "serde"',
    'version = "1.0.210"',
    "",
    "[[package]]",
    'name = "tokio"',
    'version = "1.40.0"',
  ].join("\n"));
  writeText(goSumPath, [
    "github.com/stretchr/testify v1.10.0 h1:runtime",
    "github.com/stretchr/testify v1.10.0/go.mod h1:runtime-mod",
    "golang.org/x/sys v0.28.0 h1:runtime-sys",
  ].join("\n"));
  writeText(coveragePath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<coverage line-rate="0.75" branch-rate="0.5">',
    '  <packages><package name="core"><classes><class filename="src/app.ts" /></classes></package></packages>',
    "</coverage>",
  ].join("\n"));
  writeText(lcovPath, [
    "TN:runtime-lcov-fixture",
    "SF:src/chatbar/runtime.ts",
    "DA:1,1",
    "DA:2,0",
    "DA:3,1",
    "BRDA:2,0,0,1",
    "BRDA:2,0,1,0",
    "LF:3",
    "LH:2",
    "BRF:2",
    "BRH:1",
    "end_of_record",
    "SF:src/chatbar/secret-token.ts",
    "DA:1,0",
    "LF:1",
    "LH:0",
    "end_of_record",
  ].join("\n"));
  writeText(cloverPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<coverage generated="1783677600" clover="4.5.2">',
    '  <project timestamp="1783677600">',
    '    <metrics files="2" loc="80" ncloc="60" classes="2" methods="5" coveredmethods="4" statements="10" coveredstatements="7" conditionals="4" coveredconditionals="3" elements="19" coveredelements="14"/>',
    '    <package name="chatbar.runtime">',
    '      <file name="runtime.ts" path="src/chatbar/runtime.ts"><metrics statements="6" coveredstatements="5" conditionals="2" coveredconditionals="2"/></file>',
    '      <file name="secret-token.ts" path="src/chatbar/secret-token.ts"><metrics statements="4" coveredstatements="2" conditionals="2" coveredconditionals="1"/></file>',
    '    </package>',
    "  </project>",
    "</coverage>",
  ].join("\n"));
  writeText(checkstylePath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<checkstyle version="10.12.0">',
    '  <file name="src/main/RuntimeFixture.java">',
    '    <error line="12" severity="warning" message="Avoid runtime fixture token=secret-checkstyle-token" source="com.puppycrawl.tools.checkstyle.checks.coding.MagicNumberCheck" />',
    '    <error line="24" severity="error" message="Runtime import order failed" source="com.puppycrawl.tools.checkstyle.checks.imports.ImportOrderCheck" />',
    "  </file>",
    "</checkstyle>",
  ].join("\n"));
  writeText(junitPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="runtime-fixture-suites" tests="3" failures="1" errors="0" skipped="1" time="4.25">',
    '  <testsuite name="RuntimeFixtureSuite" tests="3" failures="1" errors="0" skipped="1" time="4.25">',
    '    <testcase classname="RuntimeFixture" name="passes" time="1.00" />',
    '    <testcase classname="RuntimeFixture" name="fails" time="2.00"><failure message="expected runtime value">Assertion failed</failure></testcase>',
    '    <testcase classname="RuntimeFixture" name="skips" time="0.00"><skipped /></testcase>',
    "  </testsuite>",
    "</testsuites>",
  ].join("\n"));
  writeText(trxPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TestRun name="RuntimeFixtureRun">',
    '  <ResultSummary outcome="Failed">',
    '    <Counters total="3" executed="3" passed="2" failed="1" error="0" timeout="0" aborted="0" notExecuted="0" notRunnable="0" />',
    "  </ResultSummary>",
    "  <Results>",
    '    <UnitTestResult testName="RuntimeTrxPass" outcome="Passed" />',
    '    <UnitTestResult testName="RuntimeTrxFail" outcome="Failed"><Output><ErrorInfo><Message>TRX runtime failure</Message></ErrorInfo></Output></UnitTestResult>',
    "  </Results>",
    "</TestRun>",
  ].join("\n"));
  writeText(tapPath, [
    "TAP version 13",
    "1..4",
    "ok 1 Runtime TAP pass",
    "not ok 2 Runtime TAP failure # TODO flaky token=secret-tap-token",
    "ok 3 Runtime TAP skip # SKIP missing fixture service",
    "not ok 4 Runtime TAP hard failure",
  ].join("\n"));
  writeText(playwrightJsonPath, JSON.stringify({
    config: { rootDir: workspace },
    stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 1, duration: 3456 },
    suites: [
      {
        title: "Runtime Playwright Suite",
        specs: [
          {
            title: "renders chat bar",
            tests: [{ title: "renders chat bar", results: [{ status: "passed", duration: 1200 }] }],
          },
          {
            title: "handles failed stream",
            tests: [{
              title: "handles failed stream",
              results: [{ status: "failed", duration: 2100, error: { message: "Runtime JSON failure token=secret-json-token" } }],
            }],
          },
          {
            title: "skips provider",
            tests: [{ title: "skips provider", results: [{ status: "skipped", duration: 0 }] }],
          },
        ],
      },
    ],
  }, null, 2));
  writeText(stylePath, [
    ":root { --accent: #005fcc; }",
    "@media screen and (min-width: 640px) {",
    "  .toolbar { background-image: url(./toolbar.png); }",
    "}",
  ].join("\n"));
  writeText(metricsPath, [
    "# HELP runtime_requests_total Runtime request count with secret token redaction",
    "# TYPE runtime_requests_total counter",
    'runtime_requests_total{job="desktop",instance="local",token="secret-metrics-token"} 42 1783598400000',
    "# HELP runtime_latency_seconds Runtime request latency",
    "# TYPE runtime_latency_seconds histogram",
    'runtime_latency_seconds_bucket{le="0.5",route="/chat"} 7',
    'runtime_latency_seconds_sum{route="/chat"} 1.25',
    "# EOF",
  ].join("\n"));
  writeText(metricsExtensionPath, [
    "# HELP runtime_worker_jobs Runtime worker job count",
    "# TYPE runtime_worker_jobs gauge",
    'runtime_worker_jobs{queue="scheduled",credential="secret-metrics-extension-token"} 8',
    "# HELP runtime_worker_seconds Runtime worker duration",
    "# TYPE runtime_worker_seconds summary",
    'runtime_worker_seconds_sum{queue="scheduled"} 12.5',
    'runtime_worker_seconds_count{queue="scheduled"} 4',
    "# EOF",
  ].join("\n"));
  writeText(openMetricsPath, [
    "# HELP runtime_queue_depth Runtime queue depth",
    "# TYPE runtime_queue_depth gauge",
    'runtime_queue_depth{queue="agent",credential="secret-openmetrics-token"} 3',
    "# HELP runtime_dispatch_duration_seconds Runtime dispatch duration",
    "# TYPE runtime_dispatch_duration_seconds summary",
    'runtime_dispatch_duration_seconds_sum{agent="planner"} 2.5',
    'runtime_dispatch_duration_seconds_count{agent="planner"} 5',
    "# EOF",
  ].join("\n"));
  writeText(powershellPath, [
    "<#",
    ".SYNOPSIS",
    "Runtime PowerShell fixture",
    ".PARAMETER Path",
    "Workspace path to inspect.",
    "#>",
    "#requires -Modules Pester",
    "param(",
    "  [Parameter(Mandatory=$true)][string]$Path,",
    "  [string]$ApiToken = 'secret-powershell-token'",
    ")",
    "Import-Module Microsoft.PowerShell.Management",
    "function Invoke-RuntimeFixture {",
    "  param([string]$Name)",
    "  Invoke-WebRequest \"https://example.test/runtime?token=$ApiToken\"",
    "  Start-Process pwsh.exe -ArgumentList '-NoProfile'",
    "  Remove-Item -LiteralPath $Path -WhatIf",
    "}",
  ].join("\n"));
  writeText(batchPath, [
    "@echo off",
    "rem Runtime batch fixture token=secret-batch-token",
    "set API_TOKEN=secret-batch-token",
    "set WORKSPACE=C:\\Runtime\\fixture",
    "call tools\\prepare-runtime.cmd --token=%API_TOKEN%",
    "start \"Runtime Worker\" cmd.exe /c node worker.js",
    "curl https://example.test/runtime?token=secret-batch-token",
    "robocopy %WORKSPACE%\\src %WORKSPACE%\\out /MIR",
    "reg query HKCU\\Software\\OpenDrSai",
    ":review",
    "if exist \"%WORKSPACE%\\out\" goto done",
    ":done",
  ].join("\n"));
  writeHdf5Like(hdf5Path);
  writeNetcdfFixture(netcdfPath);
  writeMatlabMatFixture(matPath);
  mkdirSync(githubWorkflowDir, { recursive: true });
  writeText(githubActionsPath, [
    "name: Runtime CI",
    "on:",
    "  push:",
    "  pull_request:",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: Test",
    "        run: npm test -- --token secret-ci-token",
  ].join("\n"));
  writeText(gitlabCiPath, [
    "stages:",
    "  - test",
    "image: node:22",
    "runtime-test:",
    "  stage: test",
    "  script:",
    "    - npm test -- --token secret-ci-token",
    "  rules:",
    "    - if: $CI_COMMIT_BRANCH",
  ].join("\n"));
  writeText(azurePipelinesPath, [
    "trigger:",
    "  - main",
    "pr:",
    "  - main",
    "pool:",
    "  vmImage: windows-latest",
    "jobs:",
    "  - job: runtime_windows",
    "    steps:",
    "      - task: NodeTool@0",
    "      - script: npm test -- --token secret-ci-token",
  ].join("\n"));
  writeText(composePath, [
    "services:",
    "  api:",
    "    image: ghcr.io/example/api:latest",
    "    depends_on:",
    "      - db",
    "  db:",
    "    image: postgres:16",
  ].join("\n"));
  writeText(chartPath, [
    "apiVersion: v2",
    "name: runtime-chart",
    "description: Runtime fixture Helm chart",
    "type: application",
    "version: 0.3.0",
    "appVersion: 1.2.3",
    "dependencies:",
    "  - name: runtime-lib",
    "    version: 1.2.3",
    "    repository: https://charts.example.test/runtime?token=secret-helm-token",
  ].join("\n"));
  writeText(kustomizationPath, [
    "apiVersion: kustomize.config.k8s.io/v1beta1",
    "kind: Kustomization",
    "namespace: runtime-system",
    "resources:",
    "  - deployment.yaml",
    "  - service.yaml",
    "images:",
    "  - name: ghcr.io/example/runtime",
    "    newName: ghcr.io/example/runtime-app",
    "    newTag: v1.2.3",
    "patches:",
    "  - path: patches/deployment.yaml",
  ].join("\n"));
  writeText(cmakePath, [
    "cmake_minimum_required(VERSION 3.22)",
    "project(RuntimeFixture LANGUAGES CXX)",
    "find_package(Threads REQUIRED)",
    "add_executable(runtime_fixture src/main.cpp)",
  ].join("\n"));
  writeText(compileCommandsPath, JSON.stringify([
    {
      directory: workspace,
      command: "clang++ -Iinclude -c src/main.cpp",
      file: "src/main.cpp",
    },
  ], null, 2));
  writeText(gradlePropertiesPath, [
    "org.gradle.jvmargs=-Xmx2g",
    "systemProp.http.proxyHost=proxy.local",
  ].join("\n"));
  writeText(solutionPath, [
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio Version 17",
    'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "RuntimeFixture", "RuntimeFixture.csproj", "{11111111-1111-1111-1111-111111111111}"',
    "EndProject",
    "Global",
    "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
    "\t\tDebug|Any CPU = Debug|Any CPU",
    "\tEndGlobalSection",
    "EndGlobal",
  ].join("\n"));
  writeText(csprojPath, [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup>",
    "    <OutputType>Exe</OutputType>",
    "    <TargetFramework>net8.0-windows</TargetFramework>",
    "  </PropertyGroup>",
    "  <ItemGroup>",
    '    <PackageReference Include="Microsoft.Extensions.Hosting" Version="8.0.0" />',
    '    <ProjectReference Include="..\\RuntimeShared\\RuntimeShared.csproj" />',
    '    <Import Project="build\\RuntimeFixture.props" />',
    "  </ItemGroup>",
    "</Project>",
  ].join("\n"));
  mkdirSync(mavenDir, { recursive: true });
  writeText(mavenConfigPath, [
    "--batch-mode",
    "-DskipTests",
  ].join("\n"));
  writeText(jvmConfigPath, [
    "-Xmx2g",
    "-XX:+UseG1GC",
    "-Druntime.token=secret-jvm-token",
  ].join("\n"));
  writeText(dotnetGlobalPath, JSON.stringify({
    sdk: {
      version: "8.0.303",
      rollForward: "latestFeature",
      allowPrerelease: false,
    },
    "msbuild-sdks": {
      "Microsoft.Build.NoTargets": "3.7.56",
    },
  }, null, 2));
  writeText(nugetConfigPath, [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<configuration>",
    "  <packageSources>",
    "    <add key=\"nuget.org\" value=\"https://api.nuget.org/v3/index.json\" />",
    "    <add key=\"runtime-feed\" value=\"https://nuget.example.test/index.json?token=secret-nuget-token\" />",
    "  </packageSources>",
    "  <disabledPackageSources>",
    "    <add key=\"legacy-feed\" value=\"true\" />",
    "  </disabledPackageSources>",
    "  <packageSourceCredentials>",
    "    <runtime-feed>",
    "      <add key=\"Username\" value=\"runtime-user\" />",
    "      <add key=\"ClearTextPassword\" value=\"secret-nuget-password\" />",
    "    </runtime-feed>",
    "  </packageSourceCredentials>",
    "</configuration>",
  ].join("\n"));
  writeText(packagesConfigPath, [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<packages>",
    "  <package id=\"Newtonsoft.Json\" version=\"13.0.3\" targetFramework=\"net48\" />",
    "  <package id=\"Serilog\" version=\"3.1.1\" targetFramework=\"net48\" />",
    "</packages>",
  ].join("\n"));
  writeText(nuspecPath, [
    "<?xml version=\"1.0\"?>",
    "<package>",
    "  <metadata>",
    "    <id>OpenDrSai.RuntimeFixture</id>",
    "    <version>1.2.3</version>",
    "    <authors>OpenDrSai</authors>",
    "    <license type=\"expression\">MIT</license>",
    "    <dependencies>",
    "      <dependency id=\"Microsoft.Extensions.Logging\" version=\"8.0.0\" />",
    "    </dependencies>",
    "  </metadata>",
    "  <files>",
    "    <file src=\"bin\\Release\\runtime.dll\" target=\"lib\\net8.0\" />",
    "  </files>",
    "</package>",
  ].join("\n"));
  writeText(goModPath, [
    "module example.com/runtime-fixture",
    "",
    "go 1.22",
    "",
    "require github.com/stretchr/testify v1.10.0",
  ].join("\n"));
  writeText(requirementsPath, [
    "pytest==8.3.4",
    "-r requirements.txt",
  ].join("\n"));
  writePdfFixture(pdfPath);
  writeZipFixture(zipPath);
  writeStlFixture(stlPath);
  writeText(objPath, [
    "# Runtime OBJ fixture",
    "mtllib runtime.mtl",
    "o RuntimeObjMesh",
    "g RuntimeGroup",
    "v 0 0 0",
    "v 1 0 0",
    "v 0 1 0",
    "vt 0 0",
    "vn 0 0 1",
    "usemtl RuntimeMaterial",
    "f 1/1/1 2/1/1 3/1/1",
  ].join("\n"));
  writeText(gltfPath, JSON.stringify({
    asset: { version: "2.0", generator: "OpenDrSai runtime fixture" },
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ name: "RuntimeGltfMesh", primitives: [{ attributes: { POSITION: 0 } }] }],
    materials: [{ name: "RuntimeMaterial" }],
    accessors: [{ componentType: 5126, count: 3, type: "VEC3" }],
    buffers: [{ byteLength: 0 }],
    extensionsUsed: ["KHR_materials_unlit"],
  }));
  writeGlbFixture(glbPath);
  writeText(cargoPath, [
    "[package]",
    'name = "runtime-fixture"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'serde = "1"',
    "",
    "[features]",
    "default = []",
  ].join("\n"));
  writeText(pyprojectPath, [
    "[build-system]",
    'requires = ["hatchling"]',
    'build-backend = "hatchling.build"',
    "",
    "[project]",
    'name = "runtime-py-fixture"',
    'version = "0.1.0"',
    'requires-python = ">=3.11"',
    'dependencies = ["requests>=2.32"]',
    "",
    "[project.optional-dependencies]",
    'test = ["pytest>=8"]',
  ].join("\n"));
  writeText(pipfilePath, [
    "[packages]",
    'fastapi = "*"',
    "",
    "[dev-packages]",
    'pytest = "*"',
    "",
    "[requires]",
    'python_version = "3.11"',
  ].join("\n"));
  writeText(pythonEnvironmentPath, [
    "name: runtime-py-fixture",
    "channels:",
    "  - conda-forge",
    "dependencies:",
    "  - python=3.11",
    "  - pip",
    "  - pip:",
    "      - httpx==0.27.0",
  ].join("\n"));
  writeText(uvLockPath, [
    'version = 1',
    'requires-python = ">=3.11"',
    "",
    "[[package]]",
    'name = "runtime-py-fixture"',
    'version = "0.1.0"',
    'source = { editable = "." }',
    "",
    "[[package]]",
    'name = "pytest"',
    'version = "8.3.4"',
  ].join("\n"));
  writeText(pubspecPath, [
    "name: runtime_fixture",
    "version: 1.0.0",
    "environment:",
    "  sdk: ^3.4.0",
    "dependencies:",
    "  flutter:",
    "    sdk: flutter",
    "dev_dependencies:",
    "  build_runner: ^2.4.0",
    "flutter:",
    "  uses-material-design: true",
  ].join("\n"));
  writeText(pubspecLockPath, [
    "packages:",
    "  runtime_fixture:",
    "    dependency: direct main",
    "    source: path",
    "    version: \"1.0.0\"",
    "  build_runner:",
    "    dependency: direct dev",
    "    source: hosted",
    "    version: \"2.4.0\"",
    "sdks:",
    "  dart: \">=3.4.0 <4.0.0\"",
    "  flutter: \">=3.22.0\"",
  ].join("\n"));
  writeText(packageSwiftPath, [
    "// swift-tools-version: 5.10",
    "import PackageDescription",
    "let package = Package(",
    '  name: "RuntimeFixture",',
    "  platforms: [.macOS(.v13)],",
    '  products: [.library(name: "RuntimeFixture", targets: ["RuntimeFixture"])],',
    '  dependencies: [.package(url: "https://example.test/runtime.git", from: "1.0.0")],',
    '  targets: [.target(name: "RuntimeFixture")]',
    ")",
  ].join("\n"));
  writeText(composerPath, JSON.stringify({
    name: "example/runtime-fixture",
    type: "project",
    require: { "monolog/monolog": "^3.0" },
    scripts: { test: "phpunit" },
  }, null, 2));
  writeText(gemfilePath, [
    'source "https://rubygems.org"',
    'gem "rack", "~> 3.0"',
    "group :test do",
    '  gem "rspec"',
    "end",
  ].join("\n"));
  writeText(gemspecPath, [
    "Gem::Specification.new do |spec|",
    '  spec.name = "runtime_fixture"',
    '  spec.version = "0.1.0"',
    '  spec.summary = "Runtime fixture gem"',
    '  spec.add_dependency "rack"',
    '  spec.executables = ["runtime-fixture"]',
    "end",
  ].join("\n"));
  writeText(npmrcPath, [
    "registry=https://registry.npmjs.org/",
    "cache=./.npm-cache",
    "//registry.npmjs.org/:_authToken=secret-token",
  ].join("\n"));
  writeText(mixPath, [
    "defmodule RuntimeFixture.MixProject do",
    "  use Mix.Project",
    "  def project do",
    '    [app: :runtime_fixture, version: "0.1.0", elixir: "~> 1.16", deps: deps()]',
    "  end",
    "  def application do",
    "    [extra_applications: [:logger]]",
    "  end",
    "  defp deps do",
    '    [{:jason, "~> 1.4"}]',
    "  end",
    "end",
  ].join("\n"));
  writeText(stackPath, [
    "resolver: lts-22.0",
    "packages:",
    "  - .",
    "extra-deps:",
    "  - text-2.0",
  ].join("\n"));
  writeText(cabalPath, [
    "cabal-version: 3.0",
    "name: runtime-fixture",
    "version: 0.1.0",
    "library",
    "  exposed-modules: Runtime.Fixture",
    "  build-depends: base >=4.18, text",
    "  default-language: Haskell2010",
  ].join("\n"));
  writeText(emlPath, [
    "From: Runtime Sender <sender@example.test>",
    "To: Reviewer <reviewer@example.test>",
    "Subject: Runtime fixture message",
    "Date: Thu, 9 Jul 2026 09:30:00 +0000",
    "",
    "This is a bounded runtime email fixture body.",
  ].join("\n"));
  writeText(mboxPath, [
    "From sender@example.test Thu Jul 09 09:30:00 2026",
    "From: Runtime Sender <sender@example.test>",
    "Subject: Runtime mailbox fixture",
    "Date: Thu, 9 Jul 2026 09:30:00 +0000",
    "",
    "Mailbox runtime fixture body.",
  ].join("\n"));
  writeText(vcardPath, [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Runtime Contact",
    "ORG:OpenDrSai Runtime",
    "TITLE:Fixture Reviewer",
    "EMAIL:runtime-contact@example.test",
    "TEL:+1-555-0100",
    "END:VCARD",
  ].join("\n"));
  writeText(icsPath, [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "SUMMARY:Runtime Fixture Review",
    "DTSTART:20260709T093000Z",
    "DTEND:20260709T100000Z",
    "LOCATION:Review Room",
    "ATTENDEE:mailto:reviewer@example.test",
    "DESCRIPTION:Review runtime fixture coverage",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n"));
  writeText(icalPath, [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "SUMMARY:Runtime ICAL Planning",
    "DTSTART:20260710T093000Z",
    "DTEND:20260710T100000Z",
    "LOCATION:Planning Room",
    "ATTENDEE:mailto:planner@example.test",
    "DESCRIPTION:Plan runtime ical fixture coverage",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n"));
  writeEvtxFixture(evtxPath);
  writeEtlFixture(etlPath);
  writeText(werPath, [
    "Version=1",
    "EventType=APPCRASH",
    "AppName=RuntimeFixture.exe",
    "FriendlyEventName=Stopped working",
    "Sig[0].Name=Application Name",
    "Sig[0].Value=RuntimeFixture.exe",
    "Sig[1].Name=Fault Module Name",
    "Sig[1].Value=runtime.dll",
  ].join("\n"));
  writeMsiFixture(msiPath);
  writeText(appxManifestPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">',
    '  <Identity Name="OpenDrSai.RuntimeFixture" Publisher="CN=OpenDrSai" Version="1.0.0.0" ProcessorArchitecture="x64" />',
    "  <Properties>",
    "    <DisplayName>Runtime Fixture</DisplayName>",
    "    <PublisherDisplayName>OpenDrSai</PublisherDisplayName>",
    "  </Properties>",
    "  <Applications>",
    '    <Application Id="App" Executable="RuntimeFixture.exe" EntryPoint="Windows.FullTrustApplication" />',
    "  </Applications>",
    "  <Capabilities>",
    '    <Capability Name="internetClient" />',
    "  </Capabilities>",
    "  <Dependencies>",
    '    <PackageDependency Name="Microsoft.VCLibs.140.00" MinVersion="14.0.0.0" Publisher="CN=Microsoft" />',
    "  </Dependencies>",
    "</Package>",
  ].join("\n"));
  writeText(taskPath, [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    "    <Author>OpenDrSai Runtime Fixture</Author>",
    "    <URI>\\OpenDrSai\\RuntimeFixture</URI>",
    "    <Description>Runtime scheduled task fixture</Description>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <CalendarTrigger>",
    "      <StartBoundary>2026-07-10T09:00:00</StartBoundary>",
    "      <Enabled>true</Enabled>",
    "      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
    "    </CalendarTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    "      <UserId>S-1-5-18</UserId>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>",
    "    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    "      <Command>C:\\Runtime\\fixture.exe</Command>",
    "      <Arguments>--mode review --token=secret-task-token</Arguments>",
    "      <WorkingDirectory>C:\\Runtime</WorkingDirectory>",
    "    </Exec>",
    "  </Actions>",
    "</Task>",
  ].join("\n"));
  writeText(infPath, [
    "[Version]",
    'Signature="$WINDOWS NT$"',
    "Class=Sample",
    "Provider=%RuntimeProvider%",
    "DriverVer=07/09/2026,1.0.0.0",
    "CatalogFile=runtime.cat",
    "",
    "[Manufacturer]",
    "%RuntimeProvider%=RuntimeModels,NTamd64",
    "",
    "[RuntimeModels.NTamd64]",
    "%RuntimeDevice%=RuntimeInstall,ROOT\\RUNTIMEFIXTURE",
    "",
    "[RuntimeInstall.Services]",
    "AddService=RuntimeFixture,0x00000002,RuntimeService",
  ].join("\n"));
  writeCatFixture(catPath);
  writeText(openApiPath, [
    "openapi: 3.1.0",
    "info:",
    "  title: Runtime Fixture API",
    "  version: 1.0.0",
    "servers:",
    "  - url: https://api.example.test/runtime?token=secret-token",
    "paths:",
    "  /runs:",
    "    get:",
    "      summary: List runtime runs",
    "      security:",
    "        - bearerAuth: []",
    "components:",
    "  securitySchemes:",
    "    bearerAuth:",
    "      type: http",
    "      scheme: bearer",
  ].join("\n"));
  writeText(insomniaPath, JSON.stringify({
    _type: "export",
    __export_format: 4,
    resources: [
      { _id: "wrk_runtime", _type: "workspace", name: "Runtime Insomnia Workspace" },
      { _id: "env_runtime", _type: "environment", parentId: "wrk_runtime", name: "Runtime Env", data: { token: "secret-insomnia-token" } },
      {
        _id: "req_list",
        _type: "request",
        parentId: "wrk_runtime",
        name: "Runtime Insomnia List",
        method: "GET",
        url: "https://api.example.test/insomnia/runs?token=secret-insomnia-token",
        authentication: { type: "bearer", token: "{{ token }}" },
      },
      {
        _id: "req_create",
        _type: "request",
        parentId: "wrk_runtime",
        name: "Runtime Insomnia Create",
        method: "POST",
        url: "{{ base_url }}/insomnia/runs",
      },
    ],
  }, null, 2));
  writeText(postmanEnvironmentPath, JSON.stringify({
    id: "runtime-postman-env",
    name: "Runtime Postman Environment",
    _postman_variable_scope: "environment",
    values: [
      { key: "baseUrl", value: "https://api.example.test", type: "default", enabled: true },
      { key: "apiToken", value: "secret-postman-env-token", type: "secret", enabled: true },
      { key: "disabledSecret", value: "disabled-postman-env-secret", type: "secret", enabled: false },
    ],
  }, null, 2));
  writeText(brunoPath, [
    "meta {",
    "  name: Runtime Bruno Create",
    "  type: http",
    "}",
    "",
    "auth {",
    "  mode: bearer",
    "}",
    "",
    "http {",
    "  method: POST",
    "  url: https://api.example.test/bruno/runs?token=secret-bruno-token",
    "}",
  ].join("\n"));
  writeText(graphqlPath, [
    "schema { query: Query mutation: Mutation }",
    "type Query { runtimeRun(id: ID!): RuntimeRun }",
    "type Mutation { startRuntimeRun(input: StartRunInput!): RuntimeRun }",
    "input StartRunInput { prompt: String! }",
    "type RuntimeRun { id: ID! status: String! }",
    "query RuntimeFixture($id: ID!) { runtimeRun(id: $id) { id status } }",
  ].join("\n"));
  writeText(restClientPath, [
    "### @name RuntimeList",
    "GET https://api.example.test/runtime/runs?token=secret-token HTTP/1.1",
    "Authorization: Bearer {{$dotenv RUNTIME_TOKEN}}",
    "X-Trace-Id: {{traceId}}",
    "",
    "### @name RuntimeCreate",
    "POST {{baseUrl}}/runtime/runs HTTP/1.1",
    "Content-Type: application/json",
    "Cookie: session={{sessionCookie}}",
    "",
    "{ \"prompt\": \"runtime fixture\" }",
  ].join("\n"));
  writeText(restClientRestPath, [
    "@tenant = runtime",
    "",
    "### @name RuntimeDelete",
    "DELETE https://api.example.test/{{$tenant}}/runs/42?token=secret-rest-token HTTP/1.1",
    "X-Request-Id: {{$guid}}",
    "",
    "### @name RuntimeStatus",
    "GET {{baseUrl}}/status HTTP/1.1",
    "Accept: application/json",
  ].join("\n"));
  writeText(protoPath, [
    'syntax = "proto3";',
    "package runtime.fixture;",
    'import "google/protobuf/timestamp.proto";',
    "message RuntimeRequest { string prompt = 1; }",
    "message RuntimeReply { string id = 1; string status = 2; }",
    "service RuntimeFixtureService {",
    "  rpc StartRuntime(RuntimeRequest) returns (RuntimeReply);",
    "}",
  ].join("\n"));
  writeText(dockerfilePath, [
    "FROM node:22-alpine AS base",
    "WORKDIR /app",
    "COPY package.json package-lock.json ./",
    "RUN npm ci",
    "COPY . .",
    "CMD [\"npm\", \"run\", \"dev\"]",
  ].join("\n"));
  writeText(sarifPath, JSON.stringify({
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "Runtime Analyzer", rules: [{ id: "runtime-secret" }] } },
        results: [
          {
            ruleId: "runtime-secret",
            level: "warning",
            message: { text: "Token-like value detected in fixture" },
            locations: [
              { physicalLocation: { artifactLocation: { uri: "src/runtime.ts" }, region: { startLine: 12 } } },
            ],
          },
        ],
      },
    ],
  }, null, 2));
  writeText(securityAuditPath, JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      minimist: {
        name: "minimist",
        severity: "high",
        via: [
          {
            source: "GHSA-xvch-5gv4-984h",
            name: "minimist",
            title: "Prototype Pollution in minimist",
            url: "https://registry.example.test/advisories/GHSA-xvch-5gv4-984h?token=secret-audit-token",
            severity: "high",
            cwe: ["CWE-1321"],
          },
        ],
        range: "<1.2.6",
      },
      lodash: {
        name: "lodash",
        severity: "moderate",
        via: [
          {
            source: "CVE-2021-23337",
            title: "Command Injection in lodash templates",
            severity: "moderate",
            cwe: ["CWE-77"],
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 1,
        high: 1,
        critical: 0,
      },
    },
  }, null, 2));
  writeText(cyclonedxPath, JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "runtime-fixture-app", version: "1.0.0" } },
    components: [
      { name: "runtime-lib", version: "2.0.0", licenses: [{ license: { id: "MIT" } }] },
    ],
    dependencies: [{ ref: "runtime-fixture-app", dependsOn: ["runtime-lib"] }],
  }, null, 2));
  writeText(spdxPath, [
    "SPDXVersion: SPDX-2.3",
    "DataLicense: CC0-1.0",
    "SPDXID: SPDXRef-DOCUMENT",
    "PackageName: runtime-fixture-app",
    "PackageVersion: 1.0.0",
    "PackageChecksum: SHA256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "Relationship: SPDXRef-DOCUMENT DESCRIBES SPDXRef-Package-runtime-fixture",
  ].join("\n"));
  writeText(syftPath, JSON.stringify({
    schema: { version: "16.0.0", url: "https://raw.githubusercontent.com/anchore/syft/main/schema/json/schema-16.0.0.json" },
    source: { type: "directory", target: "runtime-fixture" },
    artifacts: [
      {
        id: "pkg:npm/runtime-lib@1.2.3",
        name: "runtime-lib",
        version: "1.2.3",
        type: "npm-package",
        licenses: [{ value: "MIT" }],
        purl: "pkg:npm/runtime-lib@1.2.3",
      },
      {
        id: "pkg:pypi/runtime-helper@0.4.0",
        name: "runtime-helper",
        version: "0.4.0",
        type: "python-package",
        purl: "pkg:pypi/runtime-helper@0.4.0",
      },
    ],
    artifactRelationships: [
      { parent: "pkg:npm/runtime-app@9.9.9", child: "pkg:npm/runtime-lib@1.2.3", type: "dependency-of" },
    ],
    files: [
      { path: "package-lock.json", digests: [{ algorithm: "sha256", value: "1234567890abcdef" }] },
    ],
  }, null, 2));
  writeText(pemPath, [
    "-----BEGIN CERTIFICATE-----",
    "MIIBszCCAVmgAwIBAgIUQ29kZXhSdW50aW1lRml4dHVyZTAKBggqhkjOPQQDAjAc",
    "MRowGAYDVQQDDBFSdW50aW1lIEZpeHR1cmUwHhcNMjYwNzA5MDAwMDAwWhcNMjcw",
    "NzA5MDAwMDAwWjAcMRowGAYDVQQDDBFSdW50aW1lIEZpeHR1cmUwWTATBgcqhkjO",
    "PQIBBggqhkjOPQMBBwNCAATqCj3v+ZK7px9a7pLbhQbPx8NdbN2jZD0m5h9+qP0s",
    "nckmKzZQ8Q1kxLkVYdR8DqfLIGUv1x4nq6PJn6l7rHnfo1MwUTAdBgNVHQ4EFgQU",
    "XJf9R4p1i8vD3aK7C6w8Y4nS8nAwHwYDVR0jBBgwFoAUXJf9R4p1i8vD3aK7C6w8",
    "Y4nS8nAwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEA8Xq8Vx3E",
    "7qzEn3vU1QWmQnM6Y7w84VjY1Cw+55Pj5iICIQC4zYl6p8D1Lw4r3qN2c1kY3t9Y",
    "KxQ4xg9M2QK5aVq8LQ==",
    "-----END CERTIFICATE-----",
  ].join("\n"));
  writeText(checksumPath, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  runtime.exe\n");
  writeWasmFixture(wasmPath);
  writePeFixture(exePath);
  writeJavaArchiveFixture(jarPath);
  writeJavaClassFixture(classPath);
  writeText(geojsonPath, JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Runtime Operations Site" },
        geometry: { type: "Point", coordinates: [116.4074, 39.9042] },
      },
    ],
  }, null, 2));
  writeText(terraformPath, [
    'resource "azurerm_resource_group" "runtime" {',
    '  name = "runtime-fixture-rg"',
    '  location = "eastus"',
    "}",
    "",
    'module "diagnostics" {',
    '  source = "./modules/diagnostics"',
    "}",
  ].join("\n"));
  writeText(terraformPlanPath, JSON.stringify({
    format_version: "1.2",
    terraform_version: "1.9.8",
    resource_changes: [
      {
        address: "module.diagnostics.azurerm_monitor_diagnostic_setting.runtime",
        module_address: "module.diagnostics",
        mode: "managed",
        type: "azurerm_monitor_diagnostic_setting",
        name: "runtime",
        provider_name: "registry.terraform.io/hashicorp/azurerm",
        change: {
          actions: ["create"],
          after: { name: "runtime-fixture", access_token: "secret-terraform-plan-token" },
        },
      },
      {
        address: "azurerm_resource_group.runtime",
        mode: "managed",
        type: "azurerm_resource_group",
        name: "runtime",
        provider_name: "registry.terraform.io/hashicorp/azurerm",
        change: {
          actions: ["update"],
          before: { tags: { old: "true" } },
          after: { tags: { token: "secret-terraform-plan-token" } },
        },
      },
    ],
    output_changes: {
      runtime_endpoint: {
        actions: ["create"],
        after: "https://example.test/runtime?token=secret-terraform-plan-token",
      },
    },
    planned_values: {
      root_module: {
        resources: [
          {
            address: "azurerm_resource_group.runtime",
            mode: "managed",
            type: "azurerm_resource_group",
            name: "runtime",
          },
        ],
        child_modules: [
          {
            address: "module.diagnostics",
            resources: [
              {
                address: "module.diagnostics.azurerm_monitor_diagnostic_setting.runtime",
                mode: "managed",
                type: "azurerm_monitor_diagnostic_setting",
                name: "runtime",
              },
            ],
          },
        ],
      },
    },
  }, null, 2));
  writeText(cloudFormationPath, [
    "AWSTemplateFormatVersion: '2010-09-09'",
    "Transform: AWS::Serverless-2016-10-31",
    "Description: Runtime CloudFormation fixture",
    "Parameters:",
    "  RuntimeStage:",
    "    Type: String",
    "Resources:",
    "  RuntimeFunction:",
    "    Type: AWS::Serverless::Function",
    "    Properties:",
    "      Handler: index.handler",
    "      Runtime: nodejs20.x",
    "Outputs:",
    "  RuntimeFunctionArn:",
    "    Value: !GetAtt RuntimeFunction.Arn",
  ].join("\n"));
  writeText(armTemplatePath, JSON.stringify({
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      runtimeLocation: { type: "string", defaultValue: "secret-location-should-not-expand" },
    },
    variables: {
      runtimeName: "runtime-fixture-storage",
    },
    resources: [
      {
        type: "Microsoft.Storage/storageAccounts",
        apiVersion: "2023-01-01",
        name: "[variables('runtimeName')]",
        location: "[parameters('runtimeLocation')]",
      },
    ],
    outputs: {
      runtimeEndpoint: { type: "string", value: "[reference(variables('runtimeName')).primaryEndpoints.blob]" },
    },
  }, null, 2));
  writeText(bicepPath, [
    "targetScope = 'resourceGroup'",
    "param runtimeLocation string",
    "var runtimeName = 'runtime-fixture-storage'",
    "resource runtimeStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {",
    "  name: runtimeName",
    "  location: runtimeLocation",
    "}",
    "output runtimeStorageId string = runtimeStorage.id",
  ].join("\n"));
  writeText(ansiblePath, [
    "- name: Runtime fixture deployment",
    "  hosts: runtime",
    "  tasks:",
    "    - name: Ensure runtime service",
    "      ansible.builtin.service:",
    "        name: runtime-fixture",
    "        state: started",
  ].join("\n"));
  writeText(dxfPath, [
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "LINE",
    "8",
    "RuntimeLayer",
    "10",
    "0.0",
    "20",
    "0.0",
    "11",
    "1.0",
    "21",
    "1.0",
    "0",
    "ENDSEC",
    "0",
    "EOF",
  ].join("\n"));
  writeText(mermaidPath, [
    "flowchart TD",
    "  Runtime[Runtime ops fixture] --> Review[Visible review]",
    "  Review --> Attach[Attach to chat]",
  ].join("\n"));
  writeText(graphvizPath, [
    "digraph RuntimeFixture {",
    "  subgraph cluster_review {",
    "    Runtime -> Review;",
    "    Review -> Attach;",
    "  }",
    "}",
  ].join("\n"));
  writeText(scssPath, [
    "$runtime-gap: 8px;",
    ":root { --runtime-accent: #0b6bcb; }",
    ".runtime-panel {",
    "  background-image: url('./runtime-panel.png');",
    "  padding: $runtime-gap;",
    "}",
    "@media (min-width: 720px) { .runtime-panel { display: grid; } }",
  ].join("\n"));
  writeOutlookMsgFixture(msgPath);
  writeWindowsShortcutFixture(lnkPath);
  writeText(regPath, [
    "Windows Registry Editor Version 5.00",
    "",
    "[HKEY_CURRENT_USER\\Software\\OpenDrSai\\RuntimeFixture]",
    '"DisplayName"="Runtime Registry Fixture"',
    '"ApiToken"="secret-registry-token"',
    '"RemoveMe"=-',
    "",
    "[-HKEY_CURRENT_USER\\Software\\OpenDrSai\\RuntimeFixture\\Deprecated]",
  ].join("\n"));
  writeText(wprpPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<WindowsPerformanceRecorder Version="1.0">',
    "  <Profiles>",
    '    <SystemCollector Id="RuntimeSystemCollector" Name="Runtime System Collector">',
    '      <BufferSize Value="1024" />',
    '      <Buffers Value="64" />',
    "    </SystemCollector>",
    '    <EventCollector Id="RuntimeEventCollector" Name="Runtime Event Collector">',
    '      <EventProviders><EventProvider Id="RuntimeProvider" Name="Microsoft-Windows-RuntimeFixture"><Keyword Value="0x10" /><Stack Value="true" /></EventProvider></EventProviders>',
    "    </EventCollector>",
    '    <Profile Id="RuntimeFixture.Verbose.File" Name="Runtime Fixture Verbose" Description="Runtime fixture profile" Base="GeneralProfile" />',
    "  </Profiles>",
    "</WindowsPerformanceRecorder>",
  ].join("\n"));
  writeText(etwManifestPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<instrumentationManifest schemaVersion="1.0" xmlns="http://schemas.microsoft.com/win/2004/08/events">',
    "  <instrumentation>",
    "    <events>",
    '      <provider name="OpenDrSai-RuntimeTelemetry" guid="{12345678-1234-1234-1234-1234567890ab}" symbol="OpenDrSaiRuntimeTelemetry" resourceFileName="runtime.dll" messageFileName="runtime.dll">',
    '        <channels><channel name="OpenDrSai/Runtime" chid="RuntimeChannel" type="Operational" enabled="true" /></channels>',
    '        <tasks><task name="RuntimeFixtureTask" value="1" symbol="RuntimeFixtureTask" /></tasks>',
    '        <opcodes><opcode name="RuntimeStart" value="10" symbol="RuntimeStart" /></opcodes>',
    '        <keywords><keyword name="RuntimeKeyword" mask="0x1" symbol="RuntimeKeyword" /></keywords>',
    '        <templates><template tid="RuntimeTemplate"><data name="operation" inType="win:UnicodeString" /></template></templates>',
    '        <events><event symbol="RuntimeFixtureEvent" value="100" version="0" level="win:Informational" task="RuntimeFixtureTask" opcode="RuntimeStart" keywords="RuntimeKeyword" template="RuntimeTemplate" channel="RuntimeChannel" /></events>',
    "      </provider>",
    "    </events>",
    "  </instrumentation>",
    "</instrumentationManifest>",
  ].join("\n"));
  writeFileSync(blgPath, Buffer.concat([
    Buffer.from("BLG Runtime performance log header\n", "utf8"),
    Buffer.from("\\Processor(_Total)\\% Processor Time\n\\Memory\\Available MBytes\n", "utf8"),
    Buffer.from("System Monitor RuntimeFixture Perf", "utf16le"),
  ]));
  writeMinidumpFixture(dmpPath);
  writeDocxFixture(docxPath);
  writeXlsxFixture(xlsxPath);
  writeXlsxFixture(xlsmPath, true);
  writePptxFixture(pptxPath);
  writeOpenDocumentFixture(odtPath);
  writeLegacyOfficeFixture(docPath, "Runtime legacy DOC body");
  writeLegacyOfficeFixture(xlsPath, "Runtime legacy XLS workbook");
  writeSqliteFixture(sqlitePath);
  writeText(sqlPath, [
    "CREATE TABLE runtime_orgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
    "CREATE TABLE runtime_users (id INTEGER PRIMARY KEY, org_id INTEGER REFERENCES runtime_orgs(id), email TEXT UNIQUE, CHECK(length(email) > 3));",
    "CREATE INDEX idx_runtime_users_org ON runtime_users(org_id);",
    "SELECT id, email FROM runtime_users;",
  ].join("\n"));
  writeText(csvPath, [
    "user_id,event_name,status,api_token",
    "1,runtime-open,active,secret-csv-token",
    "2,runtime-close,inactive,public-row",
    "3,runtime-review,active,public-row-2",
  ].join("\n"));
  writeText(tsvPath, [
    "run_id\towner\tresult\tcreated_at",
    "run-1\talice\tpassed\t2026-07-10",
    "run-2\tbob\tfailed\t2026-07-10",
    "run-3\tcarol\tpassed\t2026-07-10",
  ].join("\n"));
  writeText(jsonlPath, [
    JSON.stringify({ user_id: 1, event_name: "runtime-open", api_token: "secret-jsonl-token" }),
    JSON.stringify({ user_id: 2, event_name: "runtime-close", success: true }),
  ].join("\n"));
  writeText(harPath, JSON.stringify({
    log: {
      entries: [
        {
          request: {
            method: "GET",
            url: "https://api.example.test/runs?token=secret-har-token",
            headers: [{ name: "Authorization", value: "Bearer secret-har-token" }],
          },
          response: {
            status: 200,
            content: { mimeType: "application/json" },
            headers: [{ name: "Content-Type", value: "application/json" }],
          },
          time: 42,
        },
      ],
    },
  }, null, 2));
  writeText(devtoolsTracePath, JSON.stringify({
    traceEvents: [
      { ph: "M", pid: 100, tid: 1, name: "process_name", args: { name: "Renderer" } },
      { ph: "M", pid: 100, tid: 7, name: "thread_name", args: { name: "CrRendererMain" } },
      { ph: "X", pid: 100, tid: 7, ts: 1000, dur: 125000, cat: "devtools.timeline,toplevel", name: "RunTask", args: { data: { url: "https://example.test?token=secret-trace-token" }, frame: "runtime-frame" } },
      { ph: "X", pid: 100, tid: 7, ts: 130000, dur: 52000, cat: "devtools.timeline", name: "Layout", args: { beginData: { dirtyObjects: 12 } } },
      { ph: "I", pid: 100, tid: 7, ts: 185000, cat: "blink.user_timing", name: "RuntimeMark", args: { marker: "runtime-ready" } },
    ],
    metadata: { source: "runtime fixture" },
  }, null, 2));
  writeText(lighthousePath, JSON.stringify({
    lighthouseVersion: "12.8.0",
    requestedUrl: "https://example.test/app?token=secret-lighthouse-token",
    finalDisplayedUrl: "https://example.test/app?token=secret-lighthouse-token",
    fetchTime: "2026-07-10T04:00:00.000Z",
    configSettings: { formFactor: "desktop" },
    environment: { networkUserAgent: "Mozilla/5.0 RuntimeFixture Chrome/124" },
    categories: {
      performance: { title: "Performance", score: 0.72 },
      accessibility: { title: "Accessibility", score: 0.95 },
      seo: { title: "SEO", score: 0.83 },
    },
    audits: {
      "largest-contentful-paint": {
        title: "Largest Contentful Paint",
        score: 0.45,
        numericValue: 3_420,
        displayValue: "3.4 s",
      },
      "total-blocking-time": {
        title: "Total Blocking Time",
        score: 0.68,
        numericValue: 210,
        displayValue: "210 ms",
      },
      "uses-http2": {
        title: "Uses HTTP/2",
        score: 1,
        scoreDisplayMode: "binary",
        displayValue: "HTTP/2 supported",
      },
    },
  }, null, 2));
  writePcapFixture(pcapPath);
  writePcapNgFixture(pcapngPath);
  writeText(notebookPath, JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["# Runtime notebook\n", "Fixture notes"] },
      {
        cell_type: "code",
        source: ["print('runtime notebook')"],
        outputs: [
          { output_type: "stream", name: "stdout", text: ["runtime notebook\n"] },
          { output_type: "display_data", data: { "text/plain": "runtime table", "image/png": "..." } },
        ],
      },
    ],
  }, null, 2));
  writeParquetFixture(parquetPath);
  writeArrowFixture(arrowPath);
  writeFeatherFixture(featherPath);
  writeOfficeZipFixture(epubPath, [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ["OEBPS/content.opf", '<package><metadata><dc:title>Runtime EPUB Fixture</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest></package>'],
    ["OEBPS/chapter1.xhtml", "<html><body><h1>Runtime EPUB chapter</h1><p>Bounded ebook body text.</p><script>secret()</script></body></html>"],
  ]);
  writeTtfFixture(ttfPath);
  writeWoffFixture(woffPath);
  writeWoff2Fixture(woff2Path);
  writeText(bookmarksPath, [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<TITLE>Runtime Bookmarks</TITLE>",
    "<H1>Runtime Bookmarks</H1>",
    "<DL><p>",
    "<DT><H3 ADD_DATE=\"1783598400\">Runtime Folder</H3>",
    "<DL><p><DT><A HREF=\"https://docs.example.test/runtime?token=secret-bookmark-token\" ADD_DATE=\"1783598400\">Runtime Docs</A></DL><p>",
    "</DL><p>",
  ].join("\n"));
  writeText(urlShortcutPath, [
    "[InternetShortcut]",
    "URL=https://links.example.test/runtime?token=secret-url-token",
    "IDList=",
    "HotKey=0",
    "IconFile=https://links.example.test/favicon.ico",
  ].join("\n"));
  writeText(weblocPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "<key>URL</key>",
    "<string>https://links.example.test/webloc?token=secret-webloc-token</string>",
    "</dict></plist>",
  ].join("\n"));
  writeText(rssPath, [
    '<?xml version="1.0"?>',
    '<rss version="2.0"><channel>',
    "<title>Runtime RSS Feed</title>",
    "<link>https://feeds.example.test/runtime</link>",
    "<lastBuildDate>Fri, 10 Jul 2026 09:00:00 GMT</lastBuildDate>",
    "<item><title>Runtime RSS Item</title><link>https://feeds.example.test/runtime/1</link><pubDate>Fri, 10 Jul 2026 09:00:00 GMT</pubDate></item>",
    "</channel></rss>",
  ].join("\n"));
  writeText(atomPath, [
    '<?xml version="1.0"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "<title>Runtime Atom Feed</title>",
    '<link href="https://feeds.example.test/atom" />',
    "<updated>2026-07-10T09:00:00Z</updated>",
    "<author><name>Runtime Author</name></author>",
    "<entry><title>Runtime Atom Entry</title><link href=\"https://feeds.example.test/atom/1\" /><updated>2026-07-10T09:00:00Z</updated></entry>",
    "</feed>",
  ].join("\n"));
  writeText(robotsPath, [
    "User-agent: *",
    "Disallow: /private",
    "Allow: /public",
    "Crawl-delay: 5",
    "Sitemap: https://example.test/sitemap.xml?token=secret-robots-token",
  ].join("\n"));
  const sitemapXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    "    <loc>https://example.test/public</loc>",
    "    <lastmod>2026-07-10</lastmod>",
    "    <changefreq>daily</changefreq>",
    "    <priority>0.8</priority>",
    "  </url>",
    "  <url>",
    "    <loc>https://example.test/private?token=secret-sitemap-token</loc>",
    "    <lastmod>2026-07-09</lastmod>",
    "  </url>",
    "</urlset>",
  ].join("\n");
  writeText(sitemapPath, sitemapXml);
  writeFileSync(sitemapGzipPath, gzipSync(Buffer.from(sitemapXml, "utf8")));
  writeText(srtPath, [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Runtime SRT caption.",
  ].join("\n"));
  writeText(vttPath, [
    "WEBVTT",
    "",
    "00:00:04.000 --> 00:00:06.000",
    "<v Speaker>Runtime VTT caption.</v>",
  ].join("\n"));
  writeText(androidManifestPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.opendrsai.runtime" android:versionName="1.2.3" android:versionCode="42">',
    '  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35" />',
    '  <uses-permission android:name="android.permission.INTERNET" />',
    '  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '  <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '  <application android:label="@string/app_name" android:theme="@style/AppTheme" android:allowBackup="false" android:networkSecurityConfig="@xml/network_security_config">',
    '    <activity android:name=".MainActivity" android:exported="true">',
    '      <intent-filter>',
    '        <action android:name="android.intent.action.MAIN" />',
    '        <category android:name="android.intent.category.LAUNCHER" />',
    '      </intent-filter>',
    '    </activity>',
    '    <service android:name=".SyncService" android:exported="false" />',
    '    <meta-data android:name="com.example.API_TOKEN" android:value="secret-android-token" />',
    "  </application>",
    "</manifest>",
  ].join("\n"));
  writeText(infoPlistPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>CFBundleIdentifier</key><string>org.opendrsai.runtime.ios</string>",
    "  <key>CFBundleName</key><string>RuntimeFixture</string>",
    "  <key>CFBundleDisplayName</key><string>Runtime Fixture</string>",
    "  <key>CFBundleShortVersionString</key><string>2.3.4</string>",
    "  <key>CFBundleVersion</key><string>234</string>",
    "  <key>MinimumOSVersion</key><string>17.0</string>",
    "  <key>DTPlatformName</key><string>iphoneos</string>",
    "  <key>LSRequiresIPhoneOS</key><true/>",
    "  <key>CFBundleURLTypes</key>",
    "  <array>",
    "    <dict><key>CFBundleURLSchemes</key><array><string>drsai-runtime</string><string>secret-info-plist-token</string></array></dict>",
    "  </array>",
    "  <key>UIRequiredDeviceCapabilities</key><array><string>arm64</string><string>camera</string></array>",
    "  <key>UIBackgroundModes</key><array><string>fetch</string><string>remote-notification</string></array>",
    "  <key>NSCameraUsageDescription</key><string>secret-camera-token should not appear</string>",
    "  <key>NSMicrophoneUsageDescription</key><string>secret-microphone-token should not appear</string>",
    "</dict>",
    "</plist>",
  ].join("\n"));
  writeMobileAppPackageFixture(apkPath, "apk");
  writeMobileAppPackageFixture(aabPath, "aab");
  writeMobileAppPackageFixture(ipaPath, "ipa");
  writeFlacFixture(flacPath);
  writeM4aFixture(m4aPath);
  writeOggFixture(oggPath);

  const adapters = await loadChannelAdapters(tempRoot);
  assert(typeof adapters.importChannelContext === "function", "compiled adapter module does not export importChannelContext");

  const result = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      packagePath,
      coveragePath,
      stylePath,
      metricsPath,
      hdf5Path,
      composePath,
      cmakePath,
      compileCommandsPath,
      gradlePropertiesPath,
      mavenConfigPath,
      goModPath,
      requirementsPath,
    ],
    limit: 16,
  });

  const metricsRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      metricsPath,
      metricsExtensionPath,
      openMetricsPath,
    ],
    limit: 6,
  });

  assert(
    result.items.length === 12,
    `expected 12 imported runtime fixture items, got ${result.items.length}: ${result.items.map((item) => item.title).join(", ")}`,
  );
  assert(result.truncated === false, "runtime fixture import should not be truncated");
  assert(
    result.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "runtime fixture import lost read-only verification copy",
  );

  const scientificVariantResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      netcdfPath,
      matPath,
    ],
    limit: 4,
  });

  assert(
    scientificVariantResult.items.length === 2,
    `expected 2 imported scientific variant runtime fixture items, got ${scientificVariantResult.items.length}: ${scientificVariantResult.items.map((item) => item.title).join(", ")}`,
  );
  assert(scientificVariantResult.truncated === false, "scientific variant runtime fixture import should not be truncated");
  assert(
    scientificVariantResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "scientific variant runtime fixture import lost read-only verification copy",
  );

  const msbuildSolutionResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      solutionPath,
      csprojPath,
    ],
    limit: 4,
  });

  assert(
    msbuildSolutionResult.items.length === 2,
    `expected 2 imported MSBuild/Solution fixture items, got ${msbuildSolutionResult.items.length}: ${msbuildSolutionResult.items.map((item) => item.title).join(", ")}`,
  );
  assert(msbuildSolutionResult.truncated === false, "runtime MSBuild/Solution fixture import should not be truncated");

  const lockfileResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      packageLockPath,
      pnpmLockPath,
      yarnLockPath,
      cargoLockPath,
      goSumPath,
    ],
    limit: 8,
  });

  assert(lockfileResult.items.length === 5, `expected 5 imported dependency lockfile runtime fixture items, got ${lockfileResult.items.length}`);
  assert(lockfileResult.truncated === false, "dependency lockfile runtime fixture import should not be truncated");
  assert(
    lockfileResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "dependency lockfile runtime fixture import lost read-only verification copy",
  );

  const dotnetNugetResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      dotnetGlobalPath,
      nugetConfigPath,
      packagesConfigPath,
      nuspecPath,
    ],
    limit: 8,
  });

  assert(dotnetNugetResult.items.length === 4, `expected 4 imported .NET/NuGet runtime fixture items, got ${dotnetNugetResult.items.length}`);
  assert(dotnetNugetResult.truncated === false, ".NET/NuGet runtime fixture import should not be truncated");
  assert(
    dotnetNugetResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    ".NET/NuGet runtime fixture import lost read-only verification copy",
  );

  const scriptRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      powershellPath,
      batchPath,
    ],
    limit: 4,
  });

  assert(scriptRuntimeResult.items.length === 2, `expected 2 imported script runtime fixture items, got ${scriptRuntimeResult.items.length}`);
  assert(scriptRuntimeResult.truncated === false, "script runtime fixture import should not be truncated");
  assert(
    scriptRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "script runtime fixture import lost read-only verification copy",
  );

  const repositoryGovernanceResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      codeownersPath,
      editorconfigPath,
      gitattributesPath,
      gitignorePath,
      licensePath,
      noticePath,
    ],
    limit: 8,
  });

  assert(repositoryGovernanceResult.items.length === 6, `expected 6 imported repository governance runtime fixture items, got ${repositoryGovernanceResult.items.length}`);
  assert(repositoryGovernanceResult.truncated === false, "repository governance runtime fixture import should not be truncated");
  assert(
    repositoryGovernanceResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "repository governance runtime fixture import lost read-only verification copy",
  );

  const configRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      dotenvPath,
    ],
    limit: 2,
  });

  assert(configRuntimeResult.items.length === 1, `expected 1 imported .env config runtime fixture item, got ${configRuntimeResult.items.length}`);
  assert(configRuntimeResult.truncated === false, ".env config runtime fixture import should not be truncated");
  assert(
    configRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    ".env config runtime fixture import lost read-only verification copy",
  );

  const ciWorkflowResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      githubActionsPath,
      gitlabCiPath,
      azurePipelinesPath,
    ],
    limit: 6,
  });

  assert(ciWorkflowResult.items.length === 3, `expected 3 imported CI/CD workflow runtime fixture items, got ${ciWorkflowResult.items.length}`);
  assert(ciWorkflowResult.truncated === false, "CI/CD workflow runtime fixture import should not be truncated");
  assert(
    ciWorkflowResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "CI/CD workflow runtime fixture import lost read-only verification copy",
  );

  const testReportResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      junitPath,
      trxPath,
      tapPath,
      playwrightJsonPath,
      checkstylePath,
    ],
    limit: 5,
  });

  assert(testReportResult.items.length === 5, `expected 5 imported runtime test/static report fixture items, got ${testReportResult.items.length}`);
  assert(testReportResult.truncated === false, "runtime test report fixture import should not be truncated");
  assert(
    testReportResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "runtime test report fixture import lost read-only verification copy",
  );

  const coverageReportResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      coveragePath,
      lcovPath,
      cloverPath,
    ],
    limit: 4,
  });

  assert(coverageReportResult.items.length === 3, `expected 3 imported coverage runtime fixture items, got ${coverageReportResult.items.length}`);
  assert(coverageReportResult.truncated === false, "coverage runtime fixture import should not be truncated");
  assert(
    coverageReportResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "coverage runtime fixture import lost read-only verification copy",
  );

  const documentArchiveResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      pdfPath,
      zipPath,
      stlPath,
    ],
    limit: 8,
  });

  assert(documentArchiveResult.items.length === 3, `expected 3 imported document/archive runtime fixture items, got ${documentArchiveResult.items.length}`);
  assert(documentArchiveResult.truncated === false, "document/archive runtime fixture import should not be truncated");
  assert(
    documentArchiveResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "document/archive runtime fixture import lost read-only verification copy",
  );

  const threeDModelResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      objPath,
      gltfPath,
      glbPath,
    ],
    limit: 8,
  });

  assert(threeDModelResult.items.length === 3, `expected 3 imported 3D model runtime fixture items, got ${threeDModelResult.items.length}`);
  assert(threeDModelResult.truncated === false, "3D model runtime fixture import should not be truncated");
  assert(
    threeDModelResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "3D model runtime fixture import lost read-only verification copy",
  );

  const packageManifestResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      cargoPath,
      pubspecPath,
      pubspecLockPath,
      packageSwiftPath,
      composerPath,
      gemfilePath,
      gemspecPath,
      npmrcPath,
      mixPath,
      stackPath,
      cabalPath,
    ],
    limit: 16,
  });

  assert(packageManifestResult.items.length === 11, `expected 11 imported package/config runtime fixture items, got ${packageManifestResult.items.length}`);
  assert(packageManifestResult.truncated === false, "package/config runtime fixture import should not be truncated");
  assert(
    packageManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "package/config runtime fixture import lost read-only verification copy",
  );

  const packageConfigVariantResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      yarnrcPath,
      jvmConfigPath,
      pubspecLockPath,
    ],
    limit: 8,
  });

  assert(packageConfigVariantResult.items.length === 3, `expected 3 imported package/config variant runtime fixture items, got ${packageConfigVariantResult.items.length}`);
  assert(packageConfigVariantResult.truncated === false, "package/config variant runtime fixture import should not be truncated");
  assert(
    packageConfigVariantResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "package/config variant runtime fixture import lost read-only verification copy",
  );

  const pythonManifestResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      pyprojectPath,
      pipfilePath,
      pythonEnvironmentPath,
      uvLockPath,
    ],
    limit: 8,
  });

  assert(pythonManifestResult.items.length === 4, `expected 4 imported Python dependency runtime fixture items, got ${pythonManifestResult.items.length}`);
  assert(pythonManifestResult.truncated === false, "Python dependency runtime fixture import should not be truncated");
  assert(
    pythonManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Python dependency runtime fixture import lost read-only verification copy",
  );

  const personalInfoResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      emlPath,
      mboxPath,
      vcardPath,
      icsPath,
      icalPath,
    ],
    limit: 8,
  });

  assert(personalInfoResult.items.length === 5, `expected 5 imported personal-info runtime fixture items, got ${personalInfoResult.items.length}`);
  assert(personalInfoResult.truncated === false, "personal-info runtime fixture import should not be truncated");
  assert(
    personalInfoResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "personal-info runtime fixture import lost read-only verification copy",
  );

  const windowsDiagnosticsResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      evtxPath,
      etlPath,
      etwManifestPath,
      blgPath,
      werPath,
      msiPath,
      appxManifestPath,
      taskPath,
      infPath,
      catPath,
    ],
    limit: 12,
  });

  assert(windowsDiagnosticsResult.items.length === 10, `expected 10 imported Windows diagnostics runtime fixture items, got ${windowsDiagnosticsResult.items.length}`);
  assert(windowsDiagnosticsResult.truncated === false, "Windows diagnostics runtime fixture import should not be truncated");
  assert(
    windowsDiagnosticsResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Windows diagnostics runtime fixture import lost read-only verification copy",
  );

  const apiSchemaContainerResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      openApiPath,
      insomniaPath,
      postmanEnvironmentPath,
      brunoPath,
      graphqlPath,
      restClientPath,
      restClientRestPath,
      protoPath,
      dockerfilePath,
      composePath,
      chartPath,
      kustomizationPath,
    ],
    limit: 12,
  });

  assert(apiSchemaContainerResult.items.length === 12, `expected 12 imported API/schema/container runtime fixture items, got ${apiSchemaContainerResult.items.length}`);
  assert(apiSchemaContainerResult.truncated === false, "API/schema/container runtime fixture import should not be truncated");
  assert(
    apiSchemaContainerResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "API/schema/container runtime fixture import lost read-only verification copy",
  );

  const securityArtifactResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      sarifPath,
      securityAuditPath,
      cyclonedxPath,
      spdxPath,
      syftPath,
      pemPath,
      checksumPath,
      wasmPath,
      exePath,
      jarPath,
      classPath,
    ],
    limit: 12,
  });

  assert(securityArtifactResult.items.length === 11, `expected 11 imported security/SBOM/binary runtime fixture items, got ${securityArtifactResult.items.length}`);
  assert(securityArtifactResult.truncated === false, "security/SBOM/binary runtime fixture import should not be truncated");
  assert(
    securityArtifactResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "security/SBOM/binary runtime fixture import lost read-only verification copy",
  );

  const opsDesignResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      geojsonPath,
      terraformPath,
      terraformPlanPath,
      cloudFormationPath,
      armTemplatePath,
      bicepPath,
      ansiblePath,
      dxfPath,
      mermaidPath,
      graphvizPath,
      scssPath,
    ],
    limit: 12,
  });

  assert(opsDesignResult.items.length === 11, `expected 11 imported ops/design runtime fixture items, got ${opsDesignResult.items.length}`);
  assert(opsDesignResult.truncated === false, "ops/design runtime fixture import should not be truncated");
  assert(
    opsDesignResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "ops/design runtime fixture import lost read-only verification copy",
  );

  const windowsNativeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      msgPath,
      lnkPath,
      regPath,
      wprpPath,
      dmpPath,
    ],
    limit: 8,
  });

  assert(windowsNativeResult.items.length === 5, `expected 5 imported Windows-native runtime fixture items, got ${windowsNativeResult.items.length}`);
  assert(windowsNativeResult.truncated === false, "Windows-native runtime fixture import should not be truncated");
  assert(
    windowsNativeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Windows-native runtime fixture import lost read-only verification copy",
  );

  const officeWorkbookResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      docxPath,
      xlsxPath,
      xlsmPath,
      pptxPath,
      odtPath,
      docPath,
      xlsPath,
    ],
    limit: 12,
  });

  assert(officeWorkbookResult.items.length === 7, `expected 7 imported Office/workbook runtime fixture items, got ${officeWorkbookResult.items.length}`);
  assert(officeWorkbookResult.truncated === false, "Office/workbook runtime fixture import should not be truncated");
  assert(
    officeWorkbookResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Office/workbook runtime fixture import lost read-only verification copy",
  );

  const dataNetworkResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      sqlitePath,
      sqlPath,
      jsonlPath,
      harPath,
      devtoolsTracePath,
      lighthousePath,
      pcapPath,
      pcapngPath,
      notebookPath,
      parquetPath,
      arrowPath,
      featherPath,
    ],
    limit: 12,
  });

  assert(dataNetworkResult.items.length === 12, `expected 12 imported data/network runtime fixture items, got ${dataNetworkResult.items.length}`);
  assert(dataNetworkResult.truncated === false, "data/network runtime fixture import should not be truncated");
  assert(
    dataNetworkResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "data/network runtime fixture import lost read-only verification copy",
  );

  const delimitedDataResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      csvPath,
      tsvPath,
    ],
    limit: 2,
  });

  assert(delimitedDataResult.items.length === 2, `expected 2 imported delimited data runtime fixture items, got ${delimitedDataResult.items.length}`);
  assert(delimitedDataResult.truncated === false, "delimited data runtime fixture import should not be truncated");
  assert(
    delimitedDataResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "delimited data runtime fixture import lost read-only verification copy",
  );

  const contentMediaResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      epubPath,
      ttfPath,
      bookmarksPath,
      urlShortcutPath,
      weblocPath,
      rssPath,
      atomPath,
      robotsPath,
      sitemapPath,
      sitemapGzipPath,
      srtPath,
      vttPath,
    ],
    limit: 12,
  });

  assert(contentMediaResult.items.length === 12, `expected 12 imported content/media runtime fixture items, got ${contentMediaResult.items.length}`);
  assert(contentMediaResult.truncated === false, "content/media runtime fixture import should not be truncated");
  assert(
    contentMediaResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "content/media runtime fixture import lost read-only verification copy",
  );

  const fontContainerVariantResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      woffPath,
      woff2Path,
    ],
    limit: 4,
  });

  assert(fontContainerVariantResult.items.length === 2, `expected 2 imported font container runtime fixture items, got ${fontContainerVariantResult.items.length}`);
  assert(fontContainerVariantResult.truncated === false, "font container runtime fixture import should not be truncated");
  assert(
    fontContainerVariantResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "font container runtime fixture import lost read-only verification copy",
  );

  const mobileManifestResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      androidManifestPath,
      infoPlistPath,
    ],
    limit: 4,
  });

  assert(mobileManifestResult.items.length === 2, `expected 2 imported mobile manifest runtime fixture items, got ${mobileManifestResult.items.length}`);
  assert(mobileManifestResult.truncated === false, "mobile manifest runtime fixture import should not be truncated");
  assert(
    mobileManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "mobile manifest runtime fixture import lost read-only verification copy",
  );

  const mobilePackageResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      apkPath,
      aabPath,
      ipaPath,
    ],
    limit: 6,
  });

  assert(mobilePackageResult.items.length === 3, `expected 3 imported mobile app package runtime fixture items, got ${mobilePackageResult.items.length}`);
  assert(mobilePackageResult.truncated === false, "mobile app package runtime fixture import should not be truncated");
  assert(
    mobilePackageResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "mobile app package runtime fixture import lost read-only verification copy",
  );

  const audioResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      flacPath,
      m4aPath,
      oggPath,
    ],
    limit: 8,
  });

  assert(audioResult.items.length === 3, `expected 3 imported audio runtime fixture items, got ${audioResult.items.length}`);
  assert(audioResult.truncated === false, "audio runtime fixture import should not be truncated");
  assert(
    audioResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "audio runtime fixture import lost read-only verification copy",
  );

  const packageSummary = summaryFor(result, "package.json");
  assert(packageSummary.includes("Node package manifest preview"), "package.json did not use the Node package manifest preview");
  assert(packageSummary.includes("runtime-fixture-app"), "package.json summary omitted package name");
  assert(packageSummary.includes("pnpm@9.12.0"), "package.json summary omitted packageManager evidence");
  assert(packageSummary.includes("devDependencies"), "package.json summary omitted dev dependency map evidence");
  assert(packageSummary.includes("exports: ."), "package.json summary omitted export entrypoint evidence");
  assert(packageSummary.includes("no npm, pnpm, Yarn, Bun, node"), "package.json summary omitted no-package-manager safety copy");

  const yarnrcSummary = summaryFor(packageConfigVariantResult, ".yarnrc.yml");
  assert(yarnrcSummary.includes("Node package-manager config preview"), ".yarnrc.yml did not use Node package-manager config preview");
  assert(yarnrcSummary.includes("Yarn Berry config"), ".yarnrc.yml summary omitted Yarn Berry format evidence");
  assert(yarnrcSummary.includes("nodeLinker"), ".yarnrc.yml summary omitted package-manager setting evidence");
  assert(yarnrcSummary.includes("[redacted]") && !yarnrcSummary.includes("secret-yarn-token"), ".yarnrc.yml summary omitted token redaction evidence");
  assert(yarnrcSummary.includes("no npm, pnpm, Yarn, Bun, node command"), ".yarnrc.yml summary omitted no-package-manager safety copy");

  const coverageSummary = summaryFor(result, "coverage.xml");
  assert(coverageSummary.includes("Coverage report preview"), "coverage.xml did not use coverage report preview");
  assert(coverageSummary.includes("Line coverage"), "coverage.xml summary omitted coverage rates");
  assert(coverageSummary.includes("no test runner, coverage tool"), "coverage.xml summary omitted no-runner safety copy");

  const lcovSummary = summaryFor(coverageReportResult, "lcov.info");
  assert(lcovSummary.includes("Coverage report preview (LCOV"), "lcov.info did not use LCOV coverage report preview");
  assert(lcovSummary.includes("50% (2/4)") && lcovSummary.includes("50% (1/2)"), "lcov.info summary omitted LCOV line/branch coverage counts");
  assert(lcovSummary.includes("src/chatbar/runtime.ts") && lcovSummary.includes("src/chatbar/[redacted].ts"), "lcov.info summary omitted file evidence or secret redaction");
  assert(!lcovSummary.includes("secret-token"), "lcov.info summary leaked secret-like path segment");
  assert(lcovSummary.includes("no test runner, coverage tool"), "lcov.info summary omitted no-runner safety copy");
  const cloverSummary = summaryFor(coverageReportResult, "clover.xml");
  assert(cloverSummary.includes("Coverage report preview (Clover XML"), "clover.xml did not use Clover coverage report preview");
  assert(cloverSummary.includes("70% (7/10)") && cloverSummary.includes("75% (3/4)"), "clover.xml summary omitted Clover statement/conditional coverage counts");
  assert(cloverSummary.includes("chatbar.runtime"), "clover.xml summary omitted package evidence");
  assert(cloverSummary.includes("src/chatbar/runtime.ts") && cloverSummary.includes("src/chatbar/[redacted].ts"), "clover.xml summary omitted file evidence or secret redaction");
  assert(!cloverSummary.includes("secret-token"), "clover.xml summary leaked secret-like path segment");
  assert(cloverSummary.includes("no test runner, coverage tool"), "clover.xml summary omitted no-runner safety copy");

  const junitSummary = summaryFor(testReportResult, "runtime.junit.xml");
  assert(junitSummary.includes("Test report preview (JUnit XML"), "runtime.junit.xml did not use JUnit test report preview");
  assert(junitSummary.includes("Cases: 3; failures: 1; errors: 0; skipped: 1"), "runtime.junit.xml summary omitted case/failure counts");
  assert(junitSummary.includes("RuntimeFixtureSuite"), "runtime.junit.xml summary omitted suite evidence");
  assert(junitSummary.includes("RuntimeFixture.fails [failure]"), `runtime.junit.xml summary omitted failure preview evidence: ${junitSummary}`);
  assert(junitSummary.includes("no test runner, build command"), "runtime.junit.xml summary omitted no-runner safety copy");

  const trxSummary = summaryFor(testReportResult, "runtime.trx");
  assert(trxSummary.includes("Test report preview (Visual Studio TRX"), "runtime.trx did not use TRX test report preview");
  assert(trxSummary.includes("Cases: 3; passed: 2; non-passing: 1"), "runtime.trx summary omitted TRX outcome counts");
  assert(trxSummary.includes("ResultSummary outcome: Failed"), "runtime.trx summary omitted result summary evidence");
  assert(trxSummary.includes("RuntimeTrxFail [Failed]"), "runtime.trx summary omitted failing test evidence");
  assert(trxSummary.includes("no test runner, build command"), "runtime.trx summary omitted no-runner safety copy");

  const tapSummary = summaryFor(testReportResult, "runtime.tap");
  assert(tapSummary.includes("Test report preview (TAP"), "runtime.tap did not use TAP test report preview");
  assert(tapSummary.includes("Cases: 4; passed: 2; non-passing: 2"), "runtime.tap summary omitted TAP outcome counts");
  assert(tapSummary.includes("Directives: TODO: 1, SKIP: 1"), "runtime.tap summary omitted directive evidence");
  assert(tapSummary.includes("Runtime TAP failure [not ok TODO]"), "runtime.tap summary omitted failing TAP assertion evidence");
  assert(!tapSummary.includes("secret-tap-token"), "runtime.tap summary leaked TAP diagnostic secret");
  assert(tapSummary.includes("no test runner, build command"), "runtime.tap summary omitted no-runner safety copy");

  const playwrightJsonSummary = summaryFor(testReportResult, "runtime.playwright.json");
  assert(playwrightJsonSummary.includes("Test report preview (Playwright JSON"), "runtime.playwright.json did not use Playwright JSON test report preview");
  assert(playwrightJsonSummary.includes("Cases: 3; passed: 2; non-passing: 1; skipped: 1"), "runtime.playwright.json summary omitted JSON outcome counts");
  assert(playwrightJsonSummary.includes("Runtime Playwright Suite"), "runtime.playwright.json summary omitted suite evidence");
  assert(playwrightJsonSummary.includes("handles failed stream [failed]"), "runtime.playwright.json summary omitted failing JSON test evidence");
  assert(!playwrightJsonSummary.includes("secret-json-token"), "runtime.playwright.json summary leaked JSON diagnostic secret");
  assert(playwrightJsonSummary.includes("no test runner, build command"), "runtime.playwright.json summary omitted no-runner safety copy");

  const checkstyleSummary = summaryFor(testReportResult, "runtime.checkstyle.xml");
  assert(checkstyleSummary.includes("Static analysis XML report preview (Checkstyle XML"), "runtime.checkstyle.xml did not use static analysis XML preview");
  assert(checkstyleSummary.includes("src/main/RuntimeFixture.java"), "runtime.checkstyle.xml summary omitted file evidence");
  assert(checkstyleSummary.includes("MagicNumberCheck") && checkstyleSummary.includes("ImportOrderCheck"), "runtime.checkstyle.xml summary omitted rule evidence");
  assert(checkstyleSummary.includes("warning") && checkstyleSummary.includes("error"), "runtime.checkstyle.xml summary omitted severity evidence");
  assert(!checkstyleSummary.includes("secret-checkstyle-token"), "runtime.checkstyle.xml summary leaked diagnostic secret");
  assert(checkstyleSummary.includes("no Checkstyle/PMD/SpotBugs scanner"), "runtime.checkstyle.xml summary omitted no-scanner safety copy");

  const styleSummary = summaryFor(result, "style.css");
  assert(styleSummary.includes("Stylesheet preview"), "style.css did not use stylesheet preview");
  assert(styleSummary.includes("--accent"), "style.css summary omitted custom property evidence");
  assert(styleSummary.includes("no Sass/Less/PostCSS compiler"), "style.css summary omitted no-compiler safety copy");

  const metricsSummary = summaryFor(result, "runtime.prom");
  assert(metricsSummary.includes("Metrics snapshot preview"), "runtime.prom did not use metrics snapshot preview");
  assert(metricsSummary.includes("runtime_requests_total"), "runtime.prom summary omitted metric name evidence");
  assert(metricsSummary.includes("runtime_latency_seconds:histogram"), "runtime.prom summary omitted metric type evidence");
  assert(metricsSummary.includes("job") && metricsSummary.includes("route"), "runtime.prom summary omitted label-key evidence");
  assert(!metricsSummary.includes("secret-metrics-token"), "runtime.prom summary leaked metric label secret");
  assert(metricsSummary.includes("no Prometheus/OpenMetrics server query"), "runtime.prom summary omitted no-server safety copy");

  const metricsExtensionSummary = summaryFor(metricsRuntimeResult, "runtime.metrics");
  assert(metricsExtensionSummary.includes("Metrics snapshot preview (OpenMetrics/Prometheus text"), "runtime.metrics did not use metrics snapshot preview");
  assert(metricsExtensionSummary.includes("runtime_worker_jobs") && metricsExtensionSummary.includes("runtime_worker_seconds"), "runtime.metrics summary omitted metric name evidence");
  assert(metricsExtensionSummary.includes("runtime_worker_jobs:gauge") && metricsExtensionSummary.includes("runtime_worker_seconds:summary"), "runtime.metrics summary omitted metric type evidence");
  assert(metricsExtensionSummary.includes("queue") && metricsExtensionSummary.includes("scheduled"), "runtime.metrics summary omitted label-key evidence");
  assert(!metricsExtensionSummary.includes("secret-metrics-extension-token"), "runtime.metrics summary leaked metric label secret");
  assert(metricsExtensionSummary.includes("no Prometheus/OpenMetrics server query"), "runtime.metrics summary omitted no-server safety copy");

  const openMetricsSummary = summaryFor(metricsRuntimeResult, "runtime.openmetrics");
  assert(openMetricsSummary.includes("Metrics snapshot preview (OpenMetrics/Prometheus text"), "runtime.openmetrics did not use OpenMetrics preview");
  assert(openMetricsSummary.includes("runtime_queue_depth") && openMetricsSummary.includes("runtime_dispatch_duration_seconds"), "runtime.openmetrics summary omitted metric name evidence");
  assert(openMetricsSummary.includes("runtime_queue_depth:gauge") && openMetricsSummary.includes("runtime_dispatch_duration_seconds:summary"), "runtime.openmetrics summary omitted metric type evidence");
  assert(openMetricsSummary.includes("queue") && openMetricsSummary.includes("agent"), "runtime.openmetrics summary omitted label-key evidence");
  assert(!openMetricsSummary.includes("secret-openmetrics-token"), "runtime.openmetrics summary leaked metric label secret");
  assert(openMetricsSummary.includes("no Prometheus/OpenMetrics server query"), "runtime.openmetrics summary omitted no-server safety copy");

  const powershellSummary = summaryFor(scriptRuntimeResult, "runtime.ps1");
  assert(powershellSummary.includes("PowerShell script preview"), "runtime.ps1 did not use PowerShell script preview");
  assert(powershellSummary.includes("Invoke-RuntimeFixture"), "runtime.ps1 summary omitted function evidence");
  assert(powershellSummary.includes("Path") && powershellSummary.includes("ApiToken"), "runtime.ps1 summary omitted parameter evidence");
  assert(powershellSummary.includes("Pester") && powershellSummary.includes("Microsoft.PowerShell.Management"), "runtime.ps1 summary omitted module evidence");
  assert(powershellSummary.includes("network download/request") && powershellSummary.includes("process/job launch"), "runtime.ps1 summary omitted risk cue evidence");
  assert(!powershellSummary.includes("secret-powershell-token"), "runtime.ps1 summary leaked secret-shaped value");
  assert(powershellSummary.includes("no PowerShell/pwsh process, script execution"), "runtime.ps1 summary omitted no-PowerShell runtime safety copy");

  const batchSummary = summaryFor(scriptRuntimeResult, "runtime.cmd");
  assert(batchSummary.includes("Windows batch script preview"), "runtime.cmd did not use Windows batch script preview");
  assert(batchSummary.includes("review") && batchSummary.includes("done"), "runtime.cmd summary omitted label evidence");
  assert(batchSummary.includes("API_TOKEN") && batchSummary.includes("WORKSPACE"), "runtime.cmd summary omitted environment variable evidence");
  assert(batchSummary.includes("tools\\prepare-runtime.cmd"), "runtime.cmd summary omitted CALL target evidence");
  assert(batchSummary.includes("network download/request") && batchSummary.includes("filesystem mutation") && batchSummary.includes("system configuration"), "runtime.cmd summary omitted risk cue evidence");
  assert(!batchSummary.includes("secret-batch-token"), "runtime.cmd summary leaked secret-shaped value");
  assert(batchSummary.includes("no cmd.exe process, batch script execution"), "runtime.cmd summary omitted no-cmd runtime safety copy");

  const codeownersSummary = summaryFor(repositoryGovernanceResult, "CODEOWNERS");
  assert(codeownersSummary.includes("Repository governance file preview"), "CODEOWNERS did not use repository governance preview");
  assert(codeownersSummary.includes("CODEOWNERS ownership rules"), "CODEOWNERS summary omitted governance format evidence");
  assert(codeownersSummary.includes("/apps/desktop/windows/ -> @opendrsai/windows, @opendrsai/release"), "CODEOWNERS summary omitted ownership rule evidence");
  assert(codeownersSummary.includes("no git command, CODEOWNERS resolver"), "CODEOWNERS summary omitted no-git/no-resolver safety copy");

  const editorconfigSummary = summaryFor(repositoryGovernanceResult, ".editorconfig");
  assert(editorconfigSummary.includes("EditorConfig style policy"), ".editorconfig summary omitted EditorConfig format evidence");
  assert(editorconfigSummary.includes("EditorConfig sections") && editorconfigSummary.includes("*.md"), ".editorconfig summary omitted section evidence");
  assert(editorconfigSummary.includes("indent_style") && editorconfigSummary.includes("indent_size"), ".editorconfig summary omitted property evidence");
  assert(editorconfigSummary.includes("no git command"), ".editorconfig summary omitted no-git safety copy");

  const gitattributesSummary = summaryFor(repositoryGovernanceResult, ".gitattributes");
  assert(gitattributesSummary.includes("Git attributes policy"), ".gitattributes summary omitted Git attributes format evidence");
  assert(gitattributesSummary.includes("*.ps1 text eol=crlf") && gitattributesSummary.includes("*.png binary"), ".gitattributes summary omitted attribute rule evidence");
  assert(gitattributesSummary.includes("policy engine"), ".gitattributes summary omitted no-policy-engine safety copy");

  const gitignoreSummary = summaryFor(repositoryGovernanceResult, ".gitignore");
  assert(gitignoreSummary.includes("Git ignore patterns"), ".gitignore summary omitted Git ignore format evidence");
  assert(gitignoreSummary.includes("node_modules/") && gitignoreSummary.includes("release/"), ".gitignore summary omitted ignore pattern evidence");
  assert(gitignoreSummary.includes("filesystem mutation"), ".gitignore summary omitted no-mutation safety copy");

  const licenseSummary = summaryFor(repositoryGovernanceResult, "LICENSE");
  assert(licenseSummary.includes("license text"), "LICENSE summary omitted license format evidence");
  assert(licenseSummary.includes("License cues: MIT"), "LICENSE summary omitted MIT cue evidence");
  assert(licenseSummary.includes("license compliance scanner"), "LICENSE summary omitted no-license-scanner safety copy");

  const noticeSummary = summaryFor(repositoryGovernanceResult, "NOTICE");
  assert(noticeSummary.includes("notice text"), "NOTICE summary omitted notice format evidence");
  assert(noticeSummary.includes("Notice/copyright lines"), "NOTICE summary omitted notice/copyright evidence");
  assert(noticeSummary.includes("provider send"), "NOTICE summary omitted no-provider safety copy");

  const dotenvSummary = summaryFor(configRuntimeResult, ".env.runtime");
  assert(dotenvSummary.includes("Configuration file preview"), ".env.runtime did not use configuration preview");
  assert(dotenvSummary.includes("RUNTIME_MODE") && dotenvSummary.includes("API_TOKEN") && dotenvSummary.includes("PUBLIC_URL"), ".env.runtime summary omitted key evidence");
  assert(dotenvSummary.includes(".env file exposes"), ".env.runtime summary omitted .env schema hint evidence");
  assert(dotenvSummary.includes("duplicate keys detected: DUPLICATE_KEY"), ".env.runtime summary omitted duplicate key evidence");
  assert(!dotenvSummary.includes("secret-env-token"), ".env.runtime summary leaked sensitive token value");
  assert(!dotenvSummary.includes("secret-env-query"), ".env.runtime summary leaked token-like URL value");
  assert(dotenvSummary.includes("no command execution, environment loading, secret lookup, network call, or provider send"), ".env.runtime summary omitted no-environment-loading safety copy");

  const hdf5Summary = summaryFor(result, "sample.h5");
  assert(hdf5Summary.includes("Scientific data container preview"), "sample.h5 did not use scientific container preview");
  assert(hdf5Summary.includes("HDF5 signature: detected"), "sample.h5 summary omitted HDF5 signature evidence");
  assert(hdf5Summary.includes("no HDF5/NetCDF/MATLAB runtime"), "sample.h5 summary omitted no-runtime safety copy");

  const netcdfSummary = summaryFor(scientificVariantResult, "runtime.nc");
  assert(netcdfSummary.includes("Scientific data container preview"), "runtime.nc did not use scientific container preview");
  assert(netcdfSummary.includes("NetCDF scientific data container"), "runtime.nc summary omitted NetCDF format label");
  assert(netcdfSummary.includes("NetCDF signature: CDF classic"), "runtime.nc summary omitted NetCDF signature evidence");
  assert(netcdfSummary.includes("runtime_temperature"), "runtime.nc summary omitted readable header evidence");
  assert(netcdfSummary.includes("no HDF5/NetCDF/MATLAB runtime"), "runtime.nc summary omitted no-runtime safety copy");

  const matSummary = summaryFor(scientificVariantResult, "runtime.mat");
  assert(matSummary.includes("Scientific data container preview"), "runtime.mat did not use scientific container preview");
  assert(matSummary.includes("MATLAB MAT scientific data container"), "runtime.mat summary omitted MATLAB MAT format label");
  assert(matSummary.includes("MATLAB MAT signature: MAT-file header detected"), "runtime.mat summary omitted MAT signature evidence");
  assert(matSummary.includes("runtime_matrix"), "runtime.mat summary omitted readable header evidence");
  assert(matSummary.includes("no HDF5/NetCDF/MATLAB runtime"), "runtime.mat summary omitted no-runtime safety copy");

  const composeSummary = summaryFor(result, "docker-compose.yaml");
  assert(composeSummary.includes("Docker Compose file preview"), "docker-compose.yaml did not use Docker Compose preview");
  assert(composeSummary.includes("api"), "docker-compose.yaml summary omitted service evidence");
  assert(composeSummary.includes("no docker compose command"), "docker-compose.yaml summary omitted no-compose safety copy");

  const cmakeSummary = summaryFor(result, "CMakeLists.txt");
  assert(cmakeSummary.includes("C/C++ build manifest preview"), "CMakeLists.txt did not use C/C++ build manifest preview");
  assert(cmakeSummary.includes("RuntimeFixture"), "CMakeLists.txt summary omitted project evidence");
  assert(cmakeSummary.includes("no cmake/make/ninja/compiler command"), "CMakeLists.txt summary omitted no-toolchain safety copy");

  const compileCommandsSummary = summaryFor(result, "compile_commands.json");
  assert(compileCommandsSummary.includes("C/C++ build manifest preview"), "compile_commands.json did not use C/C++ build manifest preview");
  assert(compileCommandsSummary.includes("src/main.cpp"), "compile_commands.json summary omitted compile command file evidence");
  assert(compileCommandsSummary.includes("no cmake/make/ninja/compiler command"), "compile_commands.json summary omitted no-toolchain safety copy");

  const gradleSummary = summaryFor(result, "gradle.properties");
  assert(gradleSummary.includes("JVM build config preview"), "gradle.properties did not use JVM build config preview");
  assert(gradleSummary.includes("org.gradle.jvmargs"), "gradle.properties summary omitted Gradle property evidence");
  assert(gradleSummary.includes("no Gradle/Maven/JVM command"), "gradle.properties summary omitted no-JVM-tool safety copy");

  const solutionSummary = summaryFor(msbuildSolutionResult, "RuntimeFixture.sln");
  assert(solutionSummary.includes("Visual Studio solution manifest preview"), "RuntimeFixture.sln did not use solution manifest preview");
  assert(solutionSummary.includes("RuntimeFixture -> RuntimeFixture.csproj"), "RuntimeFixture.sln summary omitted project evidence");
  assert(solutionSummary.includes("SolutionConfigurationPlatforms"), "RuntimeFixture.sln summary omitted global section evidence");
  assert(solutionSummary.includes("no Visual Studio/MSBuild/dotnet command"), "RuntimeFixture.sln summary omitted no-IDE/build safety copy");

  const csprojSummary = summaryFor(msbuildSolutionResult, "RuntimeFixture.csproj");
  assert(csprojSummary.includes("MSBuild CSPROJ build manifest preview"), "RuntimeFixture.csproj did not use MSBuild project preview");
  assert(csprojSummary.includes("Microsoft.NET.Sdk"), "RuntimeFixture.csproj summary omitted SDK evidence");
  assert(csprojSummary.includes("net8.0-windows"), "RuntimeFixture.csproj summary omitted target framework evidence");
  assert(csprojSummary.includes("Microsoft.Extensions.Hosting"), "RuntimeFixture.csproj summary omitted package reference evidence");
  assert(csprojSummary.includes("RuntimeShared.csproj"), "RuntimeFixture.csproj summary omitted project reference evidence");
  assert(csprojSummary.includes("no MSBuild/dotnet command"), "RuntimeFixture.csproj summary omitted no-MSBuild safety copy");

  const mavenSummary = summaryFor(result, "maven.config");
  assert(mavenSummary.includes("JVM build config preview"), ".mvn/maven.config did not use JVM build config preview");
  assert(mavenSummary.includes("--batch-mode"), ".mvn/maven.config summary omitted Maven option evidence");
  assert(mavenSummary.includes("no Gradle/Maven/JVM command"), ".mvn/maven.config summary omitted no-JVM-tool safety copy");

  const jvmConfigSummary = summaryFor(packageConfigVariantResult, "jvm.config");
  assert(jvmConfigSummary.includes("JVM build config preview"), ".mvn/jvm.config did not use JVM build config preview");
  assert(jvmConfigSummary.includes("Maven JVM config"), ".mvn/jvm.config summary omitted Maven JVM format evidence");
  assert(jvmConfigSummary.includes("-Xmx2g") && jvmConfigSummary.includes("-XX:+UseG1GC"), ".mvn/jvm.config summary omitted JVM option evidence");
  assert(jvmConfigSummary.includes("[redacted]") && !jvmConfigSummary.includes("secret-jvm-token"), ".mvn/jvm.config summary omitted token redaction evidence");
  assert(jvmConfigSummary.includes("no Gradle/Maven/JVM command"), ".mvn/jvm.config summary omitted no-JVM-tool safety copy");

  const dotnetGlobalSummary = summaryFor(dotnetNugetResult, "global.json");
  assert(dotnetGlobalSummary.includes(".NET SDK global.json preview"), "global.json did not use .NET SDK preview");
  assert(dotnetGlobalSummary.includes("8.0.303") && dotnetGlobalSummary.includes("latestFeature"), "global.json summary omitted SDK version/roll-forward evidence");
  assert(dotnetGlobalSummary.includes("Microsoft.Build.NoTargets"), "global.json summary omitted MSBuild SDK pin evidence");
  assert(dotnetGlobalSummary.includes("no dotnet command"), "global.json summary omitted no-dotnet safety copy");

  const nugetConfigSummary = summaryFor(dotnetNugetResult, "nuget.config");
  assert(nugetConfigSummary.includes("NuGet config preview"), "nuget.config did not use NuGet config preview");
  assert(nugetConfigSummary.includes("runtime-feed"), "nuget.config summary omitted package source evidence");
  assert(nugetConfigSummary.includes("Credential sections present"), "nuget.config summary omitted credential-section evidence");
  assert(!nugetConfigSummary.includes("secret-nuget-token") && !nugetConfigSummary.includes("secret-nuget-password"), "nuget.config summary leaked source token/password");
  assert(nugetConfigSummary.includes("no dotnet/NuGet command"), "nuget.config summary omitted no-NuGet safety copy");

  const packagesConfigSummary = summaryFor(dotnetNugetResult, "packages.config");
  assert(packagesConfigSummary.includes("NuGet packages.config preview"), "packages.config did not use packages.config preview");
  assert(packagesConfigSummary.includes("Newtonsoft.Json") && packagesConfigSummary.includes("Serilog"), "packages.config summary omitted package evidence");
  assert(packagesConfigSummary.includes("no NuGet restore"), "packages.config summary omitted no-restore safety copy");

  const nuspecSummary = summaryFor(dotnetNugetResult, "RuntimeFixture.nuspec");
  assert(nuspecSummary.includes("NuGet package specification preview"), "RuntimeFixture.nuspec did not use NuGet package specification preview");
  assert(nuspecSummary.includes("OpenDrSai.RuntimeFixture") && nuspecSummary.includes("Microsoft.Extensions.Logging"), "RuntimeFixture.nuspec summary omitted package/dependency evidence");
  assert(nuspecSummary.includes("no dotnet/NuGet pack"), "RuntimeFixture.nuspec summary omitted no-pack safety copy");

  const goModSummary = summaryFor(result, "go.mod");
  assert(goModSummary.includes("Go module manifest preview"), "go.mod did not use Go module manifest preview");
  assert(goModSummary.includes("example.com/runtime-fixture"), "go.mod summary omitted module evidence");
  assert(goModSummary.includes("no go command"), "go.mod summary omitted no-go-tool safety copy");

  const requirementsSummary = summaryFor(result, "requirements-dev.txt");
  assert(requirementsSummary.includes("Python dependency manifest preview"), "requirements-dev.txt did not use Python dependency manifest preview");
  assert(requirementsSummary.includes("pytest"), "requirements-dev.txt summary omitted package evidence");
  assert(requirementsSummary.includes("no Python interpreter"), "requirements-dev.txt summary omitted no-Python safety copy");

  const packageLockSummary = summaryFor(lockfileResult, "package-lock.json");
  assert(packageLockSummary.includes("Dependency lockfile preview"), "package-lock.json did not use dependency lockfile preview");
  assert(packageLockSummary.includes("Ecosystem: npm"), "package-lock.json summary omitted npm ecosystem evidence");
  assert(packageLockSummary.includes("react") && packageLockSummary.includes("@opendrsai/runtime-helper"), "package-lock.json summary omitted package evidence");
  assert(packageLockSummary.includes("(root) -> react") && packageLockSummary.includes("react -> scheduler"), "package-lock.json summary omitted local edge evidence");
  assert(packageLockSummary.includes("without package manager execution"), "package-lock.json summary omitted no-package-manager safety copy");

  const pnpmLockSummary = summaryFor(lockfileResult, "pnpm-lock.yaml");
  assert(pnpmLockSummary.includes("Dependency lockfile preview"), "pnpm-lock.yaml did not use dependency lockfile preview");
  assert(pnpmLockSummary.includes("Ecosystem: pnpm"), "pnpm-lock.yaml summary omitted pnpm ecosystem evidence");
  assert(pnpmLockSummary.includes("react") && pnpmLockSummary.includes("scheduler"), "pnpm-lock.yaml summary omitted package/edge evidence");
  assert(pnpmLockSummary.includes("without package manager execution"), "pnpm-lock.yaml summary omitted no-package-manager safety copy");

  const yarnLockSummary = summaryFor(lockfileResult, "yarn.lock");
  assert(yarnLockSummary.includes("Dependency lockfile preview"), "yarn.lock did not use dependency lockfile preview");
  assert(yarnLockSummary.includes("Ecosystem: Yarn"), "yarn.lock summary omitted Yarn ecosystem evidence");
  assert(yarnLockSummary.includes("react") && yarnLockSummary.includes("scheduler"), "yarn.lock summary omitted package/edge evidence");
  assert(yarnLockSummary.includes("registry lookup"), "yarn.lock summary omitted no-registry safety copy");

  const cargoLockSummary = summaryFor(lockfileResult, "Cargo.lock");
  assert(cargoLockSummary.includes("Dependency lockfile preview"), "Cargo.lock did not use dependency lockfile preview");
  assert(cargoLockSummary.includes("Ecosystem: Cargo"), "Cargo.lock summary omitted Cargo ecosystem evidence");
  assert(cargoLockSummary.includes("runtime-crate") && cargoLockSummary.includes("serde"), "Cargo.lock summary omitted package evidence");
  assert(cargoLockSummary.includes("runtime-crate -> serde"), "Cargo.lock summary omitted local Cargo edge evidence");
  assert(cargoLockSummary.includes("vulnerability audit"), "Cargo.lock summary omitted no-audit safety copy");

  const goSumSummary = summaryFor(lockfileResult, "go.sum");
  assert(goSumSummary.includes("Dependency lockfile preview"), "go.sum did not use dependency lockfile preview");
  assert(goSumSummary.includes("Ecosystem: Go module checksum"), "go.sum summary omitted Go checksum ecosystem evidence");
  assert(goSumSummary.includes("github.com/stretchr/testify") && goSumSummary.includes("golang.org/x/sys"), "go.sum summary omitted checksum package evidence");
  assert(goSumSummary.includes("(module) -> github.com/stretchr/testify"), "go.sum summary omitted Go checksum edge evidence");
  assert(goSumSummary.includes("network call"), "go.sum summary omitted no-network safety copy");

  const githubActionsSummary = summaryFor(ciWorkflowResult, "runtime.yml");
  assert(githubActionsSummary.includes("CI/CD workflow preview (GitHub Actions)"), "runtime.yml did not use GitHub Actions workflow preview");
  assert(githubActionsSummary.includes("push") && githubActionsSummary.includes("pull_request"), "runtime.yml summary omitted trigger evidence");
  assert(githubActionsSummary.includes("build"), "runtime.yml summary omitted job evidence");
  assert(githubActionsSummary.includes("ubuntu-latest"), "runtime.yml summary omitted runner evidence");
  assert(!githubActionsSummary.includes("secret-ci-token"), "runtime.yml summary leaked CI token-like value");
  assert(githubActionsSummary.includes("no CI runner"), "runtime.yml summary omitted no-runner safety copy");

  const gitlabCiSummary = summaryFor(ciWorkflowResult, ".gitlab-ci.yml");
  assert(gitlabCiSummary.includes("CI/CD workflow preview (GitLab CI)"), ".gitlab-ci.yml did not use GitLab CI workflow preview");
  assert(gitlabCiSummary.includes("test"), ".gitlab-ci.yml summary omitted stage evidence");
  assert(gitlabCiSummary.includes("runtime-test"), ".gitlab-ci.yml summary omitted job evidence");
  assert(gitlabCiSummary.includes("node:22"), ".gitlab-ci.yml summary omitted image evidence");
  assert(!gitlabCiSummary.includes("secret-ci-token"), ".gitlab-ci.yml summary leaked CI token-like value");
  assert(gitlabCiSummary.includes("no CI runner"), ".gitlab-ci.yml summary omitted no-runner safety copy");

  const azurePipelinesSummary = summaryFor(ciWorkflowResult, "azure-pipelines.yml");
  assert(azurePipelinesSummary.includes("CI/CD workflow preview (Azure Pipelines)"), "azure-pipelines.yml did not use Azure Pipelines workflow preview");
  assert(azurePipelinesSummary.includes("main"), "azure-pipelines.yml summary omitted trigger evidence");
  assert(azurePipelinesSummary.includes("runtime_windows"), "azure-pipelines.yml summary omitted job evidence");
  assert(azurePipelinesSummary.includes("windows-latest"), "azure-pipelines.yml summary omitted runner evidence");
  assert(!azurePipelinesSummary.includes("secret-ci-token"), "azure-pipelines.yml summary leaked CI token-like value");
  assert(azurePipelinesSummary.includes("no CI runner"), "azure-pipelines.yml summary omitted no-runner safety copy");

  const pdfSummary = summaryFor(documentArchiveResult, "fixture.pdf");
  assert(pdfSummary.includes("PDF metadata preview"), "fixture.pdf did not use PDF preview");
  assert(pdfSummary.includes("Runtime Fixture PDF"), "fixture.pdf summary omitted PDF metadata evidence");
  assert(pdfSummary.includes("PDF text preview"), "fixture.pdf summary omitted PDF text preview");
  assert(pdfSummary.includes("no PDF renderer, OCR, JavaScript execution"), "fixture.pdf summary omitted no-renderer safety copy");

  const zipSummary = summaryFor(documentArchiveResult, "fixture.zip");
  assert(zipSummary.includes("ZIP archive metadata preview"), "fixture.zip did not use ZIP archive preview");
  assert(zipSummary.includes("reports/summary.txt"), "fixture.zip summary omitted ZIP entry evidence");
  assert(zipSummary.includes("Nested archive metadata cues"), "fixture.zip summary omitted nested archive cue evidence");
  assert(zipSummary.includes("no archive extraction"), "fixture.zip summary omitted no-extraction safety copy");

  const stlSummary = summaryFor(documentArchiveResult, "fixture.stl");
  assert(stlSummary.includes("3D model metadata preview"), "fixture.stl did not use 3D model preview");
  assert(stlSummary.includes("Format: STL ASCII"), "fixture.stl summary omitted STL format evidence");
  assert(stlSummary.includes("RuntimeSolid"), "fixture.stl summary omitted STL solid evidence");
  assert(stlSummary.includes("no model renderer"), "fixture.stl summary omitted no-renderer safety copy");

  const objSummary = summaryFor(threeDModelResult, "runtime.obj");
  assert(objSummary.includes("3D model metadata preview"), "runtime.obj did not use 3D model preview");
  assert(objSummary.includes("Format: Wavefront OBJ"), "runtime.obj summary omitted OBJ format evidence");
  assert(objSummary.includes("RuntimeObjMesh"), "runtime.obj summary omitted OBJ object evidence");
  assert(objSummary.includes("RuntimeMaterial"), "runtime.obj summary omitted OBJ material evidence");
  assert(objSummary.includes("no model renderer"), "runtime.obj summary omitted no-renderer safety copy");

  const gltfSummary = summaryFor(threeDModelResult, "runtime.gltf");
  assert(gltfSummary.includes("3D model metadata preview"), "runtime.gltf did not use 3D model preview");
  assert(gltfSummary.includes("Format: glTF JSON"), "runtime.gltf summary omitted glTF JSON format evidence");
  assert(gltfSummary.includes("RuntimeGltfMesh"), "runtime.gltf summary omitted glTF mesh evidence");
  assert(gltfSummary.includes("KHR_materials_unlit"), "runtime.gltf summary omitted glTF extension evidence");
  assert(gltfSummary.includes("no model renderer"), "runtime.gltf summary omitted no-renderer safety copy");

  const glbSummary = summaryFor(threeDModelResult, "runtime.glb");
  assert(glbSummary.includes("3D model metadata preview"), "runtime.glb did not use 3D model preview");
  assert(glbSummary.includes("Format: GLB binary glTF"), "runtime.glb summary omitted GLB format evidence");
  assert(glbSummary.includes("RuntimeGlbMesh"), "runtime.glb summary omitted GLB mesh evidence");
  assert(glbSummary.includes("no model renderer"), "runtime.glb summary omitted no-renderer safety copy");

  const cargoSummary = summaryFor(packageManifestResult, "Cargo.toml");
  assert(cargoSummary.includes("Cargo manifest preview"), "Cargo.toml did not use Cargo manifest preview");
  assert(cargoSummary.includes("runtime-fixture"), "Cargo.toml summary omitted package metadata evidence");
  assert(cargoSummary.includes("no cargo, rustc, rustup"), "Cargo.toml summary omitted no-Cargo safety copy");

  const pyprojectSummary = summaryFor(pythonManifestResult, "pyproject.toml");
  assert(pyprojectSummary.includes("Python dependency manifest preview"), "pyproject.toml did not use Python dependency manifest preview");
  assert(pyprojectSummary.includes("requests"), "pyproject.toml summary omitted dependency evidence");
  assert(pyprojectSummary.includes("hatchling.build"), "pyproject.toml summary omitted build-backend evidence");
  assert(pyprojectSummary.includes("no Python interpreter"), "pyproject.toml summary omitted no-Python safety copy");

  const pipfileSummary = summaryFor(pythonManifestResult, "Pipfile");
  assert(pipfileSummary.includes("Python dependency manifest preview"), "Pipfile did not use Python dependency manifest preview");
  assert(pipfileSummary.includes("fastapi"), "Pipfile summary omitted package evidence");
  assert(pipfileSummary.includes("dev-packages"), "Pipfile summary omitted dependency-group evidence");
  assert(pipfileSummary.includes("no Python interpreter"), "Pipfile summary omitted no-Python safety copy");

  const pythonEnvironmentSummary = summaryFor(pythonManifestResult, "environment.yml");
  assert(pythonEnvironmentSummary.includes("Python dependency manifest preview"), "environment.yml did not use Python dependency manifest preview");
  assert(pythonEnvironmentSummary.includes("conda-forge"), "environment.yml summary omitted channel evidence");
  assert(pythonEnvironmentSummary.includes("python=3.11"), "environment.yml summary omitted Python version evidence");
  assert(pythonEnvironmentSummary.includes("no Python interpreter"), "environment.yml summary omitted no-Python safety copy");

  const uvLockSummary = summaryFor(pythonManifestResult, "uv.lock");
  assert(uvLockSummary.includes("Python dependency manifest preview"), "uv.lock did not use Python dependency manifest preview");
  assert(uvLockSummary.includes("runtime-py-fixture"), "uv.lock summary omitted locked package evidence");
  assert(uvLockSummary.includes("pytest"), "uv.lock summary omitted dependency evidence");
  assert(uvLockSummary.includes("no Python interpreter"), "uv.lock summary omitted no-Python safety copy");

  const pubspecSummary = summaryFor(packageManifestResult, "pubspec.yaml");
  assert(pubspecSummary.includes("Dart pubspec manifest preview"), "pubspec.yaml did not use Dart pubspec preview");
  assert(pubspecSummary.includes("runtime_fixture"), "pubspec.yaml summary omitted package metadata evidence");
  assert(pubspecSummary.includes("no dart, flutter, pub command"), "pubspec.yaml summary omitted no-Dart safety copy");

  const pubspecLockSummary = summaryFor(packageConfigVariantResult, "pubspec.lock");
  assert(pubspecLockSummary.includes("Dart pubspec manifest preview"), "pubspec.lock did not use Dart pubspec preview");
  assert(pubspecLockSummary.includes("pubspec.lock lockfile"), "pubspec.lock summary omitted lockfile format evidence");
  assert(pubspecLockSummary.includes("runtime_fixture") && pubspecLockSummary.includes("build_runner"), "pubspec.lock summary omitted locked package evidence");
  assert(pubspecLockSummary.includes("no dart, flutter, pub command"), "pubspec.lock summary omitted no-Dart safety copy");

  const swiftSummary = summaryFor(packageManifestResult, "Package.swift");
  assert(swiftSummary.includes("Apple package manifest preview"), "Package.swift did not use Apple package manifest preview");
  assert(swiftSummary.includes("RuntimeFixture"), "Package.swift summary omitted package metadata evidence");
  assert(swiftSummary.includes("no swift, xcodebuild, pod"), "Package.swift summary omitted no-Apple-toolchain safety copy");

  const composerSummary = summaryFor(packageManifestResult, "composer.json");
  assert(composerSummary.includes("PHP/Ruby package manifest preview"), "composer.json did not use PHP/Ruby manifest preview");
  assert(composerSummary.includes("example/runtime-fixture"), "composer.json summary omitted package metadata evidence");
  assert(composerSummary.includes("no php, composer, ruby"), "composer.json summary omitted no-PHP/Ruby safety copy");

  const gemfileSummary = summaryFor(packageManifestResult, "Gemfile");
  assert(gemfileSummary.includes("PHP/Ruby package manifest preview"), "Gemfile did not use PHP/Ruby manifest preview");
  assert(gemfileSummary.includes("rack"), "Gemfile summary omitted gem dependency evidence");
  assert(gemfileSummary.includes("no php, composer, ruby"), "Gemfile summary omitted no-PHP/Ruby safety copy");

  const gemspecSummary = summaryFor(packageManifestResult, "runtime_fixture.gemspec");
  assert(gemspecSummary.includes("PHP/Ruby package manifest preview"), "gemspec did not use PHP/Ruby manifest preview");
  assert(gemspecSummary.includes("runtime_fixture"), "gemspec summary omitted gem metadata evidence");
  assert(gemspecSummary.includes("no php, composer, ruby"), "gemspec summary omitted no-PHP/Ruby safety copy");

  const npmrcSummary = summaryFor(packageManifestResult, ".npmrc");
  assert(npmrcSummary.includes("Node package-manager config preview"), ".npmrc did not use Node package-manager config preview");
  assert(npmrcSummary.includes("registry"), ".npmrc summary omitted registry setting evidence");
  assert(npmrcSummary.includes("[redacted]") && !npmrcSummary.includes("secret-token"), ".npmrc summary omitted secret redaction evidence");
  assert(npmrcSummary.includes("no npm, pnpm, Yarn, Bun, node command"), ".npmrc summary omitted no-package-manager safety copy");

  const mixSummary = summaryFor(packageManifestResult, "mix.exs");
  assert(mixSummary.includes("Elixir/Haskell package manifest preview"), "mix.exs did not use Elixir/Haskell manifest preview");
  assert(mixSummary.includes("runtime_fixture"), "mix.exs summary omitted Mix app metadata evidence");
  assert(mixSummary.includes("no Elixir/Mix/Rebar/Hex/Erlang/Stack/Cabal/GHC command"), "mix.exs summary omitted no-toolchain safety copy");

  const stackSummary = summaryFor(packageManifestResult, "stack.yaml");
  assert(stackSummary.includes("Elixir/Haskell package manifest preview"), "stack.yaml did not use Elixir/Haskell manifest preview");
  assert(stackSummary.includes("lts-22.0"), "stack.yaml summary omitted resolver metadata evidence");
  assert(stackSummary.includes("no Elixir/Mix/Rebar/Hex/Erlang/Stack/Cabal/GHC command"), "stack.yaml summary omitted no-toolchain safety copy");

  const cabalSummary = summaryFor(packageManifestResult, "runtime-fixture.cabal");
  assert(cabalSummary.includes("Elixir/Haskell package manifest preview"), "cabal fixture did not use Elixir/Haskell manifest preview");
  assert(cabalSummary.includes("runtime-fixture"), "cabal fixture summary omitted package metadata evidence");
  assert(cabalSummary.includes("no Elixir/Mix/Rebar/Hex/Erlang/Stack/Cabal/GHC command"), "cabal fixture summary omitted no-toolchain safety copy");

  const emlSummary = summaryFor(personalInfoResult, "message.eml");
  assert(emlSummary.includes("Email message preview"), "message.eml did not use email message preview");
  assert(emlSummary.includes("Runtime fixture message"), "message.eml summary omitted subject evidence");
  assert(emlSummary.includes("no IMAP/SMTP login"), "message.eml summary omitted no-mailbox safety copy");

  const mboxSummary = summaryFor(personalInfoResult, "mailbox.mbox");
  assert(mboxSummary.includes("Mailbox archive preview"), "mailbox.mbox did not use mailbox archive preview");
  assert(mboxSummary.includes("Runtime mailbox fixture"), "mailbox.mbox summary omitted subject evidence");
  assert(mboxSummary.includes("no IMAP/SMTP login"), "mailbox.mbox summary omitted no-mailbox safety copy");

  const vcardSummary = summaryFor(personalInfoResult, "contact.vcf");
  assert(vcardSummary.includes("vCard contact preview"), "contact.vcf did not use vCard preview");
  assert(vcardSummary.includes("Runtime Contact"), "contact.vcf summary omitted contact name evidence");
  assert(vcardSummary.includes("no contacts app access"), "contact.vcf summary omitted no-contacts safety copy");

  const icsSummary = summaryFor(personalInfoResult, "calendar.ics");
  assert(icsSummary.includes("Calendar ICS file preview"), "calendar.ics did not use calendar ICS preview");
  assert(icsSummary.includes("Runtime Fixture Review"), "calendar.ics summary omitted event title evidence");
  assert(icsSummary.includes("no calendar app access"), "calendar.ics summary omitted no-calendar safety copy");

  const icalSummary = summaryFor(personalInfoResult, "calendar.ical");
  assert(icalSummary.includes("Calendar ICS file preview"), "calendar.ical did not use calendar ICS preview");
  assert(icalSummary.includes("Runtime ICAL Planning"), "calendar.ical summary omitted event title evidence");
  assert(icalSummary.includes("no calendar app access"), "calendar.ical summary omitted no-calendar safety copy");

  const evtxSummary = summaryFor(windowsDiagnosticsResult, "runtime.evtx");
  assert(evtxSummary.includes("Windows Event Log metadata preview"), "runtime.evtx did not use Windows Event Log preview");
  assert(evtxSummary.includes("Record range hints"), "runtime.evtx summary omitted EVTX record range evidence");
  assert(evtxSummary.includes("no Event Viewer/wevtutil process"), "runtime.evtx summary omitted no-event-log-runtime safety copy");

  const etlSummary = summaryFor(windowsDiagnosticsResult, "runtime.etl");
  assert(etlSummary.includes("Windows ETL trace metadata preview"), "runtime.etl did not use Windows ETL preview");
  assert(etlSummary.includes("Runtime ETL provider"), "runtime.etl summary omitted provider/session evidence");
  assert(etlSummary.includes("no Windows Performance Analyzer/tracerpt/logman process"), "runtime.etl summary omitted no-ETL-runtime safety copy");

  const etwManifestSummary = summaryFor(windowsDiagnosticsResult, "runtime.man");
  assert(etwManifestSummary.includes("Windows ETW provider manifest preview"), "runtime.man did not use Windows ETW provider manifest preview");
  assert(etwManifestSummary.includes("OpenDrSai-RuntimeTelemetry"), "runtime.man summary omitted provider evidence");
  assert(etwManifestSummary.includes("RuntimeFixtureEvent"), "runtime.man summary omitted event evidence");
  assert(etwManifestSummary.includes("RuntimeTemplate"), "runtime.man summary omitted template evidence");
  assert(etwManifestSummary.includes("no mc.exe/wevtutil command"), "runtime.man summary omitted no-manifest-runtime safety copy");

  const blgSummary = summaryFor(windowsDiagnosticsResult, "runtime.blg");
  assert(blgSummary.includes("Windows Performance Monitor log metadata preview"), "runtime.blg did not use Windows Performance Monitor log preview");
  assert(blgSummary.includes("\\Processor(_Total)\\% Processor Time"), "runtime.blg summary omitted counter path evidence");
  assert(blgSummary.includes("System Monitor RuntimeFixture Perf"), "runtime.blg summary omitted readable string evidence");
  assert(blgSummary.includes("no perfmon/relog/typeperf process"), "runtime.blg summary omitted no-performance-log-runtime safety copy");

  const werSummary = summaryFor(windowsDiagnosticsResult, "runtime.wer");
  assert(werSummary.includes("Windows Error Reporting preview"), "runtime.wer did not use WER preview");
  assert(werSummary.includes("RuntimeFixture.exe"), "runtime.wer summary omitted application evidence");
  assert(werSummary.includes("no Windows Error Reporting directory scan"), "runtime.wer summary omitted no-WER-system-scan safety copy");

  const msiSummary = summaryFor(windowsDiagnosticsResult, "runtime.msi");
  assert(msiSummary.includes("Windows installer package preview"), "runtime.msi did not use Windows installer preview");
  assert(msiSummary.includes("valid MSI/OLE container signature"), "runtime.msi summary omitted MSI signature evidence");
  assert(msiSummary.includes("Windows Installer was not launched"), "runtime.msi summary omitted no-installer-runtime safety copy");

  const appxManifestSummary = summaryFor(windowsDiagnosticsResult, "Package.appxmanifest");
  assert(appxManifestSummary.includes("Windows app package manifest preview"), "Package.appxmanifest did not use loose AppX/MSIX manifest preview");
  assert(appxManifestSummary.includes("OpenDrSai.RuntimeFixture"), "Package.appxmanifest summary omitted identity evidence");
  assert(appxManifestSummary.includes("no makeappx/signing/package install/register/sideload command"), "Package.appxmanifest summary omitted no-package-runtime safety copy");

  const taskSummary = summaryFor(windowsDiagnosticsResult, "RuntimeFixture.task");
  assert(taskSummary.includes("Windows scheduled task preview"), "RuntimeFixture.task did not use Windows scheduled task preview");
  assert(taskSummary.includes("\\OpenDrSai\\RuntimeFixture"), "RuntimeFixture.task summary omitted URI evidence");
  assert(taskSummary.includes("CalendarTrigger"), "RuntimeFixture.task summary omitted trigger evidence");
  assert(taskSummary.includes("Exec C:\\Runtime\\fixture.exe"), "RuntimeFixture.task summary omitted action evidence");
  assert(taskSummary.includes("UserId=S-1-5-18"), "RuntimeFixture.task summary omitted principal evidence");
  assert(taskSummary.includes("ExecutionTimeLimit=PT30M"), "RuntimeFixture.task summary omitted settings evidence");
  assert(!taskSummary.includes("secret-task-token"), "RuntimeFixture.task summary leaked action secret value");
  assert(taskSummary.includes("no schtasks.exe launch"), "RuntimeFixture.task summary omitted no-schtasks safety copy");
  assert(taskSummary.includes("no Task Scheduler COM/service access"), "RuntimeFixture.task summary omitted no-service safety copy");
  assert(taskSummary.includes("no task registration/update/delete"), "RuntimeFixture.task summary omitted no-mutation safety copy");

  const infSummary = summaryFor(windowsDiagnosticsResult, "runtime.inf");
  assert(infSummary.includes("Windows driver package INF preview"), "runtime.inf did not use Windows driver INF preview");
  assert(infSummary.includes("RuntimeProvider"), "runtime.inf summary omitted manufacturer/provider evidence");
  assert(infSummary.includes("no pnputil/devcon/DISM command"), "runtime.inf summary omitted no-driver-runtime safety copy");

  const catSummary = summaryFor(windowsDiagnosticsResult, "runtime.cat");
  assert(catSummary.includes("Windows driver catalog preview"), "runtime.cat did not use Windows driver catalog preview");
  assert(catSummary.includes("PKCS#7 signed-data cue: detected"), "runtime.cat summary omitted PKCS#7 cue evidence");
  assert(catSummary.includes("no signtool/certutil/pnputil command"), "runtime.cat summary omitted no-catalog-runtime safety copy");

  const openApiSummary = summaryFor(apiSchemaContainerResult, "openapi.yaml");
  assert(openApiSummary.includes("API spec/collection preview"), "openapi.yaml did not use API spec preview");
  assert(openApiSummary.includes("Runtime Fixture API"), "openapi.yaml summary omitted API title evidence");
  assert(openApiSummary.includes("/runs"), "openapi.yaml summary omitted endpoint evidence");
  assert(!openApiSummary.includes("secret-token"), "openapi.yaml summary leaked sensitive URL token");
  assert(openApiSummary.includes("no request execution"), "openapi.yaml summary omitted no-request safety copy");

  const insomniaSummary = summaryFor(apiSchemaContainerResult, "insomnia.json");
  assert(insomniaSummary.includes("API spec/collection preview"), "insomnia.json did not use API client collection preview");
  assert(insomniaSummary.includes("Insomnia export"), "insomnia.json summary omitted Insomnia format evidence");
  assert(insomniaSummary.includes("Runtime Insomnia Workspace"), "insomnia.json summary omitted workspace title evidence");
  assert(insomniaSummary.includes("Runtime Insomnia List"), "insomnia.json summary omitted request name evidence");
  assert(insomniaSummary.includes("https://api.example.test/insomnia/runs?token=REDACTED"), "insomnia.json summary omitted sanitized request evidence");
  assert(!insomniaSummary.includes("secret-insomnia-token"), "insomnia.json summary leaked sensitive token");
  assert(insomniaSummary.includes("no request execution"), "insomnia.json summary omitted no-request safety copy");

  const postmanEnvironmentSummary = summaryFor(apiSchemaContainerResult, "runtime.postman_environment.json");
  assert(postmanEnvironmentSummary.includes("Postman environment/globals preview"), "runtime.postman_environment.json did not use Postman environment preview");
  assert(postmanEnvironmentSummary.includes("Runtime Postman Environment"), "runtime.postman_environment.json summary omitted environment name evidence");
  assert(postmanEnvironmentSummary.includes("Variables: 3; enabled 2; disabled 1"), "runtime.postman_environment.json summary omitted variable count evidence");
  assert(postmanEnvironmentSummary.includes("baseUrl") && postmanEnvironmentSummary.includes("apiToken"), "runtime.postman_environment.json summary omitted variable key evidence");
  assert(!postmanEnvironmentSummary.includes("secret-postman-env-token"), "runtime.postman_environment.json summary leaked sensitive token value");
  assert(postmanEnvironmentSummary.includes("no request execution, environment resolution, Postman CLI launch"), "runtime.postman_environment.json summary omitted no-runtime safety copy");

  const brunoSummary = summaryFor(apiSchemaContainerResult, "runtime.bru");
  assert(brunoSummary.includes("Bruno API request file preview"), "runtime.bru did not use Bruno preview");
  assert(brunoSummary.includes("Runtime Bruno Create"), "runtime.bru summary omitted request name evidence");
  assert(brunoSummary.includes("POST https://api.example.test/bruno/runs?token=REDACTED"), "runtime.bru summary omitted sanitized endpoint evidence");
  assert(!brunoSummary.includes("secret-bruno-token"), "runtime.bru summary leaked sensitive token");
  assert(brunoSummary.includes("no HTTP request execution, Bruno CLI launch"), "runtime.bru summary omitted no-request/no-CLI safety copy");

  const graphqlSummary = summaryFor(apiSchemaContainerResult, "schema.graphql");
  assert(graphqlSummary.includes("GraphQL schema/query preview"), "schema.graphql did not use GraphQL preview");
  assert(graphqlSummary.includes("RuntimeFixture"), "schema.graphql summary omitted operation evidence");
  assert(graphqlSummary.includes("RuntimeRun"), "schema.graphql summary omitted type evidence");
  assert(graphqlSummary.includes("no request execution"), "schema.graphql summary omitted no-request safety copy");

  const restClientSummary = summaryFor(apiSchemaContainerResult, "runtime.http");
  assert(restClientSummary.includes("REST Client request file preview"), "runtime.http did not use REST Client preview");
  assert(restClientSummary.includes("RuntimeList: GET https://api.example.test/runtime/runs?token=[redacted]"), "runtime.http summary omitted sanitized request evidence");
  assert(restClientSummary.includes("RuntimeCreate: POST {{baseUrl}}/runtime/runs"), "runtime.http summary omitted POST request evidence");
  assert(restClientSummary.includes("Authorization") && restClientSummary.includes("X-Trace-Id"), "runtime.http summary omitted header-name evidence");
  assert(!restClientSummary.includes("secret-token"), "runtime.http summary leaked sensitive URL token");
  assert(restClientSummary.includes("no HTTP request execution"), "runtime.http summary omitted no-request safety copy");

  const restClientRestSummary = summaryFor(apiSchemaContainerResult, "runtime.rest");
  assert(restClientRestSummary.includes("REST Client request file preview"), "runtime.rest did not use REST Client preview");
  assert(restClientRestSummary.includes("RuntimeDelete: DELETE https://api.example.test/{{$tenant}}/runs/42?token=[redacted]"), "runtime.rest summary omitted sanitized DELETE request evidence");
  assert(restClientRestSummary.includes("RuntimeStatus: GET {{baseUrl}}/status"), "runtime.rest summary omitted named GET request evidence");
  assert(restClientRestSummary.includes("X-Request-Id") && restClientRestSummary.includes("Accept"), "runtime.rest summary omitted header-name evidence");
  assert(restClientRestSummary.includes("tenant") && restClientRestSummary.includes("baseUrl"), "runtime.rest summary omitted variable-reference evidence");
  assert(!restClientRestSummary.includes("secret-rest-token"), "runtime.rest summary leaked sensitive URL token");
  assert(restClientRestSummary.includes("no HTTP request execution"), "runtime.rest summary omitted no-request safety copy");

  const protoSummary = summaryFor(apiSchemaContainerResult, "runtime.proto");
  assert(protoSummary.includes("Protobuf/gRPC schema preview"), "runtime.proto did not use Protobuf/gRPC preview");
  assert(protoSummary.includes("runtime.fixture"), "runtime.proto summary omitted package evidence");
  assert(protoSummary.includes("RuntimeFixtureService"), "runtime.proto summary omitted service evidence");
  assert(protoSummary.includes("no protoc/buf/grpcurl command"), "runtime.proto summary omitted no-descriptor-tool safety copy");

  const dockerfileSummary = summaryFor(apiSchemaContainerResult, "Dockerfile");
  assert(dockerfileSummary.includes("Container build file preview"), "Dockerfile did not use container build preview");
  assert(dockerfileSummary.includes("node:22-alpine"), "Dockerfile summary omitted base image evidence");
  assert(dockerfileSummary.includes("no container build, image pull, registry lookup"), "Dockerfile summary omitted no-container-runtime safety copy");

  const apiComposeSummary = summaryFor(apiSchemaContainerResult, "docker-compose.yaml");
  assert(apiComposeSummary.includes("Docker Compose file preview"), "docker-compose.yaml did not use Docker Compose preview in API/schema/container fixture group");
  assert(apiComposeSummary.includes("postgres:16"), "docker-compose.yaml summary omitted compose image evidence");
  assert(apiComposeSummary.includes("no docker compose command"), "docker-compose.yaml summary omitted no-compose safety copy in API/schema/container fixture group");

  const chartSummary = summaryFor(apiSchemaContainerResult, "Chart.yaml");
  assert(chartSummary.includes("Kubernetes package config preview"), "Chart.yaml did not use Kubernetes package config preview");
  assert(chartSummary.includes("Helm Chart.yaml"), "Chart.yaml summary omitted Helm format evidence");
  assert(chartSummary.includes("runtime-chart"), "Chart.yaml summary omitted chart name evidence");
  assert(chartSummary.includes("runtime-lib"), "Chart.yaml summary omitted dependency evidence");
  assert(chartSummary.includes("token=REDACTED"), "Chart.yaml summary omitted redacted repository URL token evidence");
  assert(!chartSummary.includes("secret-helm-token"), "Chart.yaml summary leaked Helm repository token");
  assert(chartSummary.includes("no helm/kubectl/kustomize command"), "Chart.yaml summary omitted no-runtime safety copy");

  const kustomizationSummary = summaryFor(apiSchemaContainerResult, "kustomization.yaml");
  assert(kustomizationSummary.includes("Kubernetes package config preview"), "kustomization.yaml did not use Kubernetes package config preview");
  assert(kustomizationSummary.includes("Kustomize kustomization"), "kustomization.yaml summary omitted Kustomize format evidence");
  assert(kustomizationSummary.includes("deployment.yaml") && kustomizationSummary.includes("service.yaml"), "kustomization.yaml summary omitted resource evidence");
  assert(kustomizationSummary.includes("ghcr.io/example/runtime=>ghcr.io/example/runtime-app:v1.2.3"), "kustomization.yaml summary omitted image rewrite evidence");
  assert(kustomizationSummary.includes("patches/deployment.yaml"), "kustomization.yaml summary omitted patch evidence");
  assert(kustomizationSummary.includes("runtime-system"), "kustomization.yaml summary omitted namespace evidence");
  assert(kustomizationSummary.includes("no helm/kubectl/kustomize command"), "kustomization.yaml summary omitted no-runtime safety copy");

  const sarifSummary = summaryFor(securityArtifactResult, "results.sarif");
  assert(sarifSummary.includes("SARIF static analysis result preview"), "results.sarif did not use SARIF preview");
  assert(sarifSummary.includes("Runtime Analyzer"), "results.sarif summary omitted tool evidence");
  assert(sarifSummary.includes("runtime-secret"), "results.sarif summary omitted rule evidence");
  assert(sarifSummary.includes("no scanner/test runner/code execution"), "results.sarif summary omitted no-scanner safety copy");

  const securityAuditSummary = summaryFor(securityArtifactResult, "npm-audit.json");
  assert(securityAuditSummary.includes("Security scan report preview"), "npm-audit.json did not use security scan report preview");
  assert(securityAuditSummary.includes("npm audit JSON"), "npm-audit.json summary omitted npm audit format evidence");
  assert(securityAuditSummary.includes("minimist") && securityAuditSummary.includes("lodash"), "npm-audit.json summary omitted vulnerable package evidence");
  assert(securityAuditSummary.includes("high 1") && securityAuditSummary.includes("moderate 1"), "npm-audit.json summary omitted severity counts");
  assert(securityAuditSummary.includes("GHSA-xvch-5gv4-984h") && securityAuditSummary.includes("CVE-2021-23337") && securityAuditSummary.includes("CWE-1321"), "npm-audit.json summary omitted advisory/CVE/CWE evidence");
  assert(!securityAuditSummary.includes("secret-audit-token"), "npm-audit.json summary leaked audit URL token");
  assert(securityAuditSummary.includes("no npm audit/Snyk/audit-ci command, package install, registry lookup"), "npm-audit.json summary omitted no-tool/no-registry safety copy");

  const cyclonedxSummary = summaryFor(securityArtifactResult, "cyclonedx.json");
  assert(cyclonedxSummary.includes("SBOM/provenance artifact preview"), "cyclonedx.json did not use SBOM preview");
  assert(cyclonedxSummary.includes("CycloneDX"), "cyclonedx.json summary omitted CycloneDX format evidence");
  assert(cyclonedxSummary.includes("runtime-lib"), "cyclonedx.json summary omitted component evidence");
  assert(cyclonedxSummary.includes("no vulnerability lookup"), "cyclonedx.json summary omitted no-vulnerability-lookup safety copy");

  const spdxSummary = summaryFor(securityArtifactResult, "runtime.spdx");
  assert(spdxSummary.includes("SBOM/provenance artifact preview"), "runtime.spdx did not use SBOM preview");
  assert(spdxSummary.includes("SPDX tag-value"), "runtime.spdx summary omitted SPDX format evidence");
  assert(spdxSummary.includes("runtime-fixture-app"), "runtime.spdx summary omitted package evidence");
  assert(spdxSummary.includes("no vulnerability lookup"), "runtime.spdx summary omitted no-vulnerability-lookup safety copy");

  const syftSummary = summaryFor(securityArtifactResult, "syft.json");
  assert(syftSummary.includes("SBOM/provenance artifact preview"), "syft.json did not use SBOM preview");
  assert(syftSummary.includes("Syft JSON SBOM"), "syft.json summary omitted Syft format evidence");
  assert(syftSummary.includes("runtime-lib@1.2.3") && syftSummary.includes("runtime-helper@0.4.0"), "syft.json summary omitted artifact evidence");
  assert(syftSummary.includes("2 Syft artifact entries"), "syft.json summary omitted artifact count evidence");
  assert(syftSummary.includes("license declarations") && syftSummary.includes("digest references"), "syft.json summary omitted license/digest hints");
  assert(syftSummary.includes("no vulnerability lookup"), "syft.json summary omitted no-vulnerability-lookup safety copy");

  const certSummary = summaryFor(securityArtifactResult, "runtime.crt");
  assert(certSummary.includes("Security artifact preview"), "runtime.crt did not use security artifact preview");
  assert(certSummary.includes("Certificate blocks"), "runtime.crt summary omitted certificate block evidence");
  assert(certSummary.includes("no key import"), "runtime.crt summary omitted no-key-import safety copy");

  const checksumSummary = summaryFor(securityArtifactResult, "checksums.sha256");
  assert(checksumSummary.includes("Checksum preview"), "checksums.sha256 did not use checksum preview");
  assert(checksumSummary.includes("runtime.exe"), "checksums.sha256 summary omitted checksum target evidence");
  assert(checksumSummary.includes("no referenced file hashing"), "checksums.sha256 summary omitted no-hashing safety copy");

  const wasmSummary = summaryFor(securityArtifactResult, "runtime.wasm");
  assert(wasmSummary.includes("Binary artifact metadata preview (WebAssembly"), "runtime.wasm did not use WASM binary preview");
  assert(wasmSummary.includes("version 1"), "runtime.wasm summary omitted WASM version evidence");
  assert(wasmSummary.includes("runtime"), "runtime.wasm summary omitted custom section evidence");
  assert(wasmSummary.includes("no module instantiation"), "runtime.wasm summary omitted no-instantiation safety copy");

  const exeSummary = summaryFor(securityArtifactResult, "runtime.exe");
  assert(exeSummary.includes("Binary artifact metadata preview (EXE"), "runtime.exe did not use PE binary preview");
  assert(exeSummary.includes("PE header: x64"), "runtime.exe summary omitted PE header evidence");
  assert(exeSummary.includes(".text"), "runtime.exe summary omitted section evidence");
  assert(exeSummary.includes("no process launch"), "runtime.exe summary omitted no-process-launch safety copy");

  const jarSummary = summaryFor(securityArtifactResult, "runtime.jar");
  assert(jarSummary.includes("Java build artifact preview (JAR"), "runtime.jar did not use Java archive preview");
  assert(jarSummary.includes("Main-Class: org.opendrsai.runtime.Main"), "runtime.jar summary omitted manifest main-class evidence");
  assert(jarSummary.includes("org/opendrsai/runtime/Main.class"), "runtime.jar summary omitted class entry evidence");
  assert(jarSummary.includes("org.opendrsai.runtime.Main"), "runtime.jar summary omitted package/class hint evidence");
  assert(jarSummary.includes("lib/runtime-helper.jar"), "runtime.jar summary omitted nested archive cue");
  assert(jarSummary.includes("no JVM, javap, build tool"), "runtime.jar summary omitted no-JVM safety copy");

  const classSummary = summaryFor(securityArtifactResult, "RuntimeFixture.class");
  assert(classSummary.includes("Java class file preview"), "RuntimeFixture.class did not use Java class preview");
  assert(classSummary.includes("CAFEBABE magic valid"), "RuntimeFixture.class summary omitted CAFEBABE evidence");
  assert(classSummary.includes("major 61"), "RuntimeFixture.class summary omitted Java class version evidence");
  assert(classSummary.includes("org.opendrsai.runtime.RuntimeFixture"), "RuntimeFixture.class summary omitted constant-pool hint");
  assert(classSummary.includes("no JVM, javap, bytecode verification"), "RuntimeFixture.class summary omitted no-bytecode-runtime safety copy");

  const geojsonSummary = summaryFor(opsDesignResult, "runtime.geojson");
  assert(geojsonSummary.includes("Geospatial preview"), "runtime.geojson did not use geospatial preview");
  assert(geojsonSummary.includes("Runtime Operations Site"), "runtime.geojson summary omitted feature name evidence");
  assert(geojsonSummary.includes("no map renderer"), "runtime.geojson summary omitted no-map-runtime safety copy");

  const terraformSummary = summaryFor(opsDesignResult, "runtime.tf");
  assert(terraformSummary.includes("Infrastructure-as-code preview"), "runtime.tf did not use IaC preview");
  assert(terraformSummary.includes("azurerm_resource_group"), "runtime.tf summary omitted Terraform resource evidence");
  assert(terraformSummary.includes("no terraform init/plan/apply"), "runtime.tf summary omitted no-Terraform safety copy");

  const terraformPlanSummary = summaryFor(opsDesignResult, "runtime.tfplan.json");
  assert(terraformPlanSummary.includes("Terraform plan JSON preview"), "runtime.tfplan.json did not use Terraform plan preview");
  assert(terraformPlanSummary.includes("create: 1") && terraformPlanSummary.includes("update: 1"), "runtime.tfplan.json summary omitted action counts");
  assert(terraformPlanSummary.includes("azurerm_monitor_diagnostic_setting.runtime"), "runtime.tfplan.json summary omitted resource change evidence");
  assert(terraformPlanSummary.includes("registry.terraform.io/hashicorp/azurerm"), "runtime.tfplan.json summary omitted provider evidence");
  assert(terraformPlanSummary.includes("module.diagnostics"), "runtime.tfplan.json summary omitted module evidence");
  assert(terraformPlanSummary.includes("runtime_endpoint"), "runtime.tfplan.json summary omitted output-change evidence");
  assert(!terraformPlanSummary.includes("secret-terraform-plan-token"), "runtime.tfplan.json summary leaked plan before/after value");
  assert(terraformPlanSummary.includes("before/after values were not expanded"), "runtime.tfplan.json summary omitted value non-expansion safety copy");
  assert(terraformPlanSummary.includes("no terraform init/plan/show/apply"), "runtime.tfplan.json summary omitted no-Terraform runtime safety copy");

  const cloudFormationSummary = summaryFor(opsDesignResult, "runtime.cloudformation.yaml");
  assert(cloudFormationSummary.includes("Cloud IaC template preview"), "runtime.cloudformation.yaml did not use Cloud IaC preview");
  assert(cloudFormationSummary.includes("CloudFormation/SAM YAML"), "runtime.cloudformation.yaml summary omitted CloudFormation/SAM format evidence");
  assert(cloudFormationSummary.includes("AWS::Serverless::Function"), "runtime.cloudformation.yaml summary omitted resource type evidence");
  assert(cloudFormationSummary.includes("RuntimeStage"), "runtime.cloudformation.yaml summary omitted parameter evidence");
  assert(cloudFormationSummary.includes("no aws/cloudformation/sam/az/bicep command"), "runtime.cloudformation.yaml summary omitted no-cloud-runtime safety copy");

  const armTemplateSummary = summaryFor(opsDesignResult, "runtime.arm-template.json");
  assert(armTemplateSummary.includes("Cloud IaC template preview"), "runtime.arm-template.json did not use Cloud IaC preview");
  assert(armTemplateSummary.includes("Azure ARM deployment template JSON"), "runtime.arm-template.json summary omitted ARM format evidence");
  assert(armTemplateSummary.includes("Microsoft.Storage/storageAccounts"), "runtime.arm-template.json summary omitted ARM resource type evidence");
  assert(armTemplateSummary.includes("runtimeLocation"), "runtime.arm-template.json summary omitted parameter evidence");
  assert(!armTemplateSummary.includes("secret-location-should-not-expand"), "runtime.arm-template.json summary leaked ARM parameter default value");
  assert(armTemplateSummary.includes("parameter/default values were not expanded"), "runtime.arm-template.json summary omitted value non-expansion safety copy");

  const bicepSummary = summaryFor(opsDesignResult, "runtime.bicep");
  assert(bicepSummary.includes("Cloud IaC template preview"), "runtime.bicep did not use Cloud IaC preview");
  assert(bicepSummary.includes("Azure Bicep template"), "runtime.bicep summary omitted Bicep format evidence");
  assert(bicepSummary.includes("runtimeStorage") && bicepSummary.includes("Microsoft.Storage/storageAccounts"), "runtime.bicep summary omitted Bicep resource evidence");
  assert(bicepSummary.includes("runtimeStorageId"), "runtime.bicep summary omitted output evidence");
  assert(bicepSummary.includes("no aws/cloudformation/sam/az/bicep command"), "runtime.bicep summary omitted no-cloud-runtime safety copy");

  const ansibleSummary = summaryFor(opsDesignResult, "runtime-playbook.yaml");
  assert(ansibleSummary.includes("Ansible automation preview"), "runtime-playbook.yaml did not use Ansible preview");
  assert(ansibleSummary.includes("Runtime fixture deployment"), "runtime-playbook.yaml summary omitted play evidence");
  assert(ansibleSummary.includes("no ansible-playbook/ansible-inventory/ansible command"), "runtime-playbook.yaml summary omitted no-Ansible safety copy");

  const dxfSummary = summaryFor(opsDesignResult, "runtime.dxf");
  assert(dxfSummary.includes("CAD drawing metadata preview"), "runtime.dxf did not use CAD drawing preview");
  assert(dxfSummary.includes("RuntimeLayer"), "runtime.dxf summary omitted layer evidence");
  assert(dxfSummary.includes("no CAD renderer"), "runtime.dxf summary omitted no-CAD-runtime safety copy");

  const mermaidSummary = summaryFor(opsDesignResult, "runtime.mmd");
  assert(mermaidSummary.includes("Diagram source preview"), "runtime.mmd did not use diagram source preview");
  assert(mermaidSummary.includes("Mermaid diagram source"), "runtime.mmd summary omitted Mermaid format evidence");
  assert(mermaidSummary.includes("no diagram renderer"), "runtime.mmd summary omitted no-diagram-runtime safety copy");

  const graphvizSummary = summaryFor(opsDesignResult, "runtime.dot");
  assert(graphvizSummary.includes("Diagram source preview"), "runtime.dot did not use diagram source preview");
  assert(graphvizSummary.includes("Graphviz DOT diagram source"), "runtime.dot summary omitted Graphviz DOT format evidence");
  assert(graphvizSummary.includes("RuntimeFixture"), "runtime.dot summary omitted graph name evidence");
  assert(graphvizSummary.includes("Runtime") && graphvizSummary.includes("Review"), "runtime.dot summary omitted DOT node evidence");
  assert(graphvizSummary.includes("no diagram renderer"), "runtime.dot summary omitted no-diagram-runtime safety copy");

  const scssSummary = summaryFor(opsDesignResult, "runtime.scss");
  assert(scssSummary.includes("Stylesheet preview (SCSS"), "runtime.scss did not use SCSS stylesheet preview");
  assert(scssSummary.includes("--runtime-accent"), "runtime.scss summary omitted custom property evidence");
  assert(scssSummary.includes("no Sass/Less/PostCSS compiler"), "runtime.scss summary omitted no-stylesheet-runtime safety copy");

  const msgSummary = summaryFor(windowsNativeResult, "runtime.msg");
  assert(msgSummary.includes("Outlook MSG message preview"), "runtime.msg did not use Outlook MSG preview");
  assert(msgSummary.includes("valid OLE container signature"), "runtime.msg summary omitted OLE signature evidence");
  assert(msgSummary.includes("Runtime Outlook Fixture"), "runtime.msg summary omitted MSG readable-string evidence");
  assert(msgSummary.includes("no Outlook/MAPI runtime"), "runtime.msg summary omitted no-Outlook safety copy");

  const lnkSummary = summaryFor(windowsNativeResult, "runtime.lnk");
  assert(lnkSummary.includes("Windows shortcut metadata preview"), "runtime.lnk did not use Windows shortcut preview");
  assert(lnkSummary.includes("Shell Link header: valid"), "runtime.lnk summary omitted Shell Link header evidence");
  assert(lnkSummary.includes("C:\\Runtime\\fixture.exe"), "runtime.lnk summary omitted bounded string evidence");
  assert(lnkSummary.includes("the shortcut target was not resolved or opened"), "runtime.lnk summary omitted no-follow safety copy");

  const regSummary = summaryFor(windowsNativeResult, "runtime.reg");
  assert(regSummary.includes("Windows registry export preview"), "runtime.reg did not use registry export preview");
  assert(regSummary.includes("RuntimeFixture"), "runtime.reg summary omitted registry key evidence");
  assert(!regSummary.includes("secret-registry-token"), "runtime.reg summary leaked registry secret value");
  assert(regSummary.includes("no registry import/export command"), "runtime.reg summary omitted no-registry-mutation safety copy");

  const wprpSummary = summaryFor(windowsNativeResult, "runtime.wprp");
  assert(wprpSummary.includes("Windows Performance Recorder profile preview"), "runtime.wprp did not use WPRP preview");
  assert(wprpSummary.includes("Runtime Fixture Verbose"), "runtime.wprp summary omitted profile evidence");
  assert(wprpSummary.includes("RuntimeProvider"), "runtime.wprp summary omitted provider evidence");
  assert(wprpSummary.includes("no wpr.exe launch"), "runtime.wprp summary omitted no-WPR-runtime safety copy");

  const dmpSummary = summaryFor(windowsNativeResult, "runtime.dmp");
  assert(dmpSummary.includes("Windows crash dump metadata preview"), "runtime.dmp did not use crash dump preview");
  assert(dmpSummary.includes("ThreadListStream"), "runtime.dmp summary omitted minidump stream evidence");
  assert(dmpSummary.includes("SystemInfoStream"), "runtime.dmp summary omitted system-info stream evidence");
  assert(dmpSummary.includes("no WinDbg/cdb/procdump process"), "runtime.dmp summary omitted no-debugger safety copy");

  const docxSummary = summaryFor(officeWorkbookResult, "runtime.docx");
  assert(docxSummary.includes("Document text preview"), "runtime.docx did not use document text preview");
  assert(docxSummary.includes("Runtime DOCX fixture body"), "runtime.docx summary omitted DOCX body evidence");
  assert(docxSummary.includes("Runtime DOCX review comment"), "runtime.docx summary omitted DOCX comment evidence");

  const xlsxSummary = summaryFor(officeWorkbookResult, "runtime.xlsx");
  assert(xlsxSummary.includes("XLSX workbook preview"), "runtime.xlsx did not use XLSX workbook preview");
  assert(xlsxSummary.includes("Runtime Data"), "runtime.xlsx summary omitted sheet-name evidence");
  assert(xlsxSummary.includes("Runtime XLSX cached row"), "runtime.xlsx summary omitted cached worksheet evidence");
  assert(xlsxSummary.includes("Formula previews"), "runtime.xlsx summary omitted formula preview evidence");
  assert(xlsxSummary.includes("Runtime Data!C3=SUM(B2:B2) cached=42"), "runtime.xlsx summary omitted formula/cached-value evidence");
  assert(xlsxSummary.includes("token=[redacted]"), "runtime.xlsx formula preview omitted URL secret redaction");
  assert(xlsxSummary.includes("formulas were not evaluated"), "runtime.xlsx summary omitted no-formula-evaluation safety copy");
  assert(xlsxSummary.includes("no spreadsheet runtime"), "runtime.xlsx summary omitted no-spreadsheet-runtime safety copy");

  const xlsmSummary = summaryFor(officeWorkbookResult, "runtime.xlsm");
  assert(xlsmSummary.includes("XLSM macro-enabled workbook preview"), "runtime.xlsm did not use XLSM workbook preview");
  assert(xlsmSummary.includes("Runtime XLSM cached row"), "runtime.xlsm summary omitted cached worksheet evidence");
  assert(xlsmSummary.includes("Runtime Data!C3=SUM(B2:B2) cached=42"), "runtime.xlsm summary omitted formula/cached-value evidence");
  assert(xlsmSummary.includes("external references were not resolved"), "runtime.xlsm summary omitted no-external-reference safety copy");
  assert(xlsmSummary.includes("no spreadsheet runtime, VBA project inspection, macro execution"), "runtime.xlsm summary omitted no-VBA/no-macro safety copy");

  const pptxSummary = summaryFor(officeWorkbookResult, "runtime.pptx");
  assert(pptxSummary.includes("Document text preview"), "runtime.pptx did not use document text preview");
  assert(pptxSummary.includes("Runtime PPTX slide title"), "runtime.pptx summary omitted slide text evidence");
  assert(pptxSummary.includes("Runtime speaker note"), "runtime.pptx summary omitted notes text evidence");
  assert(pptxSummary.includes("no PowerPoint runtime"), "runtime.pptx summary omitted no-PowerPoint safety copy");

  const odtSummary = summaryFor(officeWorkbookResult, "runtime.odt");
  assert(odtSummary.includes("Document text preview"), "runtime.odt did not use document text preview");
  assert(odtSummary.includes("Runtime OpenDocument body"), "runtime.odt summary omitted OpenDocument content evidence");
  assert(odtSummary.includes("no LibreOffice/OpenOffice runtime"), "runtime.odt summary omitted no-LibreOffice safety copy");

  const docSummary = summaryFor(officeWorkbookResult, "runtime.doc");
  assert(docSummary.includes("Legacy Word document text preview"), "runtime.doc did not use legacy Word preview");
  assert(docSummary.includes("Runtime legacy DOC body"), "runtime.doc summary omitted legacy DOC string evidence");
  assert(docSummary.includes("no Word runtime"), "runtime.doc summary omitted no-Word safety copy");

  const xlsSummary = summaryFor(officeWorkbookResult, "runtime.xls");
  assert(xlsSummary.includes("Legacy Excel workbook text preview"), "runtime.xls did not use legacy Excel preview");
  assert(xlsSummary.includes("Runtime legacy XLS workbook"), "runtime.xls summary omitted legacy XLS string evidence");
  assert(xlsSummary.includes("no Excel runtime"), "runtime.xls summary omitted no-Excel safety copy");

  const sqliteSummary = summaryFor(dataNetworkResult, "runtime.sqlite");
  assert(sqliteSummary.includes("SQLite database metadata preview"), "runtime.sqlite did not use SQLite database preview");
  assert(sqliteSummary.includes("SQLite format 3"), "runtime.sqlite summary omitted SQLite header evidence");
  assert(sqliteSummary.includes("runtime_users"), "runtime.sqlite summary omitted schema snippet evidence");
  assert(sqliteSummary.includes("no database connection"), "runtime.sqlite summary omitted no-database-connection safety copy");

  const sqlSummary = summaryFor(dataNetworkResult, "schema.sql");
  assert(sqlSummary.includes("SQL script preview"), "schema.sql did not use SQL script preview");
  assert(sqlSummary.includes("CREATE TABLE"), "schema.sql summary omitted statement-kind evidence");
  assert(sqlSummary.includes("runtime_users"), "schema.sql summary omitted DDL table evidence");
  assert(sqlSummary.includes("no database connection"), "schema.sql summary omitted no-SQL-execution safety copy");

  const csvSummary = summaryFor(delimitedDataResult, "runtime.csv");
  assert(csvSummary.includes("Structured CSV preview"), "runtime.csv did not use CSV structured preview");
  assert(csvSummary.includes("Columns (4): user_id, event_name, status, api_token"), "runtime.csv summary omitted column evidence");
  assert(csvSummary.includes("identifier/relationship key candidate"), "runtime.csv summary omitted schema hint evidence");
  assert(!csvSummary.includes("secret-csv-token"), "runtime.csv summary leaked sensitive token value");
  assert(csvSummary.includes("no database connection, network call, spreadsheet macro execution"), "runtime.csv summary omitted no-runtime safety copy");

  const tsvSummary = summaryFor(delimitedDataResult, "runtime.tsv");
  assert(tsvSummary.includes("Structured TSV preview"), "runtime.tsv did not use TSV structured preview");
  assert(tsvSummary.includes("Columns (4): run_id, owner, result, created_at"), "runtime.tsv summary omitted column evidence");
  assert(tsvSummary.includes("enum-like values passed, failed"), "runtime.tsv summary omitted enum-like schema evidence");
  assert(tsvSummary.includes("tab-separated data was parsed from a bounded local byte sample"), "runtime.tsv summary omitted TSV bounded parsing evidence");

  const jsonlSummary = summaryFor(dataNetworkResult, "events.jsonl");
  assert(jsonlSummary.includes("Structured JSONL preview"), "events.jsonl did not use JSONL preview");
  assert(jsonlSummary.includes("event_name"), "events.jsonl summary omitted field evidence");
  assert(!jsonlSummary.includes("secret-jsonl-token"), "events.jsonl summary leaked sensitive token value");
  assert(jsonlSummary.includes("no database connection, query execution"), "events.jsonl summary omitted no-query safety copy");

  const harSummary = summaryFor(dataNetworkResult, "runtime.har");
  assert(harSummary.includes("HAR network trace preview"), "runtime.har did not use HAR preview");
  assert(harSummary.includes("api.example.test"), "runtime.har summary omitted host evidence");
  assert(!harSummary.includes("secret-har-token"), "runtime.har summary leaked sensitive HAR token value");
  assert(harSummary.includes("no browser profile access, request replay, network call"), "runtime.har summary omitted no-replay safety copy");

  const devtoolsTraceSummary = summaryFor(dataNetworkResult, "runtime.trace.json");
  assert(devtoolsTraceSummary.includes("DevTools performance trace preview"), "runtime.trace.json did not use DevTools trace preview");
  assert(devtoolsTraceSummary.includes("Renderer"), "runtime.trace.json summary omitted process evidence");
  assert(devtoolsTraceSummary.includes("CrRendererMain"), "runtime.trace.json summary omitted thread evidence");
  assert(devtoolsTraceSummary.includes("RunTask") && devtoolsTraceSummary.includes("125ms"), "runtime.trace.json summary omitted long task evidence");
  assert(devtoolsTraceSummary.includes("devtools.timeline"), "runtime.trace.json summary omitted category evidence");
  assert(devtoolsTraceSummary.includes("data") && devtoolsTraceSummary.includes("frame"), "runtime.trace.json summary omitted argument-key evidence");
  assert(!devtoolsTraceSummary.includes("secret-trace-token"), "runtime.trace.json summary leaked trace argument token");
  assert(devtoolsTraceSummary.includes("no Chrome/Edge/DevTools/Lighthouse launch, trace replay"), "runtime.trace.json summary omitted no-browser/no-replay safety copy");

  const lighthouseSummary = summaryFor(dataNetworkResult, "runtime.lighthouse.json");
  assert(lighthouseSummary.includes("Lighthouse report preview"), "runtime.lighthouse.json did not use Lighthouse report preview");
  assert(lighthouseSummary.includes("https://example.test/app?token=[redacted]"), "runtime.lighthouse.json summary omitted redacted URL evidence");
  assert(!lighthouseSummary.includes("secret-lighthouse-token"), "runtime.lighthouse.json summary leaked URL token");
  assert(lighthouseSummary.includes("Performance=72") && lighthouseSummary.includes("SEO=83"), "runtime.lighthouse.json summary omitted category scores");
  assert(lighthouseSummary.includes("Largest Contentful Paint") && lighthouseSummary.includes("Total Blocking Time"), "runtime.lighthouse.json summary omitted audit highlights");
  assert(lighthouseSummary.includes("no Chrome/Edge/DevTools/Lighthouse launch, page audit, trace replay"), "runtime.lighthouse.json summary omitted no-browser/no-audit safety copy");

  const pcapSummary = summaryFor(dataNetworkResult, "runtime.pcap");
  assert(pcapSummary.includes("Packet capture preview (classic PCAP"), "runtime.pcap did not use classic PCAP preview");
  assert(pcapSummary.includes("link type Ethernet"), "runtime.pcap summary omitted link-type evidence");
  assert(pcapSummary.includes("no packet payload decoding"), "runtime.pcap summary omitted no-decode safety copy");

  const pcapngSummary = summaryFor(dataNetworkResult, "runtime.pcapng");
  assert(pcapngSummary.includes("Packet capture preview (PCAPNG"), "runtime.pcapng did not use PCAPNG preview");
  assert(pcapngSummary.includes("section-header") && pcapngSummary.includes("interface-description"), "runtime.pcapng summary omitted block evidence");
  assert(pcapngSummary.includes("no packet payload decoding"), "runtime.pcapng summary omitted no-decode safety copy");

  const notebookSummary = summaryFor(dataNetworkResult, "runtime.ipynb");
  assert(notebookSummary.includes("Notebook document preview"), "runtime.ipynb did not use notebook preview");
  assert(notebookSummary.includes("markdown: 1") && notebookSummary.includes("code: 1"), "runtime.ipynb summary omitted cell count evidence");
  assert(notebookSummary.includes("Output MIME types"), "runtime.ipynb summary omitted output MIME evidence");
  assert(notebookSummary.includes("no kernel startup, code execution"), "runtime.ipynb summary omitted no-kernel safety copy");

  const parquetSummary = summaryFor(dataNetworkResult, "runtime.parquet");
  assert(parquetSummary.includes("Parquet columnar data preview"), "runtime.parquet did not use Parquet preview");
  assert(parquetSummary.includes("Parquet magic: header PAR1"), "runtime.parquet summary omitted Parquet magic evidence");
  assert(parquetSummary.includes("runtime_events"), "runtime.parquet summary omitted readable metadata evidence");
  assert(parquetSummary.includes("no DuckDB/PyArrow/Spark query"), "runtime.parquet summary omitted no-query-engine safety copy");

  const arrowSummary = summaryFor(dataNetworkResult, "runtime.arrow");
  assert(arrowSummary.includes("Arrow IPC columnar data preview"), "runtime.arrow did not use Arrow preview");
  assert(arrowSummary.includes("Arrow magic: header ARROW1"), "runtime.arrow summary omitted Arrow magic evidence");
  assert(arrowSummary.includes("runtime_metric"), "runtime.arrow summary omitted readable metadata evidence");
  assert(arrowSummary.includes("no DuckDB/PyArrow/Spark query"), "runtime.arrow summary omitted no-query-engine safety copy");

  const featherSummary = summaryFor(dataNetworkResult, "runtime.feather");
  assert(featherSummary.includes("Feather/Arrow columnar data preview"), "runtime.feather did not use Feather/Arrow preview");
  assert(featherSummary.includes("Feather v1 FEA1 header detected"), "runtime.feather summary omitted Feather v1 header evidence");
  assert(featherSummary.includes("runtime_feather_schema"), "runtime.feather summary omitted readable metadata evidence");
  assert(featherSummary.includes("no DuckDB/PyArrow/Spark query"), "runtime.feather summary omitted no-query-engine safety copy");

  const epubSummary = summaryFor(contentMediaResult, "runtime.epub");
  assert(epubSummary.includes("EPUB ebook preview"), "runtime.epub did not use EPUB preview");
  assert(epubSummary.includes("Runtime EPUB Fixture"), "runtime.epub summary omitted EPUB metadata evidence");
  assert(epubSummary.includes("Runtime EPUB chapter"), "runtime.epub summary omitted EPUB body evidence");
  assert(epubSummary.includes("no ebook renderer"), "runtime.epub summary omitted no-ebook-runtime safety copy");

  const ttfSummary = summaryFor(contentMediaResult, "runtime.ttf");
  assert(ttfSummary.includes("Font metadata preview"), "runtime.ttf did not use font preview");
  assert(ttfSummary.includes("Runtime Fixture Font"), "runtime.ttf summary omitted font name evidence");
  assert(ttfSummary.includes("no font installation"), "runtime.ttf summary omitted no-font-runtime safety copy");

  const woffSummary = summaryFor(fontContainerVariantResult, "runtime.woff");
  assert(woffSummary.includes("Font metadata preview"), "runtime.woff did not use font preview");
  assert(woffSummary.includes("Format: WOFF"), "runtime.woff summary omitted WOFF format evidence");
  assert(woffSummary.includes("Runtime WOFF Fixture Font"), "runtime.woff summary omitted WOFF name evidence");
  assert(woffSummary.includes("no font installation"), "runtime.woff summary omitted no-font-runtime safety copy");

  const woff2Summary = summaryFor(fontContainerVariantResult, "runtime.woff2");
  assert(woff2Summary.includes("Font metadata preview"), "runtime.woff2 did not use font preview");
  assert(woff2Summary.includes("Format: WOFF2"), "runtime.woff2 summary omitted WOFF2 format evidence");
  assert(woff2Summary.includes("Font version: 1.2"), "runtime.woff2 summary omitted WOFF2 version evidence");
  assert(woff2Summary.includes("transformed name-table decoding is intentionally not performed"), "runtime.woff2 summary omitted WOFF2 bounded-decoding notice");
  assert(woff2Summary.includes("no font installation"), "runtime.woff2 summary omitted no-font-runtime safety copy");

  const bookmarksSummary = summaryFor(contentMediaResult, "bookmarks.html");
  assert(bookmarksSummary.includes("Browser bookmark export preview"), "bookmarks.html did not use bookmark export preview");
  assert(bookmarksSummary.includes("Runtime Folder"), "bookmarks.html summary omitted bookmark folder evidence");
  assert(bookmarksSummary.includes("Runtime Docs"), "bookmarks.html summary omitted bookmark link evidence");
  assert(!bookmarksSummary.includes("secret-bookmark-token"), "bookmarks.html summary leaked bookmark URL token");
  assert(bookmarksSummary.includes("URLs were not fetched"), "bookmarks.html summary omitted no-fetch safety copy");

  const urlShortcutSummary = summaryFor(contentMediaResult, "runtime.url");
  assert(urlShortcutSummary.includes("Link shortcut preview"), "runtime.url did not use link shortcut preview");
  assert(urlShortcutSummary.includes("https://links.example.test/runtime?token=%5BREDACTED%5D"), "runtime.url summary omitted redacted URL evidence");
  assert(urlShortcutSummary.includes("Host: links.example.test"), "runtime.url summary omitted host evidence");
  assert(!urlShortcutSummary.includes("secret-url-token"), "runtime.url summary leaked URL token");
  assert(urlShortcutSummary.includes("browser profiles were not opened, URLs were not fetched, scripts were not executed"), "runtime.url summary omitted no-fetch safety copy");

  const weblocSummary = summaryFor(contentMediaResult, "runtime.webloc");
  assert(weblocSummary.includes("Link shortcut preview"), "runtime.webloc did not use link shortcut preview");
  assert(weblocSummary.includes("https://links.example.test/webloc?token=%5BREDACTED%5D"), "runtime.webloc summary omitted redacted URL evidence");
  assert(weblocSummary.includes("Host: links.example.test"), "runtime.webloc summary omitted host evidence");
  assert(!weblocSummary.includes("secret-webloc-token"), "runtime.webloc summary leaked URL token");
  assert(weblocSummary.includes("no network call, credential lookup, or provider send"), "runtime.webloc summary omitted no-network safety copy");

  const rssSummary = summaryFor(contentMediaResult, "feed.rss");
  assert(rssSummary.includes("Feed document preview (RSS"), "feed.rss did not use RSS feed preview");
  assert(rssSummary.includes("Runtime RSS Feed"), "feed.rss summary omitted feed title evidence");
  assert(rssSummary.includes("Runtime RSS Item"), "feed.rss summary omitted feed entry evidence");
  assert(rssSummary.includes("remote feed URLs were not fetched"), "feed.rss summary omitted no-feed-fetch safety copy");

  const atomSummary = summaryFor(contentMediaResult, "feed.atom");
  assert(atomSummary.includes("Feed document preview (Atom"), "feed.atom did not use Atom feed preview");
  assert(atomSummary.includes("Runtime Atom Feed"), "feed.atom summary omitted feed title evidence");
  assert(atomSummary.includes("Runtime Atom Entry"), "feed.atom summary omitted feed entry evidence");
  assert(atomSummary.includes("remote feed URLs were not fetched"), "feed.atom summary omitted no-feed-fetch safety copy");

  const robotsSummary = summaryFor(contentMediaResult, "robots.txt");
  assert(robotsSummary.includes("Web crawl metadata preview (robots.txt"), "robots.txt did not use web crawl metadata preview");
  assert(robotsSummary.includes("User agents: *"), "robots.txt summary omitted user-agent evidence");
  assert(robotsSummary.includes("Disallow rules") && robotsSummary.includes("/private"), "robots.txt summary omitted disallow evidence");
  assert(robotsSummary.includes("https://example.test/sitemap.xml?token=REDACTED"), "robots.txt summary omitted redacted sitemap URL evidence");
  assert(!robotsSummary.includes("secret-robots-token"), "robots.txt summary leaked sitemap token");
  assert(robotsSummary.includes("remote URLs were not fetched, pages were not crawled, JavaScript was not executed"), "robots.txt summary omitted no-fetch/no-crawl safety copy");

  const sitemapSummary = summaryFor(contentMediaResult, "sitemap.xml");
  assert(sitemapSummary.includes("Web crawl metadata preview (sitemap urlset"), "sitemap.xml did not use sitemap preview");
  assert(sitemapSummary.includes("https://example.test/public"), "sitemap.xml summary omitted URL evidence");
  assert(sitemapSummary.includes("https://example.test/private?token=REDACTED"), "sitemap.xml summary omitted redacted URL evidence");
  assert(!sitemapSummary.includes("secret-sitemap-token"), "sitemap.xml summary leaked URL token");
  assert(sitemapSummary.includes("Change frequencies: daily"), "sitemap.xml summary omitted changefreq evidence");
  assert(sitemapSummary.includes("remote URLs were not fetched, pages were not crawled, JavaScript was not executed"), "sitemap.xml summary omitted no-fetch/no-crawl safety copy");

  const sitemapGzipSummary = summaryFor(contentMediaResult, "sitemap.xml.gz");
  assert(sitemapGzipSummary.includes("Web crawl metadata preview (sitemap urlset"), "sitemap.xml.gz did not use gzipped sitemap preview");
  assert(sitemapGzipSummary.includes("compressed sitemap input was decompressed only from local bytes"), "sitemap.xml.gz summary omitted local gzip safety copy");

  const srtSummary = summaryFor(contentMediaResult, "captions.srt");
  assert(srtSummary.includes("Timed transcript preview"), "captions.srt did not use timed transcript preview");
  assert(srtSummary.includes("Runtime SRT caption"), "captions.srt summary omitted SRT cue evidence");
  assert(srtSummary.includes("no microphone capture"), "captions.srt summary omitted no-capture safety copy");

  const vttSummary = summaryFor(contentMediaResult, "captions.vtt");
  assert(vttSummary.includes("Timed transcript preview"), "captions.vtt did not use timed transcript preview");
  assert(vttSummary.includes("Runtime VTT caption"), "captions.vtt summary omitted VTT cue evidence");
  assert(vttSummary.includes("no microphone capture"), "captions.vtt summary omitted no-capture safety copy");

  const androidManifestSummary = summaryFor(mobileManifestResult, "AndroidManifest.xml");
  assert(androidManifestSummary.includes("Android app manifest preview"), "AndroidManifest.xml did not use Android manifest preview");
  assert(androidManifestSummary.includes("org.opendrsai.runtime"), "AndroidManifest.xml summary omitted package evidence");
  assert(androidManifestSummary.includes("targetSdkVersion=35"), "AndroidManifest.xml summary omitted SDK evidence");
  assert(androidManifestSummary.includes("android.permission.INTERNET"), "AndroidManifest.xml summary omitted permission evidence");
  assert(androidManifestSummary.includes("activity=.MainActivity exported=true"), "AndroidManifest.xml summary omitted activity/exported evidence");
  assert(androidManifestSummary.includes("android.intent.action.MAIN"), "AndroidManifest.xml summary omitted intent action evidence");
  assert(androidManifestSummary.includes("com.example.API_TOKEN"), "AndroidManifest.xml summary omitted metadata key evidence");
  assert(!androidManifestSummary.includes("secret-android-token"), "AndroidManifest.xml summary leaked manifest meta-data value");
  assert(androidManifestSummary.includes("no Gradle/Android Studio/ADB/emulator/aapt/apksigner command"), "AndroidManifest.xml summary omitted no-mobile-runtime safety copy");

  const infoPlistSummary = summaryFor(mobileManifestResult, "Info.plist");
  assert(infoPlistSummary.includes("Apple Info.plist app manifest preview"), "Info.plist did not use Apple Info.plist preview");
  assert(infoPlistSummary.includes("org.opendrsai.runtime.ios"), "Info.plist summary omitted bundle identifier evidence");
  assert(infoPlistSummary.includes("shortVersion=2.3.4"), "Info.plist summary omitted version evidence");
  assert(infoPlistSummary.includes("platform=iphoneos"), "Info.plist summary omitted platform evidence");
  assert(infoPlistSummary.includes("drsai-runtime"), "Info.plist summary omitted URL scheme evidence");
  assert(infoPlistSummary.includes("NSCameraUsageDescription"), "Info.plist summary omitted privacy usage key evidence");
  assert(!infoPlistSummary.includes("secret-camera-token"), "Info.plist summary leaked privacy usage-description value");
  assert(infoPlistSummary.includes("no plutil/xcodebuild/simulator command"), "Info.plist summary omitted no-Apple-runtime safety copy");

  const apkSummary = summaryFor(mobilePackageResult, "runtime.apk");
  assert(apkSummary.includes("Mobile app package preview (Android APK"), "runtime.apk did not use mobile app package preview");
  assert(apkSummary.includes("manifest/AndroidManifest.xml"), "runtime.apk summary omitted manifest evidence");
  assert(apkSummary.includes("dex/classes.dex"), "runtime.apk summary omitted DEX evidence");
  assert(apkSummary.includes("lib/arm64-v8a/libruntime.so"), "runtime.apk summary omitted native library evidence");
  assert(apkSummary.includes("META-INF/RUNTIME.RSA"), "runtime.apk summary omitted signing evidence");
  assert(apkSummary.includes("did not extract package contents, decode binary manifests, verify signatures"), "runtime.apk summary omitted no-extract/no-verify safety copy");

  const aabSummary = summaryFor(mobilePackageResult, "runtime.aab");
  assert(aabSummary.includes("Mobile app package preview (Android App Bundle"), "runtime.aab did not use mobile app package preview");
  assert(aabSummary.includes("base/manifest/AndroidManifest.xml"), "runtime.aab summary omitted base manifest evidence");
  assert(aabSummary.includes("feature-chat/manifest/AndroidManifest.xml"), "runtime.aab summary omitted feature module evidence");
  assert(aabSummary.includes("base") && aabSummary.includes("feature-chat"), "runtime.aab summary omitted module cues");
  assert(aabSummary.includes("did not extract package contents"), "runtime.aab summary omitted no-extraction safety copy");

  const ipaSummary = summaryFor(mobilePackageResult, "runtime.ipa");
  assert(ipaSummary.includes("Mobile app package preview (iOS IPA"), "runtime.ipa did not use mobile app package preview");
  assert(ipaSummary.includes("Payload/RuntimeFixture.app/Info.plist"), "runtime.ipa summary omitted Info.plist evidence");
  assert(ipaSummary.includes("Payload/RuntimeFixture.app/RuntimeFixture"), "runtime.ipa summary omitted executable evidence");
  assert(ipaSummary.includes("embedded.mobileprovision"), "runtime.ipa summary omitted provisioning evidence");
  assert(ipaSummary.includes("plugin=RuntimeShare.appex"), "runtime.ipa summary omitted plugin cue");
  assert(ipaSummary.includes("did not extract package contents"), "runtime.ipa summary omitted no-extract safety copy");

  const flacSummary = summaryFor(audioResult, "runtime.flac");
  assert(flacSummary.includes("Audio metadata preview"), "runtime.flac did not use audio metadata preview");
  assert(flacSummary.includes("Format: FLAC"), "runtime.flac summary omitted FLAC format evidence");
  assert(flacSummary.includes("48000 Hz"), "runtime.flac summary omitted sample-rate evidence");
  assert(flacSummary.includes("stereo"), "runtime.flac summary omitted channel evidence");
  assert(flacSummary.includes("no microphone capture"), "runtime.flac summary omitted no-capture safety copy");

  const m4aSummary = summaryFor(audioResult, "runtime.m4a");
  assert(m4aSummary.includes("Audio metadata preview"), "runtime.m4a did not use audio metadata preview");
  assert(m4aSummary.includes("Format: M4A/MP4 audio"), "runtime.m4a summary omitted M4A format evidence");
  assert(m4aSummary.includes("handler soun"), "runtime.m4a summary omitted audio handler evidence");
  assert(m4aSummary.includes("brands M4A"), "runtime.m4a summary omitted brand evidence");
  assert(m4aSummary.includes("no microphone capture"), "runtime.m4a summary omitted no-capture safety copy");

  const oggSummary = summaryFor(audioResult, "runtime.ogg");
  assert(oggSummary.includes("Audio metadata preview"), "runtime.ogg did not use audio metadata preview");
  assert(oggSummary.includes("Format: Ogg Vorbis"), "runtime.ogg summary omitted Ogg Vorbis format evidence");
  assert(oggSummary.includes("44100 Hz"), "runtime.ogg summary omitted sample-rate evidence");
  assert(oggSummary.includes("192 kbps nominal"), "runtime.ogg summary omitted bit-rate evidence");
  assert(oggSummary.includes("no microphone capture"), "runtime.ogg summary omitted no-capture safety copy");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Channel adapter runtime fixture verification passed.");
