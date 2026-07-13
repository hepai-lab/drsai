import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

function writeKeePassFixture(filePath) {
  function headerField(id, data) {
    const header = Buffer.alloc(5);
    header.writeUInt8(id, 0);
    header.writeUInt32LE(data.length, 1);
    return Buffer.concat([header, data]);
  }

  const signature = Buffer.alloc(12);
  signature.writeUInt32LE(0x9aa2d903, 0);
  signature.writeUInt32LE(0xb54bfb67, 4);
  signature.writeUInt32LE(0x00040001, 8);
  const compression = Buffer.alloc(4);
  compression.writeUInt32LE(1, 0);
  const cipherId = Buffer.from("31c1f2e6bf714350be5805216afc5aff", "hex");
  const masterSeed = Buffer.alloc(32, 0x42);
  const encryptionIv = Buffer.alloc(16, 0x24);
  const kdfParameters = Buffer.from("$UUID AES-KDF Rounds Salt", "utf8");
  const end = Buffer.alloc(5);
  end.writeUInt8(0, 0);
  end.writeUInt32LE(0, 1);
  writeFileSync(filePath, Buffer.concat([
    signature,
    headerField(2, cipherId),
    headerField(3, compression),
    headerField(4, masterSeed),
    headerField(7, encryptionIv),
    headerField(11, kdfParameters),
    end,
    Buffer.from("encrypted-entry-secret-kdbx-token", "utf8"),
  ]));
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

function writeCrxFixture(filePath, entries) {
  const zipPayload = Buffer.concat(entries.map(([name, contents]) => zipLocalEntry(name, contents)));
  const header = Buffer.alloc(12);
  header.write("Cr24", 0, "ascii");
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(0, 8);
  writeFileSync(filePath, Buffer.concat([header, zipPayload]));
}

function writePlaywrightTraceZipFixture(filePath) {
  writeFileSync(filePath, Buffer.concat([
    zipLocalEntry("trace.trace", JSON.stringify({ type: "context-options", browserName: "chromium" })),
    zipLocalEntry("trace.network", JSON.stringify({ method: "GET", url: "https://example.test?token=secret-trace-token" })),
    zipLocalEntry("resources/runtime-request.txt", "Runtime trace resource body"),
    zipLocalEntry("resources/runtime-screenshot.png", "PNG screenshot placeholder"),
    zipLocalEntry("runtime-video.webm", "WEBM video placeholder"),
    zipLocalEntry("test.json", JSON.stringify({ title: "Runtime Playwright trace" })),
  ]));
}

function writeDotLottieFixture(filePath) {
  writeFileSync(filePath, Buffer.concat([
    zipLocalEntry("manifest.json", JSON.stringify({
      version: "1.0",
      generator: "OpenDrSai runtime fixture",
      author: "Runtime Animator",
      activeAnimationId: "runtime-main",
      animations: [
        {
          id: "runtime-main",
          initialTheme: "runtime-theme",
          loop: true,
          autoplay: false,
          speed: 1,
        },
      ],
    })),
    zipLocalEntry("animations/runtime-main.json", JSON.stringify({
      v: "5.12.2",
      fr: 24,
      ip: 0,
      op: 48,
      w: 320,
      h: 180,
      layers: [
        { ind: 1, ty: 4, nm: "Runtime dotLottie Shape", ks: { token: "secret-dotlottie-keyframe" } },
      ],
      assets: [
        { id: "runtime-image", p: "images/runtime.png?token=secret-dotlottie-asset" },
      ],
    })),
    zipLocalEntry("themes/runtime-theme.json", JSON.stringify({ id: "runtime-theme", colors: ["#112233"] })),
    zipLocalEntry("images/runtime.png", "PNG placeholder"),
    zipLocalEntry("state_machines/runtime-machine.json", JSON.stringify({ id: "runtime-machine" })),
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

function writeJavaFlightRecorderFixture(filePath) {
  const header = Buffer.alloc(68);
  Buffer.from([0x46, 0x4c, 0x52, 0x00]).copy(header, 0);
  header.writeUInt16BE(2, 4);
  header.writeUInt16BE(1, 6);
  header.writeBigUInt64BE(256n, 8);
  header.writeBigUInt64BE(128n, 16);
  header.writeBigUInt64BE(96n, 24);
  header.writeBigUInt64BE(1783598400000000000n, 32);
  header.writeBigUInt64BE(5000000000n, 40);
  header.writeBigUInt64BE(0n, 48);
  header.writeBigUInt64BE(1000000000n, 56);
  header.writeUInt32BE(1, 64);
  writeFileSync(filePath, Buffer.concat([
    header,
    Buffer.from("jdk.ExecutionSample jdk.ObjectAllocationInNewTLAB HotSpot main JFR RuntimeWorker secret-jfr-token", "latin1"),
  ]));
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

function writeBrowserHistorySqliteFixture(filePath) {
  const buffer = Buffer.alloc(4096);
  Buffer.from("SQLite format 3\0", "binary").copy(buffer, 0);
  buffer.writeUInt16BE(4096, 16);
  buffer[18] = 1;
  buffer[19] = 1;
  buffer.writeUInt32BE(1, 28);
  buffer.writeUInt32BE(1, 56);
  Buffer.from(
    [
      "CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER);",
      "CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, from_visit INTEGER, transition INTEGER);",
      "CREATE TABLE keyword_search_terms (keyword_id INTEGER, url_id INTEGER, term LONGVARCHAR);",
      "CREATE INDEX urls_url_index ON urls(url);",
      "secret-history-sqlite-token",
    ].join(" "),
    "utf8",
  ).copy(buffer, 256);
  writeFileSync(filePath, buffer);
}

function writeBrowserDownloadsSqliteFixture(filePath) {
  const buffer = Buffer.alloc(4096);
  Buffer.from("SQLite format 3\0", "binary").copy(buffer, 0);
  buffer.writeUInt16BE(4096, 16);
  buffer[18] = 1;
  buffer[19] = 1;
  buffer.writeUInt32BE(1, 28);
  buffer.writeUInt32BE(1, 56);
  Buffer.from(
    [
      "CREATE TABLE downloads (id INTEGER PRIMARY KEY, guid VARCHAR, target_path LONGVARCHAR, tab_url LONGVARCHAR, referrer LONGVARCHAR, received_bytes INTEGER, total_bytes INTEGER, state INTEGER, danger_type INTEGER);",
      "CREATE TABLE downloads_url_chains (id INTEGER, chain_index INTEGER, url LONGVARCHAR);",
      "CREATE TABLE downloads_slices (download_id INTEGER, offset INTEGER, received_bytes INTEGER);",
      "CREATE INDEX downloads_url_index ON downloads_url_chains(url);",
      "secret-download-sqlite-token",
    ].join(" "),
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

function encodeAvroLong(value) {
  let raw = value < 0 ? (-value * 2) - 1 : value * 2;
  const bytes = [];
  do {
    let byte = raw & 0x7f;
    raw = Math.floor(raw / 128);
    if (raw > 0) byte |= 0x80;
    bytes.push(byte);
  } while (raw > 0);
  return Buffer.from(bytes);
}

function encodeAvroBytes(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return Buffer.concat([encodeAvroLong(buffer.length), buffer]);
}

function encodeAvroString(value) {
  return encodeAvroBytes(value);
}

function writeAvroFixture(filePath) {
  const schema = JSON.stringify({
    type: "record",
    name: "RuntimeEvent",
    namespace: "org.opendrsai.fixture",
    fields: [
      { name: "runtime_id", type: "string" },
      { name: "metric_value", type: "double" },
    ],
  });
  const metadata = [
    ["avro.schema", schema],
    ["avro.codec", "null"],
    ["runtime.note", "runtime_avro_schema token=secret-avro-token"],
  ];
  const metadataBuffers = [
    encodeAvroLong(metadata.length),
    ...metadata.flatMap(([key, value]) => [encodeAvroString(key), encodeAvroBytes(value)]),
    encodeAvroLong(0),
  ];
  const sync = Buffer.from("0123456789abcdef", "ascii");
  writeFileSync(filePath, Buffer.concat([Buffer.from("Obj\u0001", "latin1"), ...metadataBuffers, sync]));
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

function writeWavFixture(filePath) {
  const dataBytes = 176400;
  const riffSize = 36 + dataBytes;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(riffSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(176400, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  writeFileSync(filePath, buffer);
}

function writeMp3Fixture(filePath) {
  const titleText = Buffer.from("\0Runtime MP3", "latin1");
  const titleFrame = Buffer.alloc(10 + titleText.length);
  titleFrame.write("TIT2", 0, "ascii");
  titleFrame.writeUInt32BE(titleText.length, 4);
  titleText.copy(titleFrame, 10);
  const id3Body = Buffer.concat([titleFrame]);
  const id3Header = Buffer.alloc(10);
  id3Header.write("ID3", 0, "ascii");
  id3Header[3] = 3;
  id3Header[6] = (id3Body.length >> 21) & 0x7f;
  id3Header[7] = (id3Body.length >> 14) & 0x7f;
  id3Header[8] = (id3Body.length >> 7) & 0x7f;
  id3Header[9] = id3Body.length & 0x7f;
  const frameHeader = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  writeFileSync(filePath, Buffer.concat([id3Header, id3Body, frameHeader, Buffer.alloc(4096)]));
}

function writeAacFixture(filePath) {
  const frameLength = 1031;
  const header = Buffer.from([
    0xff,
    0xf1,
    0x50,
    0x80 | ((frameLength >> 11) & 0x03),
    (frameLength >> 3) & 0xff,
    ((frameLength & 0x07) << 5) | 0x1f,
    0xfc,
  ]);
  writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(frameLength - header.length)]));
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

function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function writePngColorProfileFixture(filePath) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(32, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const gama = Buffer.alloc(4);
  gama.writeUInt32BE(45455, 0);
  writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("sRGB", Buffer.from([0])),
    pngChunk("gAMA", gama),
    pngChunk("iCCP", Buffer.concat([Buffer.from("Runtime RGB\0", "latin1"), Buffer.from([0, 1, 2, 3])])),
    pngChunk("IEND"),
  ]));
}

function jpegSegment(marker, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

function writeJpegColorProfileFixture(filePath) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(32, 1);
  sof.writeUInt16BE(48, 3);
  sof[5] = 3;
  sof[6] = 1;
  sof[7] = 0x11;
  sof[8] = 0;
  sof[9] = 2;
  sof[10] = 0x11;
  sof[11] = 1;
  sof[12] = 3;
  sof[13] = 0x11;
  sof[14] = 1;
  const adobe = Buffer.alloc(12);
  Buffer.from("Adobe", "ascii").copy(adobe, 0);
  adobe[11] = 1;
  writeFileSync(filePath, Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([1, 1, 0, 0])])),
    jpegSegment(0xee, adobe),
    jpegSegment(0xc0, sof),
    Buffer.from([0xff, 0xd9]),
  ]));
}

function riffChunk(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function writeGifAnimationFixture(filePath) {
  const logicalScreen = Buffer.alloc(7);
  logicalScreen.writeUInt16LE(32, 0);
  logicalScreen.writeUInt16LE(16, 2);
  logicalScreen[4] = 0x80;
  const globalColorTable = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff, 0xff]);
  const netscapeExtension = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from("NETSCAPE2.0", "ascii"),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ]);
  const frame = Buffer.concat([
    Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]),
    Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00]),
    Buffer.from([0x20, 0x00, 0x10, 0x00, 0x00]),
    Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]),
  ]);
  writeFileSync(filePath, Buffer.concat([
    Buffer.from("GIF89a", "ascii"),
    logicalScreen,
    globalColorTable,
    netscapeExtension,
    frame,
    frame,
    Buffer.from([0x3b]),
  ]));
}

function writeWebpAnimationFixture(filePath) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x12;
  vp8x.writeUIntLE(39, 4, 3);
  vp8x.writeUIntLE(23, 7, 3);
  const anim = Buffer.alloc(6);
  anim.writeUInt16LE(0, 4);
  const frame = Buffer.alloc(16);
  frame.writeUIntLE(39, 6, 3);
  frame.writeUIntLE(23, 9, 3);
  frame.writeUIntLE(100, 12, 3);
  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    riffChunk("VP8X", vp8x),
    riffChunk("ANIM", anim),
    riffChunk("ANMF", frame),
    riffChunk("ANMF", frame),
  ]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write("RIFF", 0, "ascii");
  riffHeader.writeUInt32LE(body.length, 4);
  writeFileSync(filePath, Buffer.concat([riffHeader, body]));
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
assert(checklist.includes("CocoaPods Runtime Package Fixtures"), "checklist omits CocoaPods runtime package fixture addendum");
assert(checklist.includes("`Podfile`, `Podfile.lock`, `project.pbxproj`, `RuntimeFixture.podspec`"), "checklist omits CocoaPods/Xcode runtime fixture file evidence");
assert(roadmap.includes("CocoaPods runtime package fixtures"), "roadmap omits CocoaPods runtime package fixture addendum");
assert(roadmap.includes("`Podfile`, `Podfile.lock`, `project.pbxproj`, `RuntimeFixture.podspec`"), "roadmap omits CocoaPods/Xcode runtime fixture file evidence");
assert(checklist.includes("runtime-python-dependency-golden-agent"), "checklist omits runtime Python dependency golden fixture agent record");
assert(checklist.includes("runtime Python dependency manifest golden fixtures"), "checklist omits runtime Python dependency fixture evidence");
assert(roadmap.includes("runtime Python dependency golden fixtures"), "roadmap omits runtime Python dependency fixture evidence");
assert(checklist.includes("Python Constraints Text Input"), "checklist omits Python constraints text input addendum");
assert(checklist.includes("`constraints-runtime.txt`"), "checklist omits Python constraints runtime fixture evidence");
assert(roadmap.includes("Python constraints text input"), "roadmap omits Python constraints input addendum");
assert(roadmap.includes("`constraints-runtime.txt`"), "roadmap omits Python constraints runtime fixture evidence");
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
assert(checklist.includes("keepass-kdbx-input-agent"), "checklist omits KeePass KDBX input agent record");
assert(checklist.includes("runtime `runtime.kdbx` golden fixture"), "checklist omits KeePass KDBX runtime fixture evidence");
assert(roadmap.includes("KeePass KDBX database input"), "roadmap omits KeePass KDBX input evidence");
assert(roadmap.includes("runtime `runtime.kdbx` golden fixture"), "roadmap omits KeePass KDBX runtime fixture evidence");
assert(checklist.includes("sarif-json-runtime-variant-agent"), "checklist omits SARIF JSON runtime variant agent record");
assert(checklist.includes("SARIF JSON Extension Runtime Fixture"), "checklist omits SARIF JSON runtime fixture evidence");
assert(checklist.includes("`results.sarif.json`") && checklist.includes("CodeQL tool evidence"), "checklist omits SARIF JSON fixture detail evidence");
assert(roadmap.includes("SARIF JSON extension runtime fixture"), "roadmap omits SARIF JSON runtime fixture evidence");
assert(roadmap.includes("`results.sarif.json`") && roadmap.includes("CodeQL tool evidence"), "roadmap omits SARIF JSON fixture detail evidence");
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
assert(checklist.includes("netlog-network-trace-agent"), "checklist omits Chrome NetLog network trace agent record");
assert(checklist.includes("Chrome NetLog Network Trace Input"), "checklist omits Chrome NetLog input addendum");
assert(checklist.includes("runtime NetLog golden fixture"), "checklist omits runtime NetLog golden fixture evidence");
assert(roadmap.includes("Chrome NetLog JSON input"), "roadmap omits Chrome NetLog input addendum");
assert(roadmap.includes("runtime NetLog golden fixture"), "roadmap omits runtime NetLog golden fixture evidence");
assert(checklist.includes("runtime-test-report-golden-agent"), "checklist omits runtime test report golden fixture agent record");
assert(checklist.includes("runtime test report golden fixtures"), "checklist omits runtime test report fixture evidence");
assert(roadmap.includes("runtime test report golden fixtures"), "roadmap omits runtime test report fixture evidence");
assert(checklist.includes("runtime-content-media-golden-agent"), "checklist omits runtime content/media golden fixture agent record");
assert(checklist.includes("runtime content/media golden fixtures"), "checklist omits runtime content/media fixture evidence");
assert(roadmap.includes("runtime content/media golden fixtures"), "roadmap omits runtime content/media fixture evidence");
assert(checklist.includes("browser-cookie-input-agent"), "checklist omits browser cookie export agent record");
assert(checklist.includes("runtime `cookies.txt` golden fixture"), "checklist omits browser cookie runtime fixture evidence");
assert(checklist.includes("hyphenated-browser-cookie-runtime-agent"), "checklist omits hyphenated browser cookie runtime agent record");
assert(checklist.includes("runtime `runtime-cookies.txt` golden fixture"), "checklist omits hyphenated browser cookie runtime fixture evidence");
assert(checklist.includes("browser-autofill-input-agent"), "checklist omits browser autofill export agent record");
assert(checklist.includes("runtime `autofill.csv` / `runtime-autofill.json` golden fixtures"), "checklist omits browser autofill runtime fixture evidence");
assert(checklist.includes("browser-bookmark-json-agent"), "checklist omits browser bookmark JSON agent record");
assert(checklist.includes("runtime `bookmarks.json` golden fixture"), "checklist omits browser bookmark JSON runtime fixture evidence");
assert(checklist.includes("browser-extension-manifest-agent"), "checklist omits browser extension manifest agent record");
assert(checklist.includes("runtime `extension-manifest.json` golden fixture"), "checklist omits browser extension manifest runtime fixture evidence");
assert(checklist.includes("browser-extension-inventory-agent"), "checklist omits browser extension inventory agent record");
assert(checklist.includes("runtime `browser-extensions.json` golden fixture"), "checklist omits browser extension inventory runtime fixture evidence");
assert(roadmap.includes("Browser cookie export input"), "roadmap omits browser cookie export evidence");
assert(roadmap.includes("runtime `cookies.txt` golden fixture"), "roadmap omits browser cookie runtime fixture evidence");
assert(roadmap.includes("hyphenated browser cookie runtime fixture"), "roadmap omits hyphenated browser cookie runtime fixture evidence");
assert(roadmap.includes("Browser autofill export input"), "roadmap omits browser autofill export evidence");
assert(roadmap.includes("runtime `autofill.csv` / `runtime-autofill.json` golden fixtures"), "roadmap omits browser autofill runtime fixture evidence");
assert(roadmap.includes("Browser bookmark JSON input"), "roadmap omits browser bookmark JSON evidence");
assert(roadmap.includes("runtime `bookmarks.json` golden fixture"), "roadmap omits browser bookmark JSON runtime fixture evidence");
assert(roadmap.includes("Browser extension manifest input"), "roadmap omits browser extension manifest evidence");
assert(roadmap.includes("runtime `extension-manifest.json` golden fixture"), "roadmap omits browser extension manifest runtime fixture evidence");
assert(roadmap.includes("Browser extension inventory input"), "roadmap omits browser extension inventory evidence");
assert(roadmap.includes("runtime `browser-extensions.json` golden fixture"), "roadmap omits browser extension inventory runtime fixture evidence");
assert(checklist.includes("browser-history-input-agent"), "checklist omits browser history export agent record");
assert(checklist.includes("runtime `history.csv` / `runtime-history.json` / `History` golden fixtures"), "checklist omits browser history runtime fixture evidence");
assert(roadmap.includes("Browser history export input"), "roadmap omits browser history export evidence");
assert(roadmap.includes("runtime `history.csv` / `runtime-history.json` / `History` golden fixtures"), "roadmap omits browser history runtime fixture evidence");
assert(checklist.includes("browser-downloads-input-agent"), "checklist omits browser downloads export agent record");
assert(checklist.includes("runtime `downloads.csv` / `runtime-downloads.json` / `Downloads` golden fixtures"), "checklist omits browser downloads runtime fixture evidence");
assert(roadmap.includes("Browser downloads export input"), "roadmap omits browser downloads export evidence");
assert(roadmap.includes("runtime `downloads.csv` / `runtime-downloads.json` / `Downloads` golden fixtures"), "roadmap omits browser downloads runtime fixture evidence");
assert(checklist.includes("browser-storage-input-agent"), "checklist omits browser storage export agent record");
assert(checklist.includes("runtime `local-storage.json` / `runtime-session-storage.json` golden fixtures"), "checklist omits browser storage runtime fixture evidence");
assert(roadmap.includes("Browser storage export input"), "roadmap omits browser storage export evidence");
assert(roadmap.includes("runtime `local-storage.json` / `runtime-session-storage.json` golden fixtures"), "roadmap omits browser storage runtime fixture evidence");
assert(checklist.includes("browser-session-tabs-agent"), "checklist omits browser session tabs agent record");
assert(checklist.includes("runtime `tabs.json` golden fixture"), "checklist omits browser session tabs runtime fixture evidence");
assert(roadmap.includes("Browser session tabs JSON input"), "roadmap omits browser session tabs input evidence");
assert(roadmap.includes("runtime `tabs.json` golden fixture"), "roadmap omits browser session tabs runtime fixture evidence");
assert(checklist.includes("apple-crash-report-input-agent"), "checklist omits Apple crash report input agent record");
assert(checklist.includes("runtime `runtime.crash` / `runtime.ips` golden fixtures"), "checklist omits Apple crash report runtime fixture evidence");
assert(roadmap.includes("Apple crash report input"), "roadmap omits Apple crash report input evidence");
assert(roadmap.includes("runtime `runtime.crash` / `runtime.ips` golden fixtures"), "roadmap omits Apple crash report runtime fixture evidence");
assert(checklist.includes("latex-context-agent"), "checklist omits LaTeX context agent record");
assert(checklist.includes("LaTeX/BibTeX Context Input"), "checklist omits LaTeX context input addendum");
assert(checklist.includes("runtime `paper.tex`, `references.bib`, and `latexmkrc` fixtures"), "checklist omits LaTeX runtime fixture evidence");
assert(roadmap.includes("LaTeX/BibTeX context input"), "roadmap omits LaTeX context input addendum");
assert(roadmap.includes("runtime `paper.tex`, `references.bib`, and `latexmkrc` fixtures"), "roadmap omits LaTeX runtime fixture evidence");
assert(checklist.includes("devcontainer-config-input-agent"), "checklist omits Dev Container config input agent record");
assert(checklist.includes("runtime `.devcontainer/devcontainer.json` golden fixture"), "checklist omits Dev Container runtime fixture evidence");
assert(roadmap.includes("Dev Container config input"), "roadmap omits Dev Container config input evidence");
assert(roadmap.includes("runtime `.devcontainer/devcontainer.json` golden fixture"), "roadmap omits Dev Container runtime fixture evidence");
assert(checklist.includes("renovate-config-input-agent"), "checklist omits Renovate config input agent record");
assert(checklist.includes("runtime `renovate.json` golden fixture"), "checklist omits Renovate config runtime fixture evidence");
assert(roadmap.includes("Renovate config input"), "roadmap omits Renovate config input evidence");
assert(roadmap.includes("runtime `renovate.json` golden fixture"), "roadmap omits Renovate config runtime fixture evidence");
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
assert(checklist.includes("llms-metadata-input-agent"), "checklist omits llms.txt metadata input agent record");
assert(checklist.includes("LLM Website Metadata Input"), "checklist omits llms.txt metadata input evidence");
assert(roadmap.includes("LLM website metadata input"), "roadmap omits llms.txt metadata input evidence");
assert(checklist.includes("pwa-web-manifest-agent"), "checklist omits PWA web manifest input agent record");
assert(checklist.includes("runtime `site.webmanifest` golden fixture"), "checklist omits PWA web manifest runtime fixture evidence");
assert(roadmap.includes("PWA web app manifest input"), "roadmap omits PWA web manifest input evidence");
assert(roadmap.includes("runtime `site.webmanifest` golden fixture"), "roadmap omits PWA web manifest runtime fixture evidence");
assert(checklist.includes("pwa-service-worker-agent"), "checklist omits PWA service worker input agent record");
assert(checklist.includes("runtime `service-worker.js` golden fixture"), "checklist omits PWA service worker runtime fixture evidence");
assert(roadmap.includes("PWA service worker script input"), "roadmap omits PWA service worker input evidence");
assert(roadmap.includes("runtime `service-worker.js` golden fixture"), "roadmap omits PWA service worker runtime fixture evidence");
assert(checklist.includes("animation-json-input-agent"), "checklist omits Lottie animation JSON input agent record");
assert(checklist.includes("runtime `animation.json` golden fixture"), "checklist omits Lottie animation JSON runtime fixture evidence");
assert(roadmap.includes("Lottie/Bodymovin animation JSON input"), "roadmap omits Lottie animation JSON input evidence");
assert(roadmap.includes("runtime `animation.json` golden fixture"), "roadmap omits Lottie animation JSON runtime fixture evidence");
assert(checklist.includes("dotlottie-archive-input-agent"), "checklist omits dotLottie archive input agent record");
assert(checklist.includes("runtime `runtime.lottie` golden fixture"), "checklist omits dotLottie archive runtime fixture evidence");
assert(roadmap.includes("dotLottie archive input"), "roadmap omits dotLottie archive input evidence");
assert(roadmap.includes("runtime `runtime.lottie` golden fixture"), "roadmap omits dotLottie archive runtime fixture evidence");
assert(checklist.includes("runtime-3d-model-golden-agent"), "checklist omits runtime 3D model golden fixture agent record");
assert(checklist.includes("runtime 3D model golden fixtures"), "checklist omits runtime 3D model fixture evidence");
assert(roadmap.includes("runtime 3D model golden fixtures"), "roadmap omits runtime 3D model fixture evidence");
assert(checklist.includes("runtime-scheduled-task-golden-agent"), "checklist omits runtime scheduled task golden fixture agent record");
assert(checklist.includes("runtime scheduled task golden fixture"), "checklist omits runtime scheduled task golden fixture evidence");
assert(roadmap.includes("runtime scheduled task golden fixture"), "roadmap omits runtime scheduled task fixture evidence");
assert(checklist.includes("WAV/MP3 Runtime Audio Golden Fixtures"), "checklist omits WAV/MP3 runtime audio fixture evidence");
assert(checklist.includes("`runtime.wav` and `runtime.mp3` selected-file imports"), "checklist omits WAV/MP3 runtime audio fixture file evidence");
assert(roadmap.includes("WAV/MP3 runtime audio golden fixtures"), "roadmap omits WAV/MP3 runtime audio fixture evidence");
assert(roadmap.includes("`runtime.wav` and `runtime.mp3`"), "roadmap omits WAV/MP3 runtime audio fixture file evidence");
assert(checklist.includes("runtime extended audio golden fixtures"), "checklist omits runtime extended audio fixture evidence");
assert(roadmap.includes("runtime extended audio golden fixtures"), "roadmap omits runtime extended audio fixture evidence");
assert(checklist.includes("runtime static analysis XML golden fixture"), "checklist omits runtime static analysis XML fixture evidence");
assert(roadmap.includes("runtime static analysis XML golden fixture"), "roadmap omits runtime static analysis XML fixture evidence");
assert(checklist.includes("runtime-ci-workflow-golden-agent"), "checklist omits runtime CI/CD workflow golden fixture agent record");
assert(checklist.includes("runtime CI/CD workflow golden fixtures"), "checklist omits runtime CI/CD workflow fixture evidence");
assert(roadmap.includes("runtime CI/CD workflow golden fixtures"), "roadmap omits runtime CI/CD workflow fixture evidence");
assert(checklist.includes("Expanded CI/CD Runtime Workflow Fixtures"), "checklist omits expanded CI/CD runtime fixture addendum");
assert(roadmap.includes("expanded CI/CD runtime workflow fixtures"), "roadmap omits expanded CI/CD runtime fixture addendum");
assert(checklist.includes("Bitbucket Pipelines, CircleCI, and Buildkite") && roadmap.includes("Bitbucket Pipelines, CircleCI, and Buildkite"), "docs omit expanded CI/CD provider runtime coverage");
assert(checklist.includes("runtime-repository-governance-golden-agent"), "checklist omits runtime repository governance golden fixture agent record");
assert(checklist.includes("runtime repository governance golden fixtures"), "checklist omits runtime repository governance fixture evidence");
assert(checklist.includes("gitmodules-governance-input-agent"), "checklist omits .gitmodules governance fixture agent record");
assert(checklist.includes("runtime `.gitmodules` golden fixture"), "checklist omits .gitmodules runtime fixture evidence");
assert(roadmap.includes("runtime repository governance golden fixtures"), "roadmap omits runtime repository governance fixture evidence");
assert(roadmap.includes("Gitmodules repository governance input"), "roadmap omits .gitmodules governance input evidence");
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
assert(checklist.includes("runtime Node package-manager config variant fixtures"), "checklist omits runtime Node package-manager config variant fixture evidence");
assert(checklist.includes("`.yarnrc`, `.pnpmfile.cjs`, and `.npmignore`"), "checklist omits Node package-manager variant fixture file evidence");
assert(roadmap.includes("runtime Node package-manager config variant fixtures"), "roadmap omits Node package-manager variant fixture evidence");
assert(checklist.includes("runtime-lcov-coverage-golden-agent"), "checklist omits runtime LCOV coverage golden fixture agent record");
assert(checklist.includes("runtime LCOV coverage golden fixture"), "checklist omits runtime LCOV coverage fixture evidence");
assert(roadmap.includes("runtime LCOV coverage golden fixture"), "roadmap omits runtime LCOV coverage fixture evidence");
assert(checklist.includes("istanbul-coverage-json-agent"), "checklist omits Istanbul JSON coverage agent record");
assert(checklist.includes("Istanbul JSON Coverage Input"), "checklist omits Istanbul JSON coverage evidence");
assert(checklist.includes("coverage-summary-aggregation-agent"), "checklist omits Istanbul coverage-summary agent record");
assert(checklist.includes("Istanbul Coverage Summary Aggregation"), "checklist omits Istanbul coverage-summary evidence");
assert(roadmap.includes("Istanbul JSON coverage input"), "roadmap omits Istanbul JSON coverage evidence");
assert(roadmap.includes("Istanbul coverage-summary aggregation"), "roadmap omits Istanbul coverage-summary evidence");
assert(checklist.includes("chat-export-json-input-agent"), "checklist omits chat export JSON input agent record");
assert(checklist.includes("Chat Export JSON Input"), "checklist omits chat export JSON evidence");
assert(checklist.includes("`slack-export.json`") && checklist.includes("`teams-export.json`") && checklist.includes("`discord-export.json`") && checklist.includes("`chatgpt-conversations.json`"), "checklist omits chat export fixture detail evidence");
assert(roadmap.includes("Chat export JSON input"), "roadmap omits chat export JSON evidence");
assert(roadmap.includes("Slack/Teams/ChatGPT"), "roadmap omits chat export provider boundary evidence");
assert(checklist.includes("otel-json-input-agent"), "checklist omits OpenTelemetry JSON input agent record");
assert(checklist.includes("OpenTelemetry OTLP JSON Input"), "checklist omits OpenTelemetry JSON evidence");
assert(checklist.includes("`runtime.otlp.json`") && checklist.includes("span/log/metric evidence"), "checklist omits OpenTelemetry runtime fixture detail evidence");
assert(roadmap.includes("OpenTelemetry OTLP JSON input"), "roadmap omits OpenTelemetry JSON evidence");
assert(roadmap.includes("span/log/metric evidence"), "roadmap omits OpenTelemetry fixture detail evidence");
assert(checklist.includes("mcp-server-config-context-agent"), "checklist omits MCP server config context agent record");
assert(checklist.includes("MCP Server Config File Input"), "checklist omits MCP server config evidence");
assert(checklist.includes("`.drsai/mcp-servers.json`"), "checklist omits MCP server config fixture detail evidence");
assert(roadmap.includes("MCP server config file input"), "roadmap omits MCP server config evidence");
assert(roadmap.includes("`.drsai/mcp-servers.json`"), "roadmap omits MCP server config fixture detail evidence");
assert(checklist.includes("MCP Config Local Schema Hints"), "checklist omits MCP config schema hint evidence");
assert(checklist.includes("brokenLegacy: missing command/url"), "checklist omits MCP config schema hint runtime evidence");
assert(roadmap.includes("MCP config local schema hints"), "roadmap omits MCP config schema hint evidence");
assert(roadmap.includes("brokenLegacy: missing command/url"), "roadmap omits MCP config schema hint runtime evidence");
assert(checklist.includes("vscode-workspace-config-agent"), "checklist omits VS Code workspace config agent record");
assert(checklist.includes("VS Code Workspace Config Input"), "checklist omits VS Code workspace config evidence");
assert(checklist.includes("`.vscode/settings.json`, `.vscode/tasks.json`, `.vscode/launch.json`, and `.vscode/extensions.json`"), "checklist omits VS Code workspace config fixture detail evidence");
assert(roadmap.includes("VS Code workspace config input"), "roadmap omits VS Code workspace config evidence");
assert(roadmap.includes("Runtime build task"), "roadmap omits VS Code task fixture evidence");
assert(checklist.includes("js-tooling-config-agent"), "checklist omits JS/TS tooling config agent record");
assert(checklist.includes("JS/TS Tooling Config Input"), "checklist omits JS/TS tooling config evidence");
assert(checklist.includes("`.eslintrc.json`, `.prettierrc.yaml`, `biome.jsonc`, `vitest.config.ts`, and `playwright.config.ts`"), "checklist omits JS/TS tooling config fixture detail evidence");
assert(checklist.includes("markdownlint-config-input-agent"), "checklist omits Markdownlint config input agent record");
assert(checklist.includes("runtime `.markdownlint.json` golden fixture"), "checklist omits Markdownlint config runtime fixture evidence");
assert(checklist.includes("knip-config-input-agent"), "checklist omits Knip config input agent record");
assert(checklist.includes("runtime `knip.jsonc` golden fixture"), "checklist omits Knip config runtime fixture evidence");
assert(roadmap.includes("JS/TS tooling config input"), "roadmap omits JS/TS tooling config evidence");
assert(roadmap.includes("ESLint/Prettier/Biome/Stylelint/Jest/Vitest/Playwright"), "roadmap omits JS/TS tooling config tool coverage");
assert(roadmap.includes("Markdownlint config input"), "roadmap omits Markdownlint config input evidence");
assert(roadmap.includes("Knip config input"), "roadmap omits Knip config input evidence");
assert(checklist.includes("js-workspace-config-input-agent"), "checklist omits JS/TS workspace config agent record");
assert(checklist.includes("JS/TS Monorepo Workspace Config Input"), "checklist omits JS/TS workspace config evidence");
assert(checklist.includes("`pnpm-workspace.yaml` / `pnpm-workspace.yml` / `turbo.json` / `turbo.jsonc` / `nx.json`"), "checklist omits JS/TS workspace config fixture detail evidence");
assert(roadmap.includes("JS/TS monorepo workspace config input"), "roadmap omits JS/TS workspace config evidence");
assert(roadmap.includes("`pnpm-workspace.yaml`") && roadmap.includes("`turbo.json`") && roadmap.includes("`nx.json`"), "roadmap omits JS/TS workspace config coverage");
assert(checklist.includes("iis-web-config-agent"), "checklist omits IIS web.config agent record");
assert(checklist.includes("web-server-config-agent"), "checklist omits Nginx/Apache web server config agent record");
assert(checklist.includes("runtime `nginx.conf` golden fixture"), "checklist omits Nginx web server config runtime fixture evidence");
assert(roadmap.includes("runtime `nginx.conf` golden fixture"), "roadmap omits Nginx web server config runtime fixture evidence");
assert(checklist.includes("runtime `web.config` golden fixture"), "checklist omits IIS web.config runtime fixture evidence");
assert(checklist.includes("runtime `applicationHost.config` golden fixture"), "checklist omits IIS applicationHost.config runtime fixture evidence");
assert(roadmap.includes("IIS web.config file input"), "roadmap omits IIS web.config input evidence");
assert(roadmap.includes("runtime `web.config` golden fixture"), "roadmap omits IIS web.config runtime fixture evidence");
assert(roadmap.includes("runtime `applicationHost.config` golden fixture"), "roadmap omits IIS applicationHost.config runtime fixture evidence");
assert(checklist.includes("coverage-clover-golden-agent"), "checklist omits Clover coverage golden fixture agent record");
assert(checklist.includes("runtime Clover coverage golden fixture"), "checklist omits Clover coverage fixture evidence");
assert(roadmap.includes("runtime Clover coverage golden fixture"), "roadmap omits Clover coverage fixture evidence");
assert(checklist.includes("jacoco-coverage-runtime-agent"), "checklist omits JaCoCo coverage runtime fixture agent record");
assert(checklist.includes("runtime JaCoCo coverage golden fixture"), "checklist omits JaCoCo coverage fixture evidence");
assert(checklist.includes("`jacoco.xml`") && checklist.includes("JaCoCo XML `<report>` / `<counter>`"), "checklist omits JaCoCo fixture detail evidence");
assert(roadmap.includes("runtime JaCoCo coverage golden fixture"), "roadmap omits JaCoCo coverage fixture evidence");
assert(roadmap.includes("`jacoco.xml`") && roadmap.includes("JaCoCo XML `<report>` / `<counter>`"), "roadmap omits JaCoCo fixture detail evidence");
assert(checklist.includes("runtime-scientific-columnar-variant-agent"), "checklist omits runtime scientific/container and Feather variant fixture agent record");
assert(checklist.includes("runtime scientific/container and Feather variant golden fixtures"), "checklist omits runtime scientific/container and Feather variant fixture evidence");
assert(roadmap.includes("runtime scientific/container and Feather variant golden fixtures"), "roadmap omits runtime scientific/container and Feather variant fixture evidence");
assert(checklist.includes("avro-object-container-input-agent"), "checklist omits Avro object container input agent record");
assert(checklist.includes("runtime `runtime.avro` golden fixture"), "checklist omits Avro runtime fixture evidence");
assert(roadmap.includes("Avro object container input"), "roadmap omits Avro object container evidence");
assert(checklist.includes("avro-schema-input-agent"), "checklist omits Avro schema input agent record");
assert(checklist.includes("runtime `runtime.avsc` golden fixture"), "checklist omits Avro schema runtime fixture evidence");
assert(roadmap.includes("Avro schema file input"), "roadmap omits Avro schema evidence");
assert(checklist.includes("json-schema-input-agent"), "checklist omits JSON Schema input agent record");
assert(checklist.includes("runtime `runtime.schema.json` golden fixture"), "checklist omits JSON Schema runtime fixture evidence");
assert(roadmap.includes("JSON Schema file input"), "roadmap omits JSON Schema evidence");
assert(roadmap.includes("runtime `runtime.schema.json`"), "roadmap omits JSON Schema runtime fixture evidence");
assert(checklist.includes("runtime-env-config-golden-agent"), "checklist omits runtime .env config golden fixture agent record");
assert(checklist.includes("runtime .env configuration golden fixture"), "checklist omits runtime .env config fixture evidence");
assert(roadmap.includes("runtime .env configuration golden fixture"), "roadmap omits runtime .env config fixture evidence");
assert(checklist.includes("direnv-envrc-input-agent"), "checklist omits direnv .envrc input agent record");
assert(checklist.includes("runtime `.envrc` golden fixture"), "checklist omits direnv .envrc runtime fixture evidence");
assert(roadmap.includes("direnv .envrc file input"), "roadmap omits direnv .envrc input evidence");
assert(checklist.includes("security-txt-input-agent"), "checklist omits security.txt input agent record");
assert(checklist.includes("Security.txt Policy File Input"), "checklist omits security.txt input evidence");
assert(roadmap.includes("security.txt policy file input"), "roadmap omits security.txt input evidence");
assert(checklist.includes("web-app-association-agent"), "checklist omits web app association input agent record");
assert(checklist.includes("Web App Association File Input"), "checklist omits web app association input evidence");
assert(roadmap.includes("web app association file input"), "roadmap omits web app association input evidence");
assert(checklist.includes("runtime-delimited-data-golden-agent"), "checklist omits runtime delimited data golden fixture agent record");
assert(checklist.includes("runtime CSV/TSV structured data golden fixtures"), "checklist omits runtime delimited data fixture evidence");
assert(roadmap.includes("runtime CSV/TSV structured data golden fixtures"), "roadmap omits runtime delimited data fixture evidence");

const tempRoot = mkdtempSync(join(tmpdir(), "drsai-channel-fixtures-"));
try {
  const workspace = join(tempRoot, "workspace");
  const drsaiDir = join(workspace, ".drsai");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(drsaiDir, { recursive: true });
  const githubDir = join(workspace, ".github");
  const githubWorkflowDir = join(githubDir, "workflows");
  const codeownersPath = join(workspace, "CODEOWNERS");
  const editorconfigPath = join(workspace, ".editorconfig");
  const gitattributesPath = join(workspace, ".gitattributes");
  const gitignorePath = join(workspace, ".gitignore");
  const gitmodulesPath = join(workspace, ".gitmodules");
  const mailmapPath = join(workspace, ".mailmap");
  const licensePath = join(workspace, "LICENSE");
  const noticePath = join(workspace, "NOTICE");
  const dotenvPath = join(workspace, ".env.runtime");
  const envrcPath = join(workspace, ".envrc");
  const regexPatternPath = join(workspace, "runtime.regex");
  const sshDir = join(workspace, ".ssh");
  const sshConfigPath = join(sshDir, "config");
  const knownHostsPath = join(sshDir, "known_hosts");
  const authorizedKeysPath = join(sshDir, "authorized_keys");
  const packagePath = join(workspace, "package.json");
  const yarnrcPath = join(workspace, ".yarnrc.yml");
  const yarnClassicPath = join(workspace, ".yarnrc");
  const pnpmfilePath = join(workspace, ".pnpmfile.cjs");
  const npmignorePath = join(workspace, ".npmignore");
  const commitlintPath = join(workspace, ".commitlintrc.json");
  const lintStagedPath = join(workspace, ".lintstagedrc");
  const mcpServersPath = join(drsaiDir, "mcp-servers.json");
  const packageLockPath = join(workspace, "package-lock.json");
  const pnpmLockPath = join(workspace, "pnpm-lock.yaml");
  const yarnLockPath = join(workspace, "yarn.lock");
  const denoLockPath = join(workspace, "deno.lock");
  const bunLockPath = join(workspace, "bun.lock");
  const cargoLockPath = join(workspace, "Cargo.lock");
  const goSumPath = join(workspace, "go.sum");
  const coveragePath = join(workspace, "coverage.xml");
  const lcovPath = join(workspace, "lcov.info");
  const istanbulCoveragePath = join(workspace, "coverage-final.json");
  const istanbulCoverageSummaryPath = join(workspace, "coverage-summary.json");
  const cloverPath = join(workspace, "clover.xml");
  const jacocoPath = join(workspace, "jacoco.xml");
  const checkstylePath = join(workspace, "runtime.checkstyle.xml");
  const junitPath = join(workspace, "runtime.junit.xml");
  const robotPath = join(workspace, "output.xml");
  const jmeterPlanPath = join(workspace, "runtime.jmx");
  const jmeterXmlPath = join(workspace, "runtime.jmeter.xml");
  const jmeterCsvPath = join(workspace, "runtime.jmeter.csv");
  const nunitPath = join(workspace, "runtime.nunit.xml");
  const xunitPath = join(workspace, "runtime.xunit.xml");
  const trxPath = join(workspace, "runtime.trx");
  const tapPath = join(workspace, "runtime.tap");
  const playwrightJsonPath = join(workspace, "runtime.playwright.json");
  const cypressJsonPath = join(workspace, "runtime.cypress-results.json");
  const mochaJsonPath = join(workspace, "runtime.mocha.json");
  const allureJsonPath = join(workspace, "runtime.allure-result.json");
  const slackExportPath = join(workspace, "slack-export.json");
  const slackCsvExportPath = join(workspace, "slack-export.csv");
  const teamsExportPath = join(workspace, "teams-export.json");
  const discordExportPath = join(workspace, "discord-export.json");
  const chatgptConversationsPath = join(workspace, "chatgpt-conversations.json");
  const claudeConversationsPath = join(workspace, "claude-conversations.json");
  const stylePath = join(workspace, "style.css");
  const metricsPath = join(workspace, "runtime.prom");
  const metricsExtensionPath = join(workspace, "runtime.metrics");
  const openMetricsPath = join(workspace, "runtime.openmetrics");
  const powershellPath = join(workspace, "runtime.ps1");
  const batchPath = join(workspace, "runtime.cmd");
  const hdf5Path = join(workspace, "sample.h5");
  const netcdfPath = join(workspace, "runtime.nc");
  const matPath = join(workspace, "runtime.mat");
  const githubIssueTemplateDir = join(githubDir, "ISSUE_TEMPLATE");
  const githubIssueFormPath = join(githubIssueTemplateDir, "bug_report.yml");
  const githubPullRequestTemplatePath = join(githubDir, "pull_request_template.md");
  const githubActionsPath = join(githubWorkflowDir, "runtime.yml");
  const dependabotPath = join(githubDir, "dependabot.yml");
  const renovatePath = join(workspace, "renovate.json");
  const preCommitPath = join(workspace, ".pre-commit-config.yaml");
  const githubActionsJobSummaryPath = join(workspace, "GITHUB_STEP_SUMMARY.md");
  const gitlabCiPath = join(workspace, ".gitlab-ci.yml");
  const azurePipelinesPath = join(workspace, "azure-pipelines.yml");
  const bitbucketPipelinesPath = join(workspace, "bitbucket-pipelines.yml");
  const circleCiDir = join(workspace, ".circleci");
  const circleCiConfigPath = join(circleCiDir, "config.yml");
  const buildkiteDir = join(workspace, ".buildkite");
  const buildkitePipelinePath = join(buildkiteDir, "pipeline.yml");
  const composePath = join(workspace, "docker-compose.yaml");
  const cmakePath = join(workspace, "CMakeLists.txt");
  const compileCommandsPath = join(workspace, "compile_commands.json");
  const gradlePropertiesPath = join(workspace, "gradle.properties");
  const gradleVersionCatalogPath = join(workspace, "libs.versions.toml");
  const solutionPath = join(workspace, "RuntimeFixture.sln");
  const csprojPath = join(workspace, "RuntimeFixture.csproj");
  const mavenDir = join(workspace, ".mvn");
  const mavenConfigPath = join(mavenDir, "maven.config");
  const jvmConfigPath = join(mavenDir, "jvm.config");
  const mavenUserDir = join(workspace, ".m2");
  const mavenSettingsPath = join(mavenUserDir, "settings.xml");
  const dotnetGlobalPath = join(workspace, "global.json");
  const nugetConfigPath = join(workspace, "nuget.config");
  const packagesConfigPath = join(workspace, "packages.config");
  const nuspecPath = join(workspace, "RuntimeFixture.nuspec");
  const goModPath = join(workspace, "go.mod");
  const requirementsPath = join(workspace, "requirements-dev.txt");
  const constraintsPath = join(workspace, "constraints-runtime.txt");
  const pdfPath = join(workspace, "fixture.pdf");
  const zipPath = join(workspace, "fixture.zip");
  const playwrightTraceZipPath = join(workspace, "trace.zip");
  const vsixPath = join(workspace, "runtime-extension.vsix");
  const crxPath = join(workspace, "runtime-extension.crx");
  const stlPath = join(workspace, "fixture.stl");
  const objPath = join(workspace, "runtime.obj");
  const gltfPath = join(workspace, "runtime.gltf");
  const glbPath = join(workspace, "runtime.glb");
  const cargoPath = join(workspace, "Cargo.toml");
  const bazelBuildPath = join(workspace, "BUILD.bazel");
  const pyprojectPath = join(workspace, "pyproject.toml");
  const pipfilePath = join(workspace, "Pipfile");
  const pythonEnvironmentPath = join(workspace, "environment.yml");
  const uvLockPath = join(workspace, "uv.lock");
  const pypircPath = join(workspace, ".pypirc");
  const pubspecPath = join(workspace, "pubspec.yaml");
  const pubspecLockPath = join(workspace, "pubspec.lock");
  const packageSwiftPath = join(workspace, "Package.swift");
  const podfilePath = join(workspace, "Podfile");
  const podfileLockPath = join(workspace, "Podfile.lock");
  const pbxprojPath = join(workspace, "project.pbxproj");
  const podspecPath = join(workspace, "RuntimeFixture.podspec");
  const composerPath = join(workspace, "composer.json");
  const gemfilePath = join(workspace, "Gemfile");
  const gemspecPath = join(workspace, "runtime_fixture.gemspec");
  const npmrcPath = join(workspace, ".npmrc");
  const mixPath = join(workspace, "mix.exs");
  const stackPath = join(workspace, "stack.yaml");
  const cabalPath = join(workspace, "runtime-fixture.cabal");
  const emlPath = join(workspace, "message.eml");
  const emlxPath = join(workspace, "message.emlx");
  const mboxPath = join(workspace, "mailbox.mbox");
  const telegramExportPath = join(workspace, "telegram-export.json");
  const whatsappExportPath = join(workspace, "whatsapp-chat.txt");
  const meetingTranscriptPath = join(workspace, "zoom-transcript.txt");
  const vcardPath = join(workspace, "contact.vcf");
  const contactsCsvPath = join(workspace, "contacts.csv");
  const icsPath = join(workspace, "calendar.ics");
  const icalPath = join(workspace, "calendar.ical");
  const vcsPath = join(workspace, "calendar.vcs");
  const calendarCsvPath = join(workspace, "calendar-agenda.csv");
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
  const openApiJsonPath = join(workspace, "openapi.json");
  const asyncApiPath = join(workspace, "asyncapi.yaml");
  const asyncApiJsonPath = join(workspace, "asyncapi.json");
  const insomniaPath = join(workspace, "insomnia.json");
  const insomniaYamlPath = join(workspace, "insomnia.yaml");
  const postmanEnvironmentPath = join(workspace, "runtime.postman_environment.json");
  const brunoPath = join(workspace, "runtime.bru");
  const graphqlPath = join(workspace, "schema.graphql");
  const graphqlIntrospectionPath = join(workspace, "schema-introspection.json");
  const pactContractPath = join(workspace, "runtime.pact.json");
  const restClientPath = join(workspace, "runtime.http");
  const restClientRestPath = join(workspace, "runtime.rest");
  const protoPath = join(workspace, "runtime.proto");
  const dockerfilePath = join(workspace, "Dockerfile");
  const wingetManifestPath = join(workspace, "release", "winget", "HepAI.OpenDrSai", "1.4.2", "HepAI.OpenDrSai.installer.yaml");
  const chartPath = join(workspace, "Chart.yaml");
  const helmValuesPath = join(workspace, "values.yaml");
  const kustomizationPath = join(workspace, "kustomization.yaml");
  const kubeDir = join(workspace, ".kube");
  const kubeconfigPath = join(kubeDir, "config");
  const kubernetesManifestPath = join(workspace, "runtime-kubernetes.yaml");
  const iisWebConfigPath = join(workspace, "web.config");
  const iisApplicationHostConfigPath = join(workspace, "applicationHost.config");
  const nginxConfigPath = join(workspace, "nginx.conf");
  const apacheVhostConfigPath = join(workspace, "runtime.vhost.conf");
  const htaccessConfigPath = join(workspace, ".htaccess");
  const sarifPath = join(workspace, "results.sarif");
  const sarifJsonPath = join(workspace, "results.sarif.json");
  const securityAuditPath = join(workspace, "npm-audit.json");
  const cyclonedxPath = join(workspace, "cyclonedx.json");
  const spdxPath = join(workspace, "runtime.spdx");
  const syftPath = join(workspace, "syft.json");
  const pemPath = join(workspace, "runtime.crt");
  const keepassPath = join(workspace, "runtime.kdbx");
  const checksumPath = join(workspace, "checksums.sha256");
  const wasmPath = join(workspace, "runtime.wasm");
  const exePath = join(workspace, "runtime.exe");
  const jarPath = join(workspace, "runtime.jar");
  const classPath = join(workspace, "RuntimeFixture.class");
  const jfrPath = join(workspace, "runtime.jfr");
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
  const graphmlPath = join(workspace, "runtime.graphml");
  const scssPath = join(workspace, "runtime.scss");
  const msgPath = join(workspace, "runtime.msg");
  const lnkPath = join(workspace, "runtime.lnk");
  const rdpPath = join(workspace, "runtime.rdp");
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
  const prismaPath = join(workspace, "schema.prisma");
  const dbmlPath = join(workspace, "runtime.dbml");
  const jsonSchemaPath = join(workspace, "runtime.schema.json");
  const redisRdbPath = join(workspace, "dump.rdb");
  const redisAofPath = join(workspace, "appendonly.aof");
  const systemdServicePath = join(workspace, "runtime.service");
  const cronSchedulePath = join(workspace, "runtime.crontab");
  const supervisorConfigPath = join(workspace, "runtime.supervisord.conf");
  const hostsPath = join(workspace, "runtime.hosts");
  const wireguardConfigPath = join(workspace, "wg0.conf");
  const openVpnConfigPath = join(workspace, "client.ovpn");
  const csvPath = join(workspace, "runtime.csv");
  const tsvPath = join(workspace, "runtime.tsv");
  const jsonlPath = join(workspace, "events.jsonl");
  const terminalRecordingPath = join(workspace, "runtime.cast");
  const powershellTranscriptPath = join(workspace, "runtime.powershell-transcript.txt");
  const logMonitorConfigPath = join(drsaiDir, "log-monitor.json");
  const logMonitorRuntimePath = join(workspace, "runtime-monitor.log");
  const harPath = join(workspace, "runtime.har");
  const netlogPath = join(workspace, "netlog.json");
  const otelPath = join(workspace, "runtime.otlp.json");
  const devtoolsTracePath = join(workspace, "runtime.trace.json");
  const cpuProfilePath = join(workspace, "runtime.cpuprofile");
  const heapSnapshotPath = join(workspace, "runtime.heapsnapshot");
  const lighthousePath = join(workspace, "runtime.lighthouse.json");
  const pcapPath = join(workspace, "runtime.pcap");
  const pcapngPath = join(workspace, "runtime.pcapng");
  const notebookPath = join(workspace, "runtime.ipynb");
  const parquetPath = join(workspace, "runtime.parquet");
  const arrowPath = join(workspace, "runtime.arrow");
  const featherPath = join(workspace, "runtime.feather");
  const avroPath = join(workspace, "runtime.avro");
  const avroSchemaPath = join(workspace, "runtime.avsc");
  const epubPath = join(workspace, "runtime.epub");
  const ttfPath = join(workspace, "runtime.ttf");
  const woffPath = join(workspace, "runtime.woff");
  const woff2Path = join(workspace, "runtime.woff2");
  const bookmarksPath = join(workspace, "bookmarks.html");
  const bookmarksJsonPath = join(workspace, "bookmarks.json");
  const urlShortcutPath = join(workspace, "runtime.url");
  const weblocPath = join(workspace, "runtime.webloc");
  const desktopEntryPath = join(workspace, "runtime.desktop");
  const rssPath = join(workspace, "feed.rss");
  const atomPath = join(workspace, "feed.atom");
  const jsonFeedPath = join(workspace, "feed.json");
  const sourceMapPath = join(workspace, "runtime.js.map");
  const lottieAnimationPath = join(workspace, "animation.json");
  const dotLottiePath = join(workspace, "runtime.lottie");
  const opmlPath = join(workspace, "subscriptions.opml");
  const robotsPath = join(workspace, "robots.txt");
  const securityTxtPath = join(workspace, "security.txt");
  const assetLinksPath = join(workspace, "assetlinks.json");
  const appleAssociationPath = join(workspace, "apple-app-site-association");
  const llmsPath = join(workspace, "llms.txt");
  const warcPath = join(workspace, "runtime.warc");
  const warcGzipPath = join(workspace, "runtime.warc.gz");
  const browserCookiesPath = join(workspace, "cookies.txt");
  const hyphenatedBrowserCookiesPath = join(workspace, "runtime-cookies.txt");
  const browserPasswordsPath = join(workspace, "chrome-passwords.csv");
  const browserAutofillCsvPath = join(workspace, "autofill.csv");
  const browserAutofillJsonPath = join(workspace, "runtime-autofill.json");
  const browserHistoryCsvPath = join(workspace, "history.csv");
  const browserHistoryJsonPath = join(workspace, "runtime-history.json");
  const browserHistorySqlitePath = join(workspace, "History");
  const browserDownloadsCsvPath = join(workspace, "downloads.csv");
  const browserDownloadsJsonPath = join(workspace, "runtime-downloads.json");
  const browserDownloadsSqlitePath = join(workspace, "Downloads");
  const browserPreferencesPath = join(workspace, "Preferences");
  const browserLocalStoragePath = join(workspace, "local-storage.json");
  const browserSessionStoragePath = join(workspace, "runtime-session-storage.json");
  const browserSessionTabsPath = join(workspace, "tabs.json");
  const sitemapPath = join(workspace, "sitemap.xml");
  const sitemapGzipPath = join(workspace, "sitemap.xml.gz");
  const pwaManifestPath = join(workspace, "site.webmanifest");
  const browserExtensionManifestPath = join(workspace, "extension-manifest.json");
  const browserExtensionInventoryPath = join(workspace, "browser-extensions.json");
  const pwaServiceWorkerPath = join(workspace, "service-worker.js");
  const srtPath = join(workspace, "captions.srt");
  const vttPath = join(workspace, "captions.vtt");
  const androidManifestPath = join(workspace, "AndroidManifest.xml");
  const androidValuesDir = join(workspace, "app", "src", "main", "res", "values");
  const androidXmlDir = join(workspace, "app", "src", "main", "res", "xml");
  const androidStringsPath = join(androidValuesDir, "strings.xml");
  const androidNetworkSecurityPath = join(androidXmlDir, "network_security_config.xml");
  const androidLogcatPath = join(workspace, "runtime.logcat");
  const appleUnifiedLogPath = join(workspace, "system.log");
  const infoPlistPath = join(workspace, "Info.plist");
  const appleCrashPath = join(workspace, "runtime.crash");
  const appleIpsPath = join(workspace, "runtime.ips");
  const apkPath = join(workspace, "runtime.apk");
  const aabPath = join(workspace, "runtime.aab");
  const ipaPath = join(workspace, "runtime.ipa");
  const wavPath = join(workspace, "runtime.wav");
  const mp3Path = join(workspace, "runtime.mp3");
  const aacPath = join(workspace, "runtime.aac");
  const flacPath = join(workspace, "runtime.flac");
  const m4aPath = join(workspace, "runtime.m4a");
  const oggPath = join(workspace, "runtime.ogg");
  const pngColorPath = join(workspace, "runtime-color.png");
  const jpegColorPath = join(workspace, "runtime-color.jpg");
  const gifAnimationPath = join(workspace, "runtime-animated.gif");
  const webpAnimationPath = join(workspace, "runtime-animated.webp");
  const svgStructurePath = join(workspace, "runtime.svg");
  const texPath = join(workspace, "paper.tex");
  const bibPath = join(workspace, "references.bib");
  const latexmkrcPath = join(workspace, "latexmkrc");
  const devcontainerDir = join(workspace, ".devcontainer");
  const devcontainerPath = join(devcontainerDir, "devcontainer.json");
  const vscodeDir = join(workspace, ".vscode");
  const vscodeSettingsPath = join(vscodeDir, "settings.json");
  const vscodeTasksPath = join(vscodeDir, "tasks.json");
  const vscodeLaunchPath = join(vscodeDir, "launch.json");
  const vscodeExtensionsPath = join(vscodeDir, "extensions.json");
  const eslintConfigPath = join(workspace, ".eslintrc.json");
  const prettierConfigPath = join(workspace, ".prettierrc.yaml");
  const biomeConfigPath = join(workspace, "biome.jsonc");
  const cspellConfigPath = join(workspace, "cspell.jsonc");
  const markdownlintConfigPath = join(workspace, ".markdownlint.json");
  const typedocConfigPath = join(workspace, "typedoc.json");
  const knipConfigPath = join(workspace, "knip.jsonc");
  const ruffConfigPath = join(workspace, ".ruff.toml");
  const pyprojectRuffDir = join(workspace, "pyproject-ruff");
  const pyprojectRuffConfigPath = join(pyprojectRuffDir, "pyproject.toml");
  const vitestConfigPath = join(workspace, "vitest.config.ts");
  const playwrightConfigPath = join(workspace, "playwright.config.ts");
  const viteConfigPath = join(workspace, "vite.config.ts");
  const rollupConfigPath = join(workspace, "rollup.config.mjs");
  const tsupConfigPath = join(workspace, "tsup.config.ts");
  const pnpmWorkspacePath = join(workspace, "pnpm-workspace.yaml");
  const turboConfigPath = join(workspace, "turbo.json");
  const nxConfigPath = join(workspace, "nx.json");

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
  writeText(gitmodulesPath, [
    '[submodule "runtime-tools"]',
    "  path = vendor/runtime-tools",
    "  url = https://example.test/opendrsai/runtime-tools.git?token=secret-gitmodules-token",
    "  branch = main",
    "  update = checkout",
    "  shallow = true",
  ].join("\n"));
  writeText(mailmapPath, [
    "Runtime Canonical <canonical@example.test> Runtime Alias <alias@example.test>",
    "Release Engineer <release@example.test> <old-release@example.test>",
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
    "export DERIVED_URL=${PUBLIC_URL}/v1",
    "DUPLICATE_KEY=first",
    "DUPLICATE_KEY=second",
  ].join("\n"));
  writeText(envrcPath, [
    "export RUNTIME_ENV=dev",
    "export API_TOKEN=secret-envrc-token",
    "dotenv .env.runtime",
    "dotenv_if_exists .env.local",
    "use node 22",
    "layout python .venv",
    "watch_file pyproject.toml",
    "source_env .env.shared",
    "curl https://example.test/bootstrap.sh?token=secret-envrc-query",
  ].join("\n"));
  writeText(regexPatternPath, [
    "# Runtime regex handoff fixture",
    "pattern: /(?<level>ERROR|WARN)\\s+\\[(?<component>[A-Za-z0-9_.-]+)\\].*(token=secret-regex-token)/gi",
    "replace: level=$<level> component=$<component> token=[redacted]",
    "target: runtime.log",
    "(?<=user=)[A-Za-z0-9_.-]+",
    "^(?:.+)+$",
  ].join("\n"));
  mkdirSync(sshDir, { recursive: true });
  writeText(sshConfigPath, [
    "Host runtime-prod runtime-alias",
    "  HostName runtime.example.test",
    "  User runtime-user",
    "  Port 2222",
    "  IdentityFile ~/.ssh/id_runtime_secret",
    "  ProxyJump bastion.example.test",
    "  Include ./secret-ssh-include.conf",
    "Host risky",
    "  HostName risky.example.test?token=secret-ssh-token",
    "  ProxyCommand ssh jump.example.test nc %h %p",
  ].join("\n"));
  writeText(knownHostsPath, [
    "runtime.example.test,192.0.2.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIsecretKnownHostMaterial Runtime host",
    "|1|hashedSalt|hashedHost ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQSecretKnownHostHash",
  ].join("\n"));
  writeText(authorizedKeysPath, [
    'from="10.0.0.0/8",command="/usr/local/bin/runtime --token=secret-authorized-command" ssh-ed25519 AAAAC3NzaAuthorizedSecretMaterial runtime deploy key',
    "restrict,no-pty ssh-rsa AAAAB3NzaAuthorizedSecretMaterial2 runtime readonly key",
  ].join("\n"));
  writeText(hostsPath, [
    "# Runtime development overrides token=secret-hosts-comment-token",
    "127.0.0.1 localhost runtime.local",
    "127.0.0.1 api.runtime.example.test # local API override",
    "0.0.0.0 ads.runtime.example.test tracker.runtime.example.test",
    "::1 ipv6-runtime.local",
    "192.0.2.10 docs.runtime.example.test runtime-token-secret.example.test",
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
  writeText(commitlintPath, JSON.stringify({
    extends: ["@commitlint/config-conventional"],
    parserPreset: "conventional-changelog-conventionalcommits",
    defaultIgnores: true,
    helpUrl: "https://commitlint.example.test/help?token=secret-commitlint-help-token",
    rules: {
      "type-enum": [2, "always", ["feat", "fix", "docs"]],
      "scope-empty": [2, "never"],
      "secret-rule-token": "secret-commitlint-rule-token",
    },
  }, null, 2));
  writeText(lintStagedPath, JSON.stringify({
    concurrent: false,
    relative: true,
    shell: "powershell.exe",
    "*.ts": "eslint --fix --token=secret-lint-staged-eslint-token",
    "*.md": ["prettier --write"],
  }, null, 2));
  mkdirSync(drsaiDir, { recursive: true });
  writeText(mcpServersPath, JSON.stringify({
    mcpServers: {
      filesystem: {
        command: "node",
        args: ["./tools/filesystem-mcp.js", "--workspace", "."],
        env: {
          MCP_API_TOKEN: "secret-mcp-token",
          SAFE_MODE: "review",
        },
      },
      remoteDocs: {
        transport: "sse",
        url: "https://mcp.example.test/sse?token=secret-mcp-url-token",
        disabled: true,
      },
      brokenLegacy: {
        args: "--workspace .",
        env: "SECRET=secret-mcp-inline",
        transport: "named-pipe",
        disabled: "no",
      },
    },
  }, null, 2));
  mkdirSync(devcontainerDir, { recursive: true });
  mkdirSync(androidValuesDir, { recursive: true });
  mkdirSync(androidXmlDir, { recursive: true });
  writeText(devcontainerPath, JSON.stringify({
    name: "Runtime Dev Container",
    image: "mcr.microsoft.com/devcontainers/typescript-node:22",
    dockerComposeFile: ["../docker-compose.yml"],
    service: "app",
    workspaceFolder: "/workspaces/drsai",
    features: {
      "ghcr.io/devcontainers/features/node:1": { version: "22" },
      "ghcr.io/devcontainers/features/github-cli:1": {},
    },
    forwardPorts: [3000, "5173"],
    portsAttributes: {
      "9229": { label: "node-debug" },
    },
    containerEnv: {
      RUNTIME_TOKEN: "secret-devcontainer-token",
    },
    remoteEnv: {
      OPENAI_API_KEY: "secret-devcontainer-api-key",
    },
    customizations: {
      vscode: {
        extensions: ["ms-vscode.vscode-typescript-next", "GitHub.copilot"],
      },
    },
    postCreateCommand: "npm install && curl https://example.test/setup.sh?token=secret-devcontainer-token",
  }, null, 2));
  mkdirSync(vscodeDir, { recursive: true });
  writeText(vscodeSettingsPath, [
    "{",
    "  // Runtime fixture uses JSONC comments.",
    "  \"editor.formatOnSave\": true,",
    "  \"python.defaultInterpreterPath\": \"${workspaceFolder}/.venv/Scripts/python.exe\",",
    "  \"terminal.integrated.env.windows\": {",
    "    \"API_TOKEN\": \"secret-vscode-settings-token\"",
    "  },",
    "}",
  ].join("\n"));
  writeText(vscodeTasksPath, JSON.stringify({
    version: "2.0.0",
    tasks: [
      {
        label: "Runtime build task",
        type: "shell",
        command: "npm run build -- --token=secret-vscode-task-token",
        problemMatcher: "$tsc",
      },
    ],
    inputs: [
      {
        id: "runtimeTarget",
        type: "pickString",
        options: ["desktop", "backend"],
      },
    ],
  }, null, 2));
  writeText(vscodeLaunchPath, JSON.stringify({
    version: "0.2.0",
    configurations: [
      {
        name: "Runtime renderer debug",
        type: "node",
        request: "launch",
        program: "${workspaceFolder}/apps/desktop/windows/src/main/index.ts",
      },
    ],
  }, null, 2));
  writeText(vscodeExtensionsPath, JSON.stringify({
    recommendations: [
      "ms-vscode.vscode-typescript-next",
      "dbaeumer.vscode-eslint",
    ],
    unwantedRecommendations: [
      "runtime.secret-extension-token",
    ],
  }, null, 2));
  writeText(eslintConfigPath, JSON.stringify({
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
    plugins: ["@typescript-eslint", "react-hooks"],
    parserOptions: {
      project: "./tsconfig.json",
      ecmaVersion: 2024,
    },
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "runtime/secret-token": "secret-eslint-token",
    },
    ignorePatterns: ["release/**"],
  }, null, 2));
  writeText(prettierConfigPath, [
    "printWidth: 100",
    "singleQuote: true",
    "semi: false",
    "plugins:",
    "  - prettier-plugin-tailwindcss",
    "runtimeToken: secret-prettier-token",
  ].join("\n"));
  writeText(biomeConfigPath, [
    "{",
    "  // Runtime fixture JSONC.",
    "  \"formatter\": { \"enabled\": true, \"indentStyle\": \"space\" },",
    "  \"linter\": { \"enabled\": true, \"rules\": { \"suspicious\": { \"noDebugger\": \"error\" } } },",
    "  \"javascript\": { \"formatter\": { \"quoteStyle\": \"single\" } },",
    "  \"runtimeToken\": \"secret-biome-token\"",
    "}",
  ].join("\n"));
  writeText(cspellConfigPath, [
    "{",
    "  // Runtime fixture spell-check config.",
    "  \"version\": \"0.2\",",
    "  \"language\": \"en,zh-CN\",",
    "  \"words\": [\"OpenDrSai\", \"HepAI\", \"runtimeword\"],",
    "  \"ignoreWords\": [\"fixtureignore\"],",
    "  \"dictionaries\": [\"typescript\", \"softwareTerms\"],",
    "  \"ignorePaths\": [\"release/**\", \"private-dictionaries/**\"],",
    "  \"runtimeToken\": \"secret-cspell-token\"",
    "}",
  ].join("\n"));
  writeText(markdownlintConfigPath, JSON.stringify({
    default: true,
    MD013: { line_length: 120, tables: false },
    MD033: { allowed_elements: ["kbd", "details"] },
    globs: ["docs/**/*.md", "apps/**/*.md"],
    ignores: ["release/**"],
    runtimeToken: "secret-markdownlint-token",
  }, null, 2));
  writeText(typedocConfigPath, JSON.stringify({
    entryPoints: ["src/index.ts", "src/public-api.ts"],
    out: "docs/api",
    plugin: ["typedoc-plugin-markdown"],
    theme: "default",
    readme: "README.md",
    tsconfig: "tsconfig.json",
    exclude: ["**/*.spec.ts"],
    excludePrivate: true,
    runtimeToken: "secret-typedoc-token",
  }, null, 2));
  writeText(knipConfigPath, [
    "{",
    "  // Runtime fixture unused-code config.",
    "  \"entry\": [\"src/index.ts\", \"scripts/runtime.ts?token=secret-knip-entry-token\"],",
    "  \"project\": [\"src/**/*.ts\", \"tests/**/*.ts\"],",
    "  \"ignore\": [\"generated/**\", \"fixtures/**\"],",
    "  \"ignoreDependencies\": [\"@types/node\", \"internal-runtime-helper\"],",
    "  \"ignoreBinaries\": [\"electron-builder\"],",
    "  \"include\": [\"dependencies\", \"exports\"],",
    "  \"workspaces\": { \"apps/*\": { \"entry\": [\"src/main.ts\"] } }",
    "}",
  ].join("\n"));
  writeText(ruffConfigPath, [
    "target-version = \"py311\"",
    "line-length = 100",
    "preview = true",
    "exclude = [\"build/**\", \"release/**\"]",
    "runtime-token = \"secret-ruff-token\"",
    "",
    "[lint]",
    "select = [\"E\", \"F\", \"I\"]",
    "extend-select = [\"B\", \"UP\"]",
    "ignore = [\"E501\"]",
    "",
    "[lint.per-file-ignores]",
    "\"tests/**\" = [\"S101\"]",
  ].join("\n"));
  mkdirSync(pyprojectRuffDir, { recursive: true });
  writeText(pyprojectRuffConfigPath, [
    "[build-system]",
    "requires = [\"hatchling\"]",
    "",
    "[project]",
    "name = \"runtime-pyproject-ruff-fixture\"",
    "",
    "[tool.ruff]",
    "target-version = \"py312\"",
    "line-length = 88",
    "exclude = [\"dist/**\", \"generated/**\"]",
    "preview = true",
    "",
    "[tool.ruff.lint]",
    "select = [\"E\", \"F\", \"I\", \"UP\"]",
    "ignore = [\"E203\"]",
    "",
    "[tool.ruff.lint.per-file-ignores]",
    "\"scripts/**\" = [\"T201\"]",
    "runtime-token = \"secret-pyproject-ruff-token\"",
  ].join("\n"));
  writeText(vitestConfigPath, [
    "import { defineConfig } from 'vitest/config';",
    "export default defineConfig({",
    "  test: {",
    "    environment: 'jsdom',",
    "    setupFiles: ['./tests/setup.ts'],",
    "    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },",
    "    apiToken: process.env.SECRET_VITEST_TOKEN,",
    "  },",
    "});",
  ].join("\n"));
  writeText(playwrightConfigPath, [
    "import { defineConfig, devices } from '@playwright/test';",
    "export default defineConfig({",
    "  testDir: './e2e',",
    "  retries: 1,",
    "  webServer: { command: 'npm run dev -- --token=secret-playwright-token', url: 'http://127.0.0.1:5173' },",
    "  use: { baseURL: 'https://example.test?token=secret-playwright-token', trace: 'on-first-retry', screenshot: 'only-on-failure' },",
    "  projects: [",
    "    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },",
    "    { name: 'webkit', use: { ...devices['Desktop Safari'] } },",
    "  ],",
    "});",
  ].join("\n"));
  writeText(viteConfigPath, [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    "export default defineConfig({",
    "  base: '/desktop/',",
    "  plugins: [react()],",
    "  server: { port: 5173, host: '127.0.0.1' },",
    "  preview: { port: 4173 },",
    "  build: { outDir: 'dist', sourcemap: true, rollupOptions: { input: 'src/main.ts' } },",
    "  runtimeToken: 'secret-vite-token',",
    "});",
  ].join("\n"));
  writeText(rollupConfigPath, [
    "import terser from '@rollup/plugin-terser';",
    "export default {",
    "  input: 'src/index.ts',",
    "  external: ['react'],",
    "  output: { file: 'dist/index.js', format: 'esm', sourcemap: true },",
    "  plugins: [terser({ mangle: false })],",
    "  runtimeToken: 'secret-rollup-token',",
    "};",
  ].join("\n"));
  writeText(tsupConfigPath, [
    "import { defineConfig } from 'tsup';",
    "export default defineConfig({",
    "  entry: ['src/index.ts', 'src/cli.ts'],",
    "  format: ['esm', 'cjs'],",
    "  target: 'node22',",
    "  dts: true,",
    "  outDir: 'dist',",
    "  sourcemap: true,",
    "  clean: true,",
    "  env: { API_TOKEN: 'secret-tsup-token' },",
    "});",
  ].join("\n"));
  writeText(pnpmWorkspacePath, [
    "packages:",
    "  - apps/*",
    "  - packages/*",
    "catalog:",
    "  react: 19.2.1",
    "onlyBuiltDependencies:",
    "  - esbuild",
    "runtimeToken: secret-pnpm-workspace-token",
  ].join("\n"));
  writeText(turboConfigPath, JSON.stringify({
    "$schema": "https://turbo.build/schema.json",
    globalDependencies: ["**/.env.local"],
    remoteCache: { teamId: "team_runtime", token: "secret-turbo-token" },
    tasks: {
      build: { dependsOn: ["^build"], outputs: ["dist/**"] },
      test: { dependsOn: ["build"], outputs: ["coverage/**"], cache: true },
    },
  }, null, 2));
  writeText(nxConfigPath, JSON.stringify({
    npmScope: "runtime",
    affected: { defaultBase: "main" },
    namedInputs: {
      default: ["{projectRoot}/**/*"],
      production: ["default", "!{projectRoot}/**/*.spec.ts"],
    },
    targetDefaults: {
      build: { dependsOn: ["^build"], outputs: ["{projectRoot}/dist"] },
      test: { inputs: ["default", "^production"] },
    },
    plugins: ["@nx/vite/plugin"],
    accessToken: "secret-nx-token",
  }, null, 2));
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
  writeText(denoLockPath, JSON.stringify({
    version: "3",
    remote: {
      "https://deno.land/std@0.224.0/assert/mod.ts": "sha256-runtime-deno-assert",
    },
    npm: {
      specifiers: {
        "npm:chalk@^5.3.0": "chalk@5.3.0",
      },
      packages: {
        "chalk@5.3.0": {
          integrity: "sha512-runtime-chalk",
          dependencies: {
            "ansi-styles": "ansi-styles@6.2.1",
          },
        },
        "ansi-styles@6.2.1": {
          integrity: "sha512-runtime-ansi",
        },
      },
    },
  }, null, 2));
  writeText(bunLockPath, JSON.stringify({
    lockfileVersion: 1,
    workspaces: {
      "": {
        dependencies: {
          react: "^19.2.1",
        },
        devDependencies: {
          "runtime-bun-tool": "1.0.0",
        },
      },
    },
    packages: {
      react: ["react@19.2.1", "", { dependencies: { scheduler: "^0.27.0" } }, "sha512-runtime-react"],
      scheduler: ["scheduler@0.27.0", "", {}, "sha512-runtime-scheduler"],
      "runtime-bun-tool": ["runtime-bun-tool@1.0.0", "", {}, "sha512-runtime-tool"],
    },
  }, null, 2));
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
    '  <packages><package name="core"><classes>',
    '    <class filename="src/app.ts"><lines>',
    '      <line number="1" hits="1" branch="false" />',
    '      <line number="2" hits="1" branch="true" condition-coverage="50% (1/2)" />',
    '      <line number="3" hits="1" branch="false" />',
    '    </lines></class>',
    '    <class filename="src/secret-token-app.ts"><lines>',
    '      <line number="4" hits="0" branch="false" />',
    '    </lines></class>',
    '  </classes></package></packages>',
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
  writeText(istanbulCoveragePath, JSON.stringify({
    "src/chatbar/istanbul.ts": {
      path: "src/chatbar/istanbul.ts",
      s: { 0: 1, 1: 0, 2: 1 },
      b: { 0: [1, 0], 1: [1, 1] },
    },
    "src/chatbar/secret-token-coverage.ts": {
      path: "src/chatbar/secret-token-coverage.ts",
      s: { 0: 0 },
      b: {},
    },
  }, null, 2));
  writeText(istanbulCoverageSummaryPath, JSON.stringify({
    total: {
      lines: { total: 8, covered: 6, skipped: 0, pct: 75 },
      branches: { total: 5, covered: 3, skipped: 0, pct: 60 },
      statements: { total: 8, covered: 6, skipped: 0, pct: 75 },
      functions: { total: 3, covered: 2, skipped: 0, pct: 66.66 },
    },
    "src/chatbar/summary.ts": {
      lines: { total: 5, covered: 4, skipped: 0, pct: 80 },
      branches: { total: 3, covered: 2, skipped: 0, pct: 66.66 },
      statements: { total: 5, covered: 4, skipped: 0, pct: 80 },
      functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
    },
    "src/chatbar/secret-token-summary.ts": {
      lines: { total: 3, covered: 2, skipped: 0, pct: 66.66 },
      branches: { total: 2, covered: 1, skipped: 0, pct: 50 },
      statements: { total: 3, covered: 2, skipped: 0, pct: 66.66 },
      functions: { total: 1, covered: 0, skipped: 0, pct: 0 },
    },
  }, null, 2));
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
  writeText(jacocoPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<report name="jacoco-runtime-fixture">',
    '  <package name="chatbar/runtime">',
    '    <sourcefile name="RuntimeCoverage.java">',
    '      <counter type="LINE" missed="3" covered="9"/>',
      '      <counter type="BRANCH" missed="1" covered="3"/>',
    "    </sourcefile>",
    '    <sourcefile name="secret-token-coverage.java">',
    '      <counter type="LINE" missed="1" covered="1"/>',
    "    </sourcefile>",
    "  </package>",
    '  <counter type="LINE" missed="3" covered="9"/>',
    '  <counter type="BRANCH" missed="1" covered="3"/>',
    "</report>",
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
    '    <properties>',
    '      <property name="browser" value="chromium" />',
    '      <property name="api.token" value="secret-junit-token" />',
    '    </properties>',
    '    <testcase classname="RuntimeFixture" name="passes" time="1.00" />',
    '    <testcase classname="RuntimeFixture" name="fails" time="2.00"><failure message="expected runtime value">Assertion failed</failure><system-out>[[ATTACHMENT|artifacts/runtime-failure.png]]&#10;artifact: artifacts/secret-token-trace.zip</system-out></testcase>',
    '    <testcase classname="RuntimeFixture" name="skips" time="0.00"><skipped /></testcase>',
    "  </testsuite>",
    "</testsuites>",
  ].join("\n"));
  writeText(robotPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<robot generator="Robot 7.1" generated="2026-07-13T09:00:00Z">',
    '  <suite name="Runtime Robot Suite" source="tests/robot/runtime.robot">',
    '    <test name="Runtime Robot Pass"><tag>smoke</tag><kw name="Open Runtime Chat" owner="Browser"><status status="PASS" elapsedtime="1200" /></kw><status status="PASS" elapsedtime="1500" /></test>',
    '    <test name="Runtime Robot Fail"><tag>api</tag><kw name="Call Provider API"><status status="FAIL" elapsedtime="900">Keyword token=secret-robot-keyword-token</status></kw><status status="FAIL" elapsedtime="2100">Robot assertion token=secret-robot-token</status></test>',
    '    <test name="Runtime Robot Skip"><tag>quarantine</tag><status status="SKIP" elapsedtime="0">Skipped by fixture</status></test>',
    '  </suite>',
    '  <statistics><total><stat pass="1" fail="1" skip="1">All Tests</stat></total></statistics>',
    '</robot>',
  ].join("\n"));
  writeText(jmeterXmlPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testResults version="1.2">',
    '  <httpSample t="120" lt="80" ts="1783677600000" s="true" lb="GET /chat" rc="200" rm="OK" tn="Runtime JMeter Thread Group 1-1" />',
    '  <httpSample t="345" lt="300" ts="1783677601000" s="false" lb="POST /provider" rc="500" rm="JMeter failure token=secret-jmeter-token" tn="Runtime JMeter Thread Group 1-1"><assertionResult><name>Runtime provider SLA</name><failure>true</failure><failureMessage>JMeter assertion token=secret-jmeter-assertion</failureMessage></assertionResult><responseData>Runtime response body token=secret-jmeter-response</responseData></httpSample>',
    "  <sample t=\"90\" ts=\"1783677602000\" s=\"true\" lb=\"Local queue drain\" rc=\"200\" rm=\"OK\" tn=\"Runtime JMeter Thread Group 1-2\" />",
    "</testResults>",
  ].join("\n"));
  writeText(jmeterPlanPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">',
    '  <hashTree>',
    '    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Runtime JMeter Plan" enabled="true">',
    '      <stringProp name="TestPlan.comments">token=secret-jmx-comment-token</stringProp>',
    '      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments">',
    '        <collectionProp name="Arguments.arguments">',
    '          <elementProp name="baseUrl" elementType="Argument"><stringProp name="Argument.name">baseUrl</stringProp><stringProp name="Argument.value">https://runtime.example.test?token=secret-jmx-base-token</stringProp></elementProp>',
    '          <elementProp name="authToken" elementType="Argument"><stringProp name="Argument.name">authToken</stringProp><stringProp name="Argument.value">secret-jmx-auth-token</stringProp></elementProp>',
    '        </collectionProp>',
    '      </elementProp>',
    '    </TestPlan>',
    '    <hashTree>',
    '      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Runtime Thread Group" enabled="true" />',
    '      <hashTree>',
    '        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Runtime GET /chat" enabled="true" />',
    '        <hashTree><ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Runtime status assertion" enabled="true" /></hashTree>',
    '        <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Runtime Headers" enabled="true"><collectionProp name="HeaderManager.headers"><elementProp name="Authorization" elementType="Header"><stringProp name="Header.name">Authorization</stringProp><stringProp name="Header.value">Bearer secret-jmx-header-token</stringProp></elementProp></collectionProp></HeaderManager>',
    '        <ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Runtime pacing timer" enabled="true" />',
    '      </hashTree>',
    '    </hashTree>',
    '  </hashTree>',
    '</jmeterTestPlan>',
  ].join("\n"));
  writeText(jmeterCsvPath, [
    "timeStamp,elapsed,label,responseCode,responseMessage,success,threadName,assertionFailureMessage",
    "1783677600000,100,CSV GET /chat,200,OK,true,Runtime JMeter CSV Thread Group,",
    "1783677601000,280,CSV POST /provider,503,CSV failure token=secret-jmeter-csv-token,false,Runtime JMeter CSV Thread Group,CSV assertion token=secret-jmeter-csv-assertion",
    "1783677602000,75,CSV local queue,200,OK,true,Runtime JMeter CSV Thread Group,",
  ].join("\n"));
  writeText(nunitPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<test-run id="2" testcasecount="3" result="Failed" total="3" passed="1" failed="1" skipped="1" duration="5.50">',
    '  <properties><property name="target.framework" value="net8.0" /><property name="api.token" value="secret-nunit-property" /></properties>',
    '  <test-suite type="Assembly" name="Runtime.NUnit.dll" fullname="Runtime.NUnit">',
    '    <test-case name="RuntimeNUnitPass" fullname="Runtime.NUnit.RuntimeNUnitPass" result="Passed" duration="1.00" />',
    '    <test-case name="RuntimeNUnitFail" fullname="Runtime.NUnit.RuntimeNUnitFail" result="Failed" duration="3.00"><failure><message>NUnit runtime failure token=secret-nunit-token</message></failure><output>artifact: artifacts/secret-nunit-token.log</output></test-case>',
    '    <test-case name="RuntimeNUnitSkip" fullname="Runtime.NUnit.RuntimeNUnitSkip" result="Skipped" duration="0.00" />',
    "  </test-suite>",
    "</test-run>",
  ].join("\n"));
  writeText(xunitPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<assemblies>",
    '  <assembly name="Runtime.Xunit.dll" total="3" passed="1" failed="1" skipped="1" time="6.25">',
    '    <collection name="Runtime xUnit Collection" total="3" passed="1" failed="1" skipped="1" time="6.25">',
    '      <property name="runtime" value="win11" /><property name="api.token" value="secret-xunit-property" />',
      '      <test name="RuntimeXunitPass" type="Runtime.Xunit" method="RuntimeXunitPass" result="Pass" time="1.00" />',
      '      <test name="RuntimeXunitFail" type="Runtime.Xunit" method="RuntimeXunitFail" result="Fail" time="4.00"><failure><message>xUnit runtime failure token=secret-xunit-token</message></failure><output>[[ATTACHMENT|artifacts/secret-xunit-token.zip]]</output></test>',
      '      <test name="RuntimeXunitSkip" type="Runtime.Xunit" method="RuntimeXunitSkip" result="Skip" time="0.00" />',
    "    </collection>",
    "  </assembly>",
    "</assemblies>",
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
  writeText(cypressJsonPath, JSON.stringify({
    totalTests: 4,
    totalPassed: 2,
    totalFailed: 1,
    totalPending: 1,
    totalSkipped: 0,
    totalDuration: 4123,
    runs: [
      {
        spec: { relative: "cypress/e2e/runtime.cy.ts", name: "runtime.cy.ts" },
        stats: { tests: 4, passes: 2, failures: 1, pending: 1, skipped: 0, wallClockDuration: 4123 },
        tests: [
          { title: ["Runtime Cypress Suite", "renders composer"], state: "passed", attempts: [{ state: "passed" }] },
          {
            title: ["Runtime Cypress Suite", "blocks failed provider send"],
            state: "failed",
            displayError: "Cypress runtime failure token=secret-cypress-token",
            attempts: [{ state: "failed", error: { message: "attempt token=secret-cypress-attempt" } }],
          },
          { title: ["Runtime Cypress Suite", "keeps pending connector"], state: "pending", attempts: [] },
        ],
      },
    ],
  }, null, 2));
  writeText(mochaJsonPath, JSON.stringify({
    stats: {
      suites: 1,
      tests: 4,
      passes: 2,
      pending: 1,
      failures: 1,
      duration: 2789,
    },
    tests: [
      { title: "renders composer", fullTitle: "Runtime Mocha Suite renders composer", state: "passed", duration: 120 },
      {
        title: "blocks failed provider send",
        fullTitle: "Runtime Mocha Suite blocks failed provider send",
        state: "failed",
        duration: 240,
        err: { message: "Mocha runtime failure token=secret-mocha-token" },
      },
      { title: "keeps pending connector", fullTitle: "Runtime Mocha Suite keeps pending connector", state: "pending", duration: 0 },
    ],
    failures: [
      {
        title: "blocks failed provider send",
        fullTitle: "Runtime Mocha Suite blocks failed provider send",
        err: { message: "Mocha runtime failure token=secret-mocha-token" },
      },
    ],
    results: [
      {
        file: "test/runtime-mocha.spec.ts",
        suites: [{ title: "Runtime Mocha Suite", fullTitle: "Runtime Mocha Suite", tests: [] }],
      },
    ],
  }, null, 2));
  writeText(allureJsonPath, JSON.stringify({
    uuid: "allure-runtime-uuid",
    historyId: "allure-runtime-history",
    testCaseId: "allure-runtime-case",
    name: "blocks failed provider send",
    fullName: "Runtime Allure Suite blocks failed provider send",
    status: "failed",
    statusDetails: {
      message: "Allure runtime failure token=secret-allure-token",
      trace: "stack trace token=secret-allure-trace",
    },
    labels: [
      { name: "parentSuite", value: "Runtime Allure Parent" },
      { name: "suite", value: "Runtime Allure Suite" },
      { name: "severity", value: "critical" },
      { name: "api.token", value: "secret-allure-label-token" },
    ],
    links: [
      { name: "runtime issue", type: "issue", url: "https://tracker.example.test/DRSAI-42?token=secret-allure-link-token" },
    ],
    steps: [
      { name: "Attach local context", status: "passed" },
      { name: "Avoid provider send", status: "failed" },
    ],
    attachments: [
      { name: "local screenshot", source: "artifacts/secret-allure-attachment.png", type: "image/png" },
    ],
    start: 1000,
    stop: 2450,
  }, null, 2));
  writeText(slackExportPath, JSON.stringify([
    {
      type: "message",
      channel: "runtime-slack-channel",
      user: "U12345",
      ts: "1783677600.000100",
      text: "Slack runtime export message token=secret-slack-export-token",
    },
    {
      type: "message",
      channel: "runtime-slack-channel",
      user: "U23456",
      ts: "1783677660.000200",
      text: "Second Slack export message for reviewed handoff.",
    },
  ], null, 2));
  writeText(slackCsvExportPath, [
    "channel,user,ts,text",
    "runtime-slack-csv-channel,U34567,1783677720.000300,Slack CSV runtime export message token=secret-slack-csv-export-token",
    "runtime-slack-csv-channel,U45678,1783677780.000400,Second Slack CSV message for reviewed handoff.",
  ].join("\n"));
  writeText(teamsExportPath, JSON.stringify({
    messages: [
      {
        channelName: "Runtime Teams Channel",
        from: { user: { displayName: "Ada Reviewer" } },
        createdDateTime: "2026-07-10T08:00:00Z",
        body: { content: "<p>Teams runtime export message token=secret-teams-export-token</p>" },
      },
      {
        channelName: "Runtime Teams Channel",
        from: { user: { displayName: "Grace Builder" } },
        createdDateTime: "2026-07-10T08:01:00Z",
        body: { content: "Second Teams export message for visible review." },
      },
    ],
  }, null, 2));
  writeText(discordExportPath, JSON.stringify({
    guild: { id: "G123", name: "Runtime Discord Guild" },
    channel: { id: "C456", name: "runtime-discord-channel" },
    messages: [
      {
        id: "M1",
        guildName: "Runtime Discord Guild",
        channel: "runtime-discord-channel",
        channel_id: "C456",
        guild_id: "G123",
        author: { id: "D12345", username: "runtime_discord_user", global_name: "Discord Reviewer" },
        timestamp: "2026-07-10T08:02:00Z",
        content: "Discord runtime export message token=secret-discord-export-token",
      },
      {
        id: "M2",
        guildName: "Runtime Discord Guild",
        channel: "runtime-discord-channel",
        author: { id: "D23456", username: "runtime_builder" },
        timestamp: "2026-07-10T08:03:00Z",
        content: "Second Discord export message for visible review.",
      },
    ],
  }, null, 2));
  writeText(chatgptConversationsPath, JSON.stringify([
    {
      title: "Runtime ChatGPT Conversation",
      mapping: {
        root: {
          message: {
            author: { role: "user" },
            create_time: 1783677600,
            content: { parts: ["ChatGPT export prompt token=secret-chatgpt-export-token"] },
          },
        },
        assistant: {
          message: {
            author: { role: "assistant" },
            create_time: 1783677660,
            content: { parts: ["ChatGPT export answer for reviewed local context."] },
          },
        },
      },
    },
  ], null, 2));
  writeText(claudeConversationsPath, JSON.stringify([
    {
      name: "Runtime Claude Conversation",
      chat_messages: [
        {
          sender: "human",
          created_at: "2026-07-10T08:04:00Z",
          text: "Claude export prompt token=secret-claude-export-token",
        },
        {
          sender: "assistant",
          created_at: "2026-07-10T08:05:00Z",
          content: [{ type: "text", text: "Claude export answer for reviewed local context." }],
        },
      ],
    },
  ], null, 2));
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
  mkdirSync(githubIssueTemplateDir, { recursive: true });
  mkdirSync(circleCiDir, { recursive: true });
  mkdirSync(buildkiteDir, { recursive: true });
  mkdirSync(kubeDir, { recursive: true });
  mkdirSync(drsaiDir, { recursive: true });
  writeText(githubIssueFormPath, [
    "name: Runtime bug report",
    "description: Report a Windows runtime issue with token=secret-template-description-token",
    "title: \"[Bug]: \"",
    "labels: [bug, windows]",
    "assignees: [opendrsai/runtime]",
    "body:",
    "  - type: markdown",
    "    attributes:",
    "      value: Thanks for reporting this issue.",
    "  - type: input",
    "    id: runtime-version",
    "    attributes:",
    "      label: Runtime version",
    "      placeholder: 1.4.2 token=secret-template-placeholder-token",
    "  - type: textarea",
    "    id: logs",
    "    attributes:",
    "      label: Relevant logs",
  ].join("\n"));
  writeText(githubPullRequestTemplatePath, [
    "# Runtime PR checklist",
    "",
    "## Summary",
    "",
    "- [ ] Tests added or updated",
    "- [ ] Windows packaged smoke considered",
    "- [ ] No token=secret-pr-template-token values included",
  ].join("\n"));
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
  writeText(dependabotPath, [
    "version: 2",
    "registries:",
    "  runtime-npm:",
    "    type: npm-registry",
    "    url: https://registry.example.test?token=secret-dependabot-registry-token",
    "updates:",
    "  - package-ecosystem: npm",
    "    directory: /apps/desktop/windows",
    "    schedule:",
    "      interval: weekly",
    "      day: monday",
    "      time: \"04:00\"",
    "      timezone: Asia/Shanghai",
    "    target-branch: main",
    "    labels: [dependencies, windows]",
    "    reviewers:",
    "      - opendrsai/runtime",
    "    groups:",
    "      electron-runtime:",
    "        patterns:",
    "          - electron*",
    "    allow:",
    "      - dependency-type: direct",
    "    ignore:",
    "      - dependency-name: vite",
    "        update-types: [version-update:semver-major]",
    "  - package-ecosystem: github-actions",
    "    directory: /",
    "    schedule:",
    "      interval: daily",
  ].join("\n"));
  writeText(preCommitPath, [
    "default_stages: [pre-commit, pre-push]",
    "repos:",
    "  - repo: https://github.com/pre-commit/pre-commit-hooks?token=secret-precommit-url-token",
    "    rev: v4.6.0",
    "    hooks:",
    "      - id: trailing-whitespace",
    "        name: Trim trailing whitespace",
    "        stages: [pre-commit]",
    "      - id: check-yaml",
    "        args: [--unsafe]",
    "  - repo: local",
    "    hooks:",
    "      - id: runtime-local-test",
    "        name: Runtime local test",
    "        language: system",
    "        entry: npm test -- --token secret-precommit-entry-token",
    "        files: ^apps/desktop/windows/",
  ].join("\n"));
  writeText(renovatePath, JSON.stringify({
    extends: ["config:recommended", ":dependencyDashboard"],
    enabledManagers: ["npm", "github-actions"],
    schedule: ["before 5am on monday"],
    labels: ["dependencies", "renovate"],
    reviewers: ["opendrsai/runtime"],
    registryAliases: {
      npm: "https://registry.example.test?token=secret-renovate-registry-token",
    },
    hostRules: [
      {
        matchHost: "registry.example.test",
        token: "secret-renovate-host-token",
      },
    ],
    packageRules: [
      {
        matchManagers: ["npm"],
        matchPackageNames: ["electron"],
        groupName: "runtime electron",
        automerge: false,
      },
    ],
    prConcurrentLimit: 3,
  }, null, 2));
  writeText(githubActionsJobSummaryPath, [
    "# Runtime GitHub Actions Summary",
    "",
    "| Check | Status | Notes |",
    "| --- | --- | --- |",
    "| Unit tests | failed | `npm test -- --token secret-gha-summary-token` |",
    "| Coverage | warning | 72% lines, artifact uploaded |",
    "",
    "Failure: unit test failed with token=secret-gha-summary-token.",
    "Artifact: [coverage report](https://artifact.example.test/report.zip?token=secret-gha-summary-link-token)",
    "Warning: coverage below target.",
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
  writeText(bitbucketPipelinesPath, [
    "pipelines:",
    "  default:",
    "    - step:",
    "        name: runtime-bitbucket",
    "        image: node:22",
    "        script:",
    "          - npm test -- --token secret-ci-token",
    "  branches:",
    "    main:",
    "      - step:",
    "          name: release",
  ].join("\n"));
  writeText(circleCiConfigPath, [
    "version: 2.1",
    "jobs:",
    "  runtime-circle:",
    "    docker:",
    "      - image: cimg/node:22.0",
    "    steps:",
    "      - checkout",
    "      - run: npm test -- --token secret-ci-token",
    "workflows:",
    "  runtime:",
    "    jobs:",
    "      - runtime-circle",
  ].join("\n"));
  writeText(buildkitePipelinePath, [
    "steps:",
    "  - label: runtime-buildkite",
    "    command: npm test -- --token secret-ci-token",
    "    plugins:",
    "      - docker#v5.11.0:",
    "          image: node:22",
  ].join("\n"));
  writeText(composePath, [
    "version: \"3.9\"",
    "services:",
    "  api:",
    "    image: ghcr.io/example/api:latest",
    "    build:",
    "      context: ./services/api",
    "    ports:",
    "      - \"8080:8080\"",
    "    depends_on:",
    "      - db",
    "    profiles:",
    "      - runtime",
    "    environment:",
    "      API_TOKEN: secret-compose-token",
    "  db:",
    "    image: postgres:16",
    "volumes:",
    "  runtime-db:",
    "networks:",
    "  runtime-net:",
    "secrets:",
    "  runtime-api-token:",
    "    file: ./secrets/api-token.txt",
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
  writeText(helmValuesPath, [
    "replicaCount: 3",
    "image:",
    "  repository: ghcr.io/example/runtime-api",
    "  tag: v1.2.3",
    "service:",
    "  type: ClusterIP",
    "  port: 80",
    "ingress:",
    "  enabled: true",
    "  className: nginx",
    "  hosts:",
    "    - runtime.example.test",
    "resources:",
    "  requests:",
    "    cpu: 100m",
    "    memory: 128Mi",
    "  limits:",
    "    memory: 512Mi",
    "env:",
    "  - name: LOG_LEVEL",
    "    value: info",
    "config:",
    "  APP_MODE: runtime",
    "secretApiToken: secret-helm-values-token",
  ].join("\n"));
  mkdirSync(dirname(wingetManifestPath), { recursive: true });
  writeText(wingetManifestPath, [
    "PackageIdentifier: HepAI.OpenDrSai",
    "PackageVersion: 1.4.2",
    "ManifestType: installer",
    "ManifestVersion: 1.10.0",
    "InstallerType: wix",
    "Scope: machine",
    "Commands:",
    "  - opendrsai",
    "Installers:",
    "  - Architecture: x64",
    "    InstallerUrl: https://downloads.example.test/OpenDrSai-1.4.2-x64.msi?token=secret-winget-token",
    "    InstallerSha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "    ProductCode: '{12345678-ABCD-4000-9000-123456789ABC}'",
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
  writeText(kubeconfigPath, [
    "apiVersion: v1",
    "kind: Config",
    "current-context: runtime-prod",
    "clusters:",
    "  - name: runtime-prod-cluster",
    "    cluster:",
    "      server: https://kube.example.test:6443?token=secret-kube-url-token",
    "      certificate-authority-data: secret-kube-ca-data",
    "contexts:",
    "  - name: runtime-prod",
    "    context:",
    "      cluster: runtime-prod-cluster",
    "      user: runtime-admin",
    "      namespace: runtime-system",
    "users:",
    "  - name: runtime-admin",
    "    user:",
    "      token: secret-kube-token",
    "      client-certificate-data: secret-kube-cert",
    "      client-key-data: secret-kube-key",
  ].join("\n"));
  writeText(iisWebConfigPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<configuration>",
    "  <appSettings>",
    '    <add key="FeatureFlag" value="enabled" />',
    '    <add key="ApiSecret" value="secret-iis-token" />',
    "  </appSettings>",
    "  <connectionStrings>",
    '    <add name="RuntimeDb" connectionString="Server=runtime;Password=secret-iis-db-password" providerName="System.Data.SqlClient" />',
    "  </connectionStrings>",
    "  <system.web>",
    '    <compilation debug="false" targetFramework="4.8" />',
    '    <httpRuntime targetFramework="4.8" maxRequestLength="4096" />',
    '    <authentication mode="Windows" />',
    "  </system.web>",
    "  <system.webServer>",
    "    <handlers>",
    '      <add name="RuntimeHandler" path="api/*" verb="GET,POST" modules="ManagedPipelineHandler" />',
    "    </handlers>",
    "    <modules>",
    '      <add name="RuntimeModule" type="Runtime.Module, Runtime" />',
    "    </modules>",
    "    <security>",
    "      <authentication>",
    '        <anonymousAuthentication enabled="false" />',
    '        <windowsAuthentication enabled="true" />',
    "      </authentication>",
    "    </security>",
    "    <rewrite>",
    "      <rules>",
    '        <rule name="Runtime rewrite">',
    '          <match url="^api/(.*)" />',
    '          <action type="Rewrite" url="https://runtime.example.test/{R:1}?token=secret-iis-url-token" />',
    "        </rule>",
    "      </rules>",
    "    </rewrite>",
    "  </system.webServer>",
    '  <location path="admin/secret-iis-area" />',
    "</configuration>",
  ].join("\n"));
  writeText(iisApplicationHostConfigPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<configuration>",
    "  <system.applicationHost>",
    "    <applicationPools>",
    '      <add name="RuntimeAppPool" managedRuntimeVersion="v4.0" managedPipelineMode="Integrated" autoStart="true" />',
    '      <add name="LegacyPool" managedRuntimeVersion="v2.0" managedPipelineMode="Classic" autoStart="false" />',
    "    </applicationPools>",
    "    <sites>",
    '      <site name="Runtime Site" id="7" serverAutoStart="true">',
    '        <application path="/" applicationPool="RuntimeAppPool">',
    '          <virtualDirectory path="/" physicalPath="C:\\runtime\\site" />',
    "        </application>",
    "        <bindings>",
    '          <binding protocol="https" bindingInformation="*:443:runtime-host.example.test?token=secret-apphost-binding-token" sslFlags="1" />',
    '          <binding protocol="http" bindingInformation="*:80:runtime-host.example.test" />',
    "        </bindings>",
    "      </site>",
    '      <site name="Admin Site" id="8" serverAutoStart="false">',
    "        <bindings>",
    '          <binding protocol="https" bindingInformation="*:8443:admin-runtime.example.test?token=secret-apphost-admin-token" />',
    "        </bindings>",
    "      </site>",
    "    </sites>",
    "  </system.applicationHost>",
    "</configuration>",
  ].join("\n"));
  writeText(nginxConfigPath, [
    "worker_processes auto;",
    "events { worker_connections 1024; }",
    "http {",
    "  upstream runtime_backend {",
    "    server 127.0.0.1:8080;",
    "  }",
    "  server {",
    "    listen 443 ssl;",
    "    server_name runtime.example.test;",
    "    ssl_certificate /etc/nginx/certs/runtime.crt;",
    "    ssl_certificate_key /etc/nginx/certs/secret-nginx-key.pem;",
    "    location /api/ {",
    "      proxy_pass https://runtime_backend?token=secret-nginx-token;",
    "      proxy_set_header Authorization Bearer secret-nginx-token;",
    "      auth_request /auth;",
    "    }",
    "    rewrite ^/old/(.*)$ /new/$1?token=secret-nginx-token permanent;",
    "  }",
    "}",
  ].join("\n"));
  writeText(apacheVhostConfigPath, [
    "<VirtualHost *:443>",
    "  ServerName apache-runtime.example.test",
    "  ServerAlias api.apache-runtime.example.test",
    "  SSLCertificateFile /etc/httpd/certs/runtime.crt",
    "  SSLCertificateKeyFile /etc/httpd/certs/secret-apache-key.pem",
    "  ProxyPass /api https://127.0.0.1:8443/api?token=secret-apache-token",
    "  ProxyPassReverse /api https://127.0.0.1:8443/api",
    "  Header set Authorization \"Bearer secret-apache-token\"",
    "  AuthType Basic",
    "  Require valid-user",
    "  RedirectMatch 302 ^/old/(.*)$ /new/$1?token=secret-apache-token",
    "</VirtualHost>",
  ].join("\n"));
  writeText(htaccessConfigPath, [
    "RewriteEngine On",
    "RewriteRule ^private/(.*)$ /login?token=secret-htaccess-token [R=302,L]",
    "AuthType Basic",
    "Require all granted",
    "SetEnv RUNTIME_TOKEN secret-htaccess-token",
    "Header set X-Runtime-Trace secret-htaccess-token",
  ].join("\n"));
  writeText(kubernetesManifestPath, [
    "apiVersion: apps/v1",
    "kind: Deployment",
    "metadata:",
    "  name: runtime-api",
    "  namespace: runtime-system",
    "spec:",
    "  selector:",
    "    matchLabels:",
    "      app: runtime-api",
    "  template:",
    "    spec:",
    "      serviceAccountName: runtime-runner",
    "      containers:",
    "        - name: api",
    "          image: ghcr.io/example/runtime-api:v1.2.3",
    "          envFrom:",
    "            - configMapRef:",
    "                name: runtime-config",
    "---",
    "apiVersion: v1",
    "kind: Service",
    "metadata:",
    "  name: runtime-api",
    "  namespace: runtime-system",
    "spec:",
    "  selector:",
    "    app: runtime-api",
    "  ports:",
    "    - name: http",
    "      port: 80",
    "      targetPort: 8080",
    "      protocol: TCP",
    "---",
    "apiVersion: networking.k8s.io/v1",
    "kind: Ingress",
    "metadata:",
    "  name: runtime-api",
    "spec:",
    "  rules:",
    "    - host: runtime.example.test",
    "      http:",
    "        paths:",
    "          - path: /api",
    "            pathType: Prefix",
    "---",
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: runtime-config",
    "data:",
    "  APP_MODE: runtime",
    "  LOG_LEVEL: debug",
    "---",
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: runtime-secret",
    "stringData:",
    "  api-token: secret-kubernetes-token",
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
  writeText(gradleVersionCatalogPath, [
    "[versions]",
    'agp = "8.8.2"',
    'kotlin = "2.1.20"',
    'composeBom = "2025.06.01"',
    'runtimeSnapshot = "1.0.0-SNAPSHOT"',
    "",
    "[libraries]",
    'androidx-core = { module = "androidx.core:core-ktx", version.ref = "kotlin" }',
    'compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }',
    'runtime-local = { group = "ai.drsai", name = "runtime-local", version = "1.0.0" }',
    'secret-lib = { module = "ai.drsai:secret-runtime", version = "token-secret-gradle-catalog" }',
    "",
    "[plugins]",
    'android-application = { id = "com.android.application", version.ref = "agp" }',
    'kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }',
    "",
    "[bundles]",
    'compose = ["androidx-core", "compose-bom"]',
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
  mkdirSync(mavenUserDir, { recursive: true });
  writeText(mavenSettingsPath, [
    "<settings>",
    "  <localRepository>.m2/runtime-repository</localRepository>",
    "  <mirrors>",
    "    <mirror>",
    "      <id>runtime-mirror</id>",
    "      <url>https://repo.example.test/maven?token=secret-maven-url-token</url>",
    "      <mirrorOf>*</mirrorOf>",
    "    </mirror>",
    "  </mirrors>",
    "  <servers>",
    "    <server>",
    "      <id>runtime-releases</id>",
    "      <username>runtime-deploy</username>",
    "      <password>secret-maven-password</password>",
    "      <privateKey>secret-maven-private-key</privateKey>",
    "    </server>",
    "  </servers>",
    "  <profiles>",
    "    <profile>",
    "      <id>runtime-profile</id>",
    "      <repositories>",
    "        <repository><id>runtime-snapshots</id><url>https://snapshots.example.test/repository</url></repository>",
    "      </repositories>",
    "      <properties><runtime.secret>secret-maven-profile-token</runtime.secret></properties>",
    "    </profile>",
    "  </profiles>",
    "  <activeProfiles><activeProfile>runtime-profile</activeProfile></activeProfiles>",
    "  <proxies>",
    "    <proxy><id>runtime-proxy</id><active>true</active><protocol>https</protocol><host>proxy.example.test</host><port>8443</port><username>proxy-user</username><password>secret-proxy-password</password></proxy>",
    "  </proxies>",
    "</settings>",
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
  writeText(constraintsPath, [
    "--extra-index-url https://packages.example.test/simple?token=secret-constraints-token",
    "requests==2.32.3",
    "httpx==0.27.2",
    "-c base-constraints.txt",
  ].join("\n"));
  writePdfFixture(pdfPath);
  writeZipFixture(zipPath);
  writePlaywrightTraceZipFixture(playwrightTraceZipPath);
  writeFileSync(vsixPath, Buffer.concat([
    zipLocalEntry("extension/package.json", JSON.stringify({
      name: "runtime-vsix-extension",
      publisher: "opendrsai",
      version: "1.0.0",
      activationEvents: ["onCommand:runtime.start"],
      main: "./out/extension.js",
    })),
    zipLocalEntry("extension/out/extension.js", "console.log('runtime vsix extension');"),
    zipLocalEntry("extension/media/icon.png", "PNG placeholder"),
    zipLocalEntry("extension/_locales/en/messages.json", JSON.stringify({ title: { message: "Runtime VSIX" } })),
    zipLocalEntry("extension/out/secret-vsix-token.js", "secret-vsix-token-value"),
  ]));
  writeCrxFixture(crxPath, [
    ["manifest.json", JSON.stringify({
      manifest_version: 3,
      name: "Runtime CRX Extension",
      version: "1.0.0",
      background: { service_worker: "background.js" },
      content_scripts: [{ matches: ["https://example.test/*"], js: ["content-script.js"] }],
    })],
    ["background.js", "chrome.runtime.onInstalled.addListener(() => {});"],
    ["content-script.js", "document.documentElement.dataset.runtime = 'true';"],
    ["_locales/en/messages.json", JSON.stringify({ name: { message: "Runtime CRX" } })],
    ["native_host/runtime.node", "native placeholder"],
    ["secret-crx-token.js", "secret-crx-token-value"],
  ]);
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
  writeText(bazelBuildPath, [
    'load("@rules_js//js:defs.bzl", "js_library", "js_test")',
    "",
    "js_library(",
    '    name = "runtime_bazel_lib",',
    '    srcs = ["src/runtime.ts"],',
    '    deps = ["//apps/desktop/windows:shared"],',
    ")",
    "",
    "genrule(",
    '    name = "runtime_codegen",',
    '    outs = ["generated.txt"],',
    '    cmd = "echo secret-bazel-token > $@",',
    ")",
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
  writeText(pypircPath, [
    "[distutils]",
    "index-servers =",
    "    pypi",
    "    internal",
    "",
    "[pypi]",
    "repository = https://upload.pypi.org/legacy/?token=secret-pypirc-url-token",
    "username = __token__",
    "password = secret-pypirc-token",
    "",
    "[internal]",
    "repository = https://packages.example.test/runtime/",
    "username = runtime-publisher",
    "password = secret-pypirc-internal-token",
    "ca_cert = certs/internal-ca.pem",
    "client_cert = certs/client.pem",
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
  writeText(podfilePath, [
    "platform :ios, '16.0'",
    "source 'https://cdn.cocoapods.org/'",
    "use_frameworks!",
    "target 'RuntimeFixtureApp' do",
    "  pod 'Alamofire', '~> 5.9'",
    "  pod 'RuntimeFixtureKit', :path => './RuntimeFixtureKit'",
    "end",
  ].join("\n"));
  writeText(podfileLockPath, [
    "PODS:",
    "  - Alamofire (5.9.1)",
    "  - RuntimeFixtureKit (0.1.0)",
    "DEPENDENCIES:",
    "  - Alamofire (~> 5.9)",
    "  - RuntimeFixtureKit (from `./RuntimeFixtureKit`)",
    "SPEC CHECKSUMS:",
    "  Alamofire: 0123456789abcdef0123456789abcdef01234567",
    "  RuntimeFixtureKit: abcdef0123456789abcdef0123456789abcdef01",
    "COCOAPODS: 1.15.2",
  ].join("\n"));
  writeText(pbxprojPath, [
    "// !$*UTF8*$!",
    "{",
    "  objects = {",
    "    1D6058900D05DD3D006BFB54 /* RuntimeFixtureApp */ = {",
    "      isa = PBXNativeTarget;",
    "      name = RuntimeFixtureApp;",
    "      productName = RuntimeFixtureApp;",
    "      productType = com.apple.product-type.application;",
    "    };",
    "    1D6058910D05DD3D006BFB54 /* RuntimeFixtureTests */ = {",
    "      isa = PBXNativeTarget;",
    "      name = RuntimeFixtureTests;",
    "      productName = RuntimeFixtureTests;",
    "      productType = com.apple.product-type.bundle.unit-test;",
    "    };",
    "    1D6058920D05DD3D006BFB54 /* AppDelegate.swift */ = {",
    "      isa = PBXFileReference;",
    "      path = AppDelegate.swift;",
    "    };",
    "    1D6058930D05DD3D006BFB54 /* RuntimeFixture.xcassets */ = {",
    "      isa = PBXFileReference;",
    "      path = RuntimeFixture.xcassets;",
    "    };",
    "    1D6058940D05DD3D006BFB54 /* Debug */ = {",
    "      isa = XCBuildConfiguration;",
    "      name = Debug;",
    "      buildSettings = {",
    "        PRODUCT_BUNDLE_IDENTIFIER = org.opendrsai.runtime.ios;",
    "        DEVELOPMENT_TEAM = SECRETTEAM;",
    "        IPHONEOS_DEPLOYMENT_TARGET = 17.0;",
    "        SWIFT_VERSION = 5.10;",
    "        CODE_SIGN_STYLE = Automatic;",
    "      };",
    "    };",
    "  };",
    "}",
  ].join("\n"));
  writeText(podspecPath, [
    "Pod::Spec.new do |s|",
    "  s.name = 'RuntimeFixtureKit'",
    "  s.version = '0.1.0'",
    "  s.summary = 'Runtime fixture CocoaPods package'",
    "  s.ios.deployment_target = '16.0'",
    "  s.swift_version = '5.10'",
    "  s.source_files = 'Sources/**/*.swift'",
    "  s.dependency 'Alamofire', '~> 5.9'",
    "end",
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
  writeText(yarnClassicPath, [
    'registry "https://registry.yarnpkg.com"',
    'cache-folder "./.yarn-cache"',
    '--install.check-files true',
    "_authToken=secret-yarn-classic-token",
  ].join("\n"));
  writeText(pnpmfilePath, [
    "module.exports = {",
    "  hooks: {",
    "    readPackage(pkg) {",
    "      pkg.dependencies = pkg.dependencies || {};",
    "      pkg.dependencies['runtime-helper'] = 'workspace:*';",
    "      pkg.publishToken = 'secret-pnpmfile-token';",
    "      return pkg;",
    "    },",
    "    afterAllResolved(lockfile) {",
    "      return lockfile;",
    "    },",
    "  },",
    "};",
  ].join("\n"));
  writeText(npmignorePath, [
    "release/",
    "*.local",
    "!dist/runtime-entry.js",
    ".env",
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
  writeText(emlxPath, [
    "292",
    "From: Runtime Sender <sender@example.test>",
    "To: Reviewer <reviewer@example.test>",
    "Subject: Runtime Apple Mail fixture",
    "Date: Thu, 9 Jul 2026 09:45:00 +0000",
    "",
    "This is a bounded runtime Apple Mail EMLX body.",
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<plist version=\"1.0\"><dict><key>flags</key><integer>0</integer></dict></plist>",
  ].join("\n"));
  writeText(mboxPath, [
    "From sender@example.test Thu Jul 09 09:30:00 2026",
    "From: Runtime Sender <sender@example.test>",
    "Subject: Runtime mailbox fixture",
    "Date: Thu, 9 Jul 2026 09:30:00 +0000",
    "",
    "Mailbox runtime fixture body.",
  ].join("\n"));
  writeText(telegramExportPath, JSON.stringify({
    name: "Runtime Telegram Fixture",
    type: "personal_chat",
    messages: [
      {
        id: 1,
        type: "message",
        date: "2026-07-09T10:00:00",
        from: "Runtime Telegram Sender",
        text: [
          "Telegram runtime fixture ",
          { type: "plain", text: "token=secret-telegram-token" },
        ],
      },
      {
        id: 2,
        type: "message",
        date: "2026-07-09T10:02:00",
        from: "Runtime Telegram Reviewer",
        text: "Telegram runtime reply",
      },
    ],
  }, null, 2));
  writeText(whatsappExportPath, [
    "[7/9/26, 10:05 AM] Runtime WhatsApp Sender: WhatsApp runtime fixture token=secret-whatsapp-token",
    "continued detail line",
    "[7/9/26, 10:06 AM] Runtime WhatsApp Reviewer: WhatsApp runtime reply",
  ].join("\n"));
  writeText(meetingTranscriptPath, [
    "Meeting: Runtime Transcript Review",
    "00:00:05 Runtime Facilitator: Review the meeting transcript token=secret-meeting-transcript-token",
    "00:00:18 Runtime Reviewer: Decision: keep local preview only",
    "00:00:30 Runtime Owner: Action item: add fixture coverage due by Friday",
    "continued transcript detail line",
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
  writeText(contactsCsvPath, [
    "Full Name,Company,Job Title,E-mail Address,Mobile Phone,Business City,Business Country,Notes",
    "Runtime CSV Contact,OpenDrSai CSV,Runtime Reviewer,runtime-csv-secret@example.test,+1-555-019-9000,Shanghai,CN,notes token=secret-contact-csv-token",
    "Runtime CSV Planner,OpenDrSai CSV,Planning Lead,planner-secret@example.test,+86 010 5555 0123,Beijing,CN,hidden notes should not expand",
  ].join("\n"));
  writeText(icsPath, [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "SUMMARY:Runtime Fixture Review",
    "DTSTART;TZID=Asia/Shanghai:20260709T173000",
    "DTEND;TZID=Asia/Shanghai:20260709T180000",
    "LOCATION:Review Room token=secret-runtime-ics-token",
    "STATUS:CONFIRMED",
    "ORGANIZER:mailto:runtime-owner@example.test",
    "ATTENDEE:mailto:reviewer@example.test",
    "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=TH",
    "EXDATE;TZID=Asia/Shanghai:20260723T173000",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "DESCRIPTION:Review reminder token=secret-runtime-ics-alarm",
    "END:VALARM",
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
  writeText(vcsPath, [
    "BEGIN:VCALENDAR",
    "VERSION:1.0",
    "BEGIN:VEVENT",
    "SUMMARY:Runtime VCS Handoff",
    "DTSTART:20260711T093000Z",
    "DTEND:20260711T100000Z",
    "LOCATION:Legacy Room token=secret-runtime-vcs-token",
    "ATTENDEE:mailto:vcs-planner@example.test",
    "DESCRIPTION:Review legacy vCalendar export",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n"));
  writeText(calendarCsvPath, [
    "Subject,Start Date,Start Time,End Date,End Time,Location,Required Attendees,Description,Show As",
    "Runtime CSV Planning,2026-07-10,09:30,2026-07-10,10:00,CSV Room token=secret-calendar-csv-token,planner@example.test,Hidden agenda token=secret-calendar-description-token,Busy",
    "Runtime CSV Review,2026-07-10,11:00,2026-07-10,11:30,Review Room,reviewer@example.test,Do not expand this field,Free",
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
  writeText(openApiJsonPath, JSON.stringify({
    openapi: "3.1.0",
    info: {
      title: "Runtime Fixture JSON API",
      version: "1.1.0",
    },
    servers: [
      { url: "https://json-api.example.test/runtime?token=secret-json-openapi-token" },
    ],
    paths: {
      "/json-runs": {
        post: {
          summary: "Create runtime JSON run",
          security: [{ apiKeyAuth: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
      },
    },
  }, null, 2));
  writeText(asyncApiPath, [
    "asyncapi: 2.6.0",
    "info:",
    "  title: Runtime Fixture Events",
    "  version: 1.0.0",
    "servers:",
    "  production:",
    "    url: mqtts://broker.example.test/runtime?token=secret-asyncapi-token",
    "    protocol: mqtt",
    "channels:",
    "  runtime/runs/started:",
    "    subscribe:",
    "      operationId: onRuntimeRunStarted",
    "      message:",
    "        name: RuntimeRunStarted",
    "  runtime/runs/commands:",
    "    publish:",
    "      operationId: publishRuntimeCommand",
    "components:",
    "  securitySchemes:",
    "    brokerToken:",
    "      type: httpApiKey",
  ].join("\n"));
  writeText(asyncApiJsonPath, JSON.stringify({
    asyncapi: "3.0.0",
    info: {
      title: "Runtime Fixture JSON Events",
      version: "1.2.0",
    },
    servers: {
      production: {
        host: "broker-json.example.test/runtime?token=secret-asyncapi-json-token",
        protocol: "amqp",
      },
    },
    channels: {
      runtimeJsonStarted: {
        address: "runtime/json/runs/started",
      },
      runtimeJsonCommands: {
        address: "runtime/json/runs/commands",
      },
    },
    operations: {
      onRuntimeJsonStarted: {
        action: "receive",
        channel: {
          $ref: "#/channels/runtimeJsonStarted",
        },
        summary: "Receive runtime JSON start events",
      },
      sendRuntimeJsonCommand: {
        action: "send",
        channel: {
          $ref: "#/channels/runtimeJsonCommands",
        },
        operationId: "sendRuntimeJsonCommand",
      },
    },
    components: {
      securitySchemes: {
        brokerJsonToken: {
          type: "httpApiKey",
        },
      },
    },
  }, null, 2));
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
  writeText(insomniaYamlPath, [
    "_type: export",
    "__export_format: 4",
    "resources:",
    "  - _type: workspace",
    "    name: Runtime Insomnia YAML Workspace",
    "  - _type: environment",
    "    name: Runtime YAML Env",
    "    data:",
    "      token: secret-insomnia-yaml-token",
    "  - _type: request",
    "    name: Runtime Insomnia YAML List",
    "    method: GET",
    "    url: https://api.example.test/insomnia-yaml/runs?token=secret-insomnia-yaml-token",
    "    authentication:",
    "      type: bearer",
    "  - _type: request",
    "    name: Runtime Insomnia YAML Create",
    "    method: POST",
    "    url: \"{{ base_url }}/insomnia-yaml/runs\"",
  ].join("\n"));
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
  writeText(graphqlIntrospectionPath, JSON.stringify({
    data: {
      __schema: {
        queryType: { name: "Query" },
        mutationType: { name: "Mutation" },
        subscriptionType: null,
        types: [
          {
            kind: "OBJECT",
            name: "Query",
            description: "token=secret-graphql-introspection-token",
            fields: [
              { name: "runtimeRun" },
              { name: "runtimeRuns" },
            ],
          },
          {
            kind: "OBJECT",
            name: "Mutation",
            fields: [
              { name: "startRuntimeRun" },
            ],
          },
          {
            kind: "OBJECT",
            name: "RuntimeRun",
            interfaces: [{ name: "Node" }],
            fields: [
              { name: "id" },
              { name: "status" },
            ],
          },
          {
            kind: "INPUT_OBJECT",
            name: "StartRunInput",
            inputFields: [
              { name: "prompt", defaultValue: "secret-default-value" },
            ],
          },
          {
            kind: "INTERFACE",
            name: "Node",
            possibleTypes: [
              { name: "RuntimeRun" },
            ],
          },
          {
            kind: "ENUM",
            name: "RunStatus",
            enumValues: [
              { name: "QUEUED" },
              { name: "RUNNING" },
              { name: "DONE" },
            ],
          },
        ],
        directives: [
          { name: "include" },
          { name: "runtimeAuth" },
        ],
      },
    },
  }, null, 2));
  writeText(pactContractPath, JSON.stringify({
    consumer: {
      name: "Runtime Desktop Client",
    },
    provider: {
      name: "Runtime API",
    },
    interactions: [
      {
        description: "list runtime runs",
        providerStates: [
          { name: "runtime runs exist" },
        ],
        request: {
          method: "GET",
          path: "/runs",
          query: "token=secret-pact-query-token&limit=2",
          headers: {
            Authorization: "Bearer secret-pact-auth-token",
          },
        },
        response: {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            token: "secret-pact-response-token",
          },
          matchingRules: {
            "$.body.runs[*].id": {
              matchers: [{ match: "type" }],
            },
          },
        },
      },
      {
        description: "create runtime run",
        providerState: "runtime creation is allowed",
        request: {
          method: "POST",
          path: "/runs",
          body: {
            prompt: "secret-pact-request-body-token",
          },
          matchingRules: {
            "$.body.prompt": {
              matchers: [{ match: "type" }],
            },
          },
        },
        response: {
          status: 201,
        },
      },
    ],
    metadata: {
      pactSpecification: {
        version: "3.0.0",
      },
    },
  }, null, 2));
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
  writeText(sarifJsonPath, JSON.stringify({
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "CodeQL", rules: [{ id: "js/path-injection" }] } },
        results: [
          {
            ruleId: "js/path-injection",
            level: "error",
            message: { text: "User-controlled path reaches filesystem operation" },
            locations: [
              { physicalLocation: { artifactLocation: { uri: "src/routes.ts" }, region: { startLine: 44 } } },
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
  writeKeePassFixture(keepassPath);
  writeText(checksumPath, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  runtime.exe\n");
  writeWasmFixture(wasmPath);
  writePeFixture(exePath);
  writeJavaArchiveFixture(jarPath);
  writeJavaClassFixture(classPath);
  writeJavaFlightRecorderFixture(jfrPath);
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
  writeText(graphmlPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
    '  <key id="label" for="node" attr.name="runtimeLabel" attr.type="string"/>',
    '  <key id="secret" for="edge" attr.name="edgeToken" attr.type="string"/>',
    '  <graph id="RuntimeGraph" edgedefault="directed">',
    '    <node id="Runtime"><data key="label">Runtime node</data></node>',
    '    <node id="Review"><data key="label">Review node</data></node>',
    '    <edge id="runtime-edge" source="Runtime" target="Review"><data key="secret">secret-graphml-token</data></edge>',
    '  </graph>',
    "</graphml>",
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
  writeText(rdpPath, [
    "screen mode id:i:2",
    "desktopwidth:i:1920",
    "desktopheight:i:1080",
    "session bpp:i:32",
    "full address:s:rdp.runtime.example.test",
    "alternate full address:s:rdp-alt.runtime.example.test",
    "username:s:RUNTIME\\fixture-user",
    "gatewayhostname:s:gateway.runtime.example.test?token=secret-rdp-gateway-token",
    "gatewayusagemethod:i:2",
    "authentication level:i:2",
    "prompt for credentials:i:1",
    "enablecredsspsupport:i:1",
    "redirectclipboard:i:1",
    "redirectdrives:i:1",
    "drivestoredirect:s:*",
    "alternate shell:s:C:\\Runtime\\remote-app.exe",
    "password 51:b:secret-rdp-password-blob",
  ].join("\n"));
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
  writeText(prismaPath, [
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    '}',
    '',
    'model RuntimeOrg {',
    '  id    Int @id @default(autoincrement())',
    '  name  String @unique',
    '  users RuntimeUser[]',
    '}',
    '',
    'model RuntimeUser {',
    '  id     Int @id @default(autoincrement())',
    '  email  String @unique',
    '  orgId  Int',
    '  org    RuntimeOrg @relation(fields: [orgId], references: [id])',
    '  token  String? @default("secret-prisma-token")',
    '}',
    '',
    'enum RuntimeRole { ADMIN VIEWER }',
  ].join("\n"));
  writeText(dbmlPath, [
    'Table runtime_orgs {',
    '  id int [pk]',
    '  name varchar [unique]',
    '}',
    '',
    'Table runtime_users {',
    '  id int [pk]',
    '  org_id int [ref: > runtime_orgs.id]',
    '  email varchar [unique]',
    '  api_token varchar [note: "secret-dbml-token"]',
    '}',
    '',
    'Enum runtime_role { admin viewer }',
    'Ref: runtime_users.org_id > runtime_orgs.id',
  ].join("\n"));
  writeText(jsonSchemaPath, JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://schema.example.test/runtime.schema.json?token=secret-schema-id-token",
    title: "Runtime Import Payload",
    type: "object",
    required: ["id", "email"],
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string", format: "email" },
      status: { enum: ["queued", "running", "done"], default: "secret-schema-default" },
      profile: { $ref: "#/$defs/profile" },
      apiToken: { type: "string", pattern: "secret-schema-pattern" },
    },
    $defs: {
      profile: {
        type: "object",
        properties: {
          displayName: { type: "string", examples: ["secret-schema-example"] },
        },
      },
    },
  }, null, 2));
  writeFileSync(redisRdbPath, Buffer.concat([
    Buffer.from("REDIS0009", "ascii"),
    Buffer.from([0xfa, 0x09]),
    Buffer.from("redis-ver", "utf8"),
    Buffer.from([0x06]),
    Buffer.from("7.2.4", "utf8"),
    Buffer.from([0xfe, 0x00, 0xfb, 0x02, 0x00]),
    Buffer.from("runtime:user:1", "utf8"),
    Buffer.from([0x00]),
    Buffer.from("secret-rdb-token", "utf8"),
    Buffer.from([0xff]),
  ]));
  writeText(redisAofPath, [
    "*2\r\n$6\r\nSELECT\r\n$1\r\n0\r\n",
    "*3\r\n$3\r\nSET\r\n$14\r\nruntime:user:1\r\n$23\r\nsecret-redis-aof-token\r\n",
    "*3\r\n$5\r\nHSET\r\n$17\r\nruntime:profile:1\r\n$5\r\nemail\r\n",
    "*2\r\n$4\r\nAUTH\r\n$22\r\nsecret-auth-credential\r\n",
  ].join(""));
  writeText(systemdServicePath, [
    "[Unit]",
    "Description=Runtime scheduler service",
    "Documentation=https://example.test/runbook?token=secret-systemd-url-token",
    "",
    "[Service]",
    "Type=simple",
    "User=drsai",
    "WorkingDirectory=/srv/runtime",
    "ExecStart=/usr/bin/node /srv/runtime/worker.js --api-key secret-systemd-token",
    "ExecReload=/bin/kill -HUP $MAINPID",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n"));
  writeText(cronSchedulePath, [
    "SHELL=/bin/bash",
    "MAILTO=ops@example.test",
    "*/15 * * * * /usr/local/bin/runtime-sync --token secret-cron-token",
    "@daily /usr/local/bin/runtime-cleanup --mode safe",
  ].join("\n"));
  writeText(wireguardConfigPath, [
    "[Interface]",
    "Address = 10.44.0.2/32, fd00:44::2/128",
    "PrivateKey = secret-wireguard-private-key-material",
    "DNS = 1.1.1.1, 2606:4700:4700::1111",
    "PostUp = powershell.exe -NoProfile -Command Invoke-WebRequest https://vpn.example.test/hook?token=secret-wg-hook",
    "",
    "[Peer]",
    "PublicKey = RuntimePeerPublicKeyBase64Value000000000000000=",
    "PresharedKey = secret-wireguard-psk-material",
    "AllowedIPs = 0.0.0.0/0, ::/0",
    "Endpoint = vpn.example.test:51820",
    "PersistentKeepalive = 25",
  ].join("\n"));
  writeText(openVpnConfigPath, [
    "client",
    "dev tun",
    "proto udp",
    "remote vpn-runtime.example.test 1194",
    "redirect-gateway def1",
    "auth-user-pass secret-openvpn-auth.txt",
    "ca runtime-ca.crt",
    "cert runtime-client.crt",
    "key secret-openvpn-client.key",
    "tls-auth secret-openvpn-ta.key 1",
    "script-security 2",
    "up https://vpn-runtime.example.test/up?token=secret-openvpn-url-token",
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
  writeText(terminalRecordingPath, [
    JSON.stringify({ version: 2, width: 100, height: 30, duration: 2.4, command: "pwsh -NoProfile" }),
    JSON.stringify([0.1, "o", "\u001b[32mPS C:\\repo> npm run verify -- --token=secret-cast-token\u001b[0m\r\n"]),
    JSON.stringify([0.8, "o", "Runtime terminal output warning: provider retry token=secret-cast-output\r\n"]),
    JSON.stringify([1.2, "i", "git status\r"]),
    JSON.stringify([1.6, "r", "120x40"]),
    JSON.stringify([2.0, "o", "fatal: Runtime terminal failed with access denied\r\n"]),
    "not-json",
  ].join("\n"));
  writeText(powershellTranscriptPath, [
    "**********************",
    "Windows PowerShell transcript start",
    "Start time: 20260711103001",
    "Username: DESKTOP-RUNTIME\\runner",
    "RunAs User: DESKTOP-RUNTIME\\runner",
    "Host Application: powershell.exe -NoProfile -ExecutionPolicy Bypass",
    "Process ID: 4242",
    "PSVersion: 5.1.22621.1",
    "**********************",
    "PS C:\\repo> npm run verify:channel-adapters -- --token=secret-transcript-token",
    "Channel adapter verification warning: retrying runtime fixture",
    "PS C:\\repo> git status --short",
    "fatal: access denied token=secret-transcript-output",
    "At line:1 char:1",
    "+ Invoke-RestMethod https://api.example.test/run?token=secret-transcript-url",
    "+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "CategoryInfo          : SecurityError: (:) [], UnauthorizedAccessException",
    "**********************",
    "Windows PowerShell transcript end",
    "End time: 20260711103009",
    "**********************",
  ].join("\n"));
  writeText(logMonitorRuntimePath, [
    "INFO runtime monitor started",
    "WARN retrying connector snapshot import token=secret-log-monitor-token",
    "ERROR provider returned retryable status",
  ].join("\n"));
  writeText(logMonitorConfigPath, JSON.stringify({
    retention: {
      retentionDays: 14,
      maxBytes: 1048576,
      maxFiles: 8,
      action: "review-only",
    },
    logs: [
      {
        path: "runtime-monitor.log",
        label: "Runtime retention log",
      },
    ],
  }, null, 2));
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
  writeText(netlogPath, JSON.stringify({
    constants: {
      logEventTypes: {
        URL_REQUEST_START_JOB: 1,
        HTTP_TRANSACTION_SEND_REQUEST_HEADERS: 2,
        SSL_CONNECT_JOB_CONNECT: 3,
      },
      logSourceType: {
        URL_REQUEST: 1,
        SOCKET: 2,
      },
      logEventPhase: {
        PHASE_BEGIN: 0,
        PHASE_END: 1,
      },
    },
    events: [
      {
        time: "1783598400123",
        type: 1,
        phase: 0,
        source: { id: 7, type: 1 },
        params: {
          url: "https://api.example.test/netlog?token=secret-netlog-token",
          method: "GET",
          load_flags: 0,
        },
      },
      {
        time: "1783598400456",
        type: 2,
        phase: 1,
        source: { id: 7, type: 1 },
        params: {
          headers: ["authorization: Bearer secret-netlog-token", "accept: application/json"],
          host: "api.example.test",
        },
      },
      {
        time: "1783598400500",
        type: 3,
        phase: 1,
        source: { id: 8, type: 2 },
        params: {
          net_error: -101,
          remote_endpoint: "203.0.113.10:443",
        },
      },
    ],
  }, null, 2));
  writeText(otelPath, JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "checkout-api" } },
            { key: "deployment.environment", value: { stringValue: "staging" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "runtime-fixture" },
            spans: [
              {
                traceId: "0af7651916cd43dd8448eb211c80319c",
                spanId: "b7ad6b7169203331",
                name: "POST /checkout",
                kind: "SPAN_KIND_SERVER",
                status: { code: "STATUS_CODE_ERROR" },
                attributes: [
                  { key: "http.route", value: { stringValue: "/checkout" } },
                  { key: "authorization", value: { stringValue: "Bearer secret-otel-token" } },
                ],
              },
            ],
          },
        ],
      },
    ],
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                severityText: "ERROR",
                body: { stringValue: "payment provider failed token=secret-otel-token" },
                attributes: [{ key: "error.type", value: { stringValue: "ProviderTimeout" } }],
              },
            ],
          },
        ],
      },
    ],
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name: "checkout.latency",
                unit: "ms",
                histogram: { dataPoints: [] },
              },
            ],
          },
        ],
      },
    ],
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
  writeText(cpuProfilePath, JSON.stringify({
    startTime: 1000,
    endTime: 250000,
    nodes: [
      { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: 0 }, hitCount: 0 },
      { id: 2, callFrame: { functionName: "RuntimeMain", url: "file:///workspace/src/runtime.ts?token=secret-profile-token", lineNumber: 42 }, hitCount: 7 },
      { id: 3, callFrame: { functionName: "renderWidget", url: "webpack://runtime/widget.ts", lineNumber: 12 }, hitCount: 3 },
    ],
    samples: [2, 2, 3],
    timeDeltas: [1000, 2000, 3000],
  }, null, 2));
  writeText(heapSnapshotPath, JSON.stringify({
    snapshot: {
      meta: {
        node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id"],
        node_types: [["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native", "synthetic"]],
      },
      node_count: 3,
      edge_count: 2,
      trace_function_count: 1,
    },
    nodes: [9, 1, 1, 0, 0, 0],
    edges: [1, 2],
    strings: ["", "RuntimeHeapRoot", "RuntimeLeakCandidate", "https://example.test?token=secret-heap-token"],
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
  writeAvroFixture(avroPath);
  writeText(avroSchemaPath, JSON.stringify({
    type: "record",
    name: "RuntimeSchemaEvent",
    namespace: "org.opendrsai.runtime",
    aliases: ["RuntimeEventAlias"],
    doc: "Runtime schema fixture token=secret-avsc-doc",
    fields: [
      { name: "runtime_id", type: "string", doc: "Stable runtime identifier" },
      { name: "metric_value", type: ["null", "double"], default: null },
      { name: "created_at", type: { type: "long", logicalType: "timestamp-millis" } },
      {
        name: "labels",
        type: {
          type: "map",
          values: "string",
        },
        default: {
          secret_label: "secret-avsc-default",
        },
      },
    ],
  }, null, 2));
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
  writeText(bookmarksJsonPath, JSON.stringify({
    checksum: "runtime-bookmarks-checksum",
    roots: {
      bookmark_bar: {
        type: "folder",
        name: "Runtime JSON Bar",
        children: [
          {
            type: "url",
            name: "Runtime JSON Docs",
            url: "https://json-bookmarks.example.test/docs?token=secret-json-bookmark-token",
            date_added: "13323456789000000",
          },
        ],
      },
      other: {
        type: "folder",
        name: "Runtime JSON Other",
        children: [
          {
            type: "url",
            name: "Runtime JSON API",
            url: "https://api.json-bookmarks.example.test/reference?api_key=secret-json-bookmark-key",
          },
        ],
      },
    },
  }, null, 2));
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
  writeText(desktopEntryPath, [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Runtime Desktop Launcher",
    "GenericName=Runtime Tool",
    "Comment=Launches runtime fixture with secret-comment-token",
    "Exec=sh -c \"curl https://desktop.example.test/install?token=secret-desktop-token && /opt/runtime/bin/fixture --api-key=secret-desktop-key\"",
    "Icon=runtime-fixture",
    "Terminal=false",
    "Categories=Development;Utility;",
    "MimeType=text/plain;application/json;",
    "Actions=OpenRuntime;Diagnostics;",
    "[Desktop Action Diagnostics]",
    "Name=Diagnostics",
    "Exec=/opt/runtime/bin/diagnostics --token=secret-diagnostics-token",
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
  writeText(jsonFeedPath, JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: "Runtime JSON Feed",
    home_page_url: "https://feeds.example.test/json",
    feed_url: "https://feeds.example.test/feed.json?token=secret-jsonfeed-token",
    authors: [{ name: "Runtime JSON Author", url: "https://authors.example.test/runtime" }],
    items: [
      {
        id: "runtime-json-1",
        title: "Runtime JSON Feed Item",
        url: "https://feeds.example.test/json/1?token=secret-jsonfeed-token",
        date_published: "2026-07-10T09:00:00Z",
        content_html: "<p>body token=secret-jsonfeed-body-token</p>",
      },
    ],
  }, null, 2));
  writeText(lottieAnimationPath, JSON.stringify({
    v: "5.12.2",
    fr: 30,
    ip: 0,
    op: 90,
    w: 640,
    h: 360,
    nm: "Runtime Lottie Animation",
    assets: [
      {
        id: "image_0",
        w: 128,
        h: 128,
        u: "images/",
        p: "runtime-logo.png?token=secret-lottie-token",
      },
    ],
    layers: [
      { ind: 1, ty: 4, nm: "Runtime Shape Layer", ip: 0, op: 90 },
      { ind: 2, ty: 2, nm: "Runtime Image Layer", refId: "image_0", ip: 10, op: 80 },
      { ind: 3, ty: 5, nm: "Runtime Text Layer", ip: 20, op: 70 },
    ],
    markers: [
      { cm: "Runtime intro", tm: 0, dr: 30 },
      { cm: "Runtime outro token=secret-lottie-marker", tm: 60, dr: 30 },
    ],
  }, null, 2));
  writeDotLottieFixture(dotLottiePath);
  writeText(sourceMapPath, JSON.stringify({
    version: 3,
    file: "runtime.bundle.js",
    sourceRoot: "webpack://runtime-app/?token=secret-sourcemap-root",
    sources: [
      "webpack://runtime-app/src/runtime.ts?token=secret-sourcemap-source",
      "../shared/runtime-helper.ts",
    ],
    names: ["RuntimeView", "secretSourceMapName", "renderRuntime"],
    mappings: "AAAA,SAASA,WAAW,CAACC,IAAI;AACzBC,MAAM,CAACC,GAAG",
    sourcesContent: [
      "const secretSourceMapContent = 'secret-sourcemap-content';",
      "export const runtimeHelper = true;",
    ],
  }, null, 2));
  writeText(opmlPath, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "<head>",
    "<title>Runtime Feed Subscriptions</title>",
    "<ownerName>Runtime Reader</ownerName>",
    "</head>",
    "<body>",
    '<outline text="Engineering" title="Engineering">',
    '<outline text="Runtime OPML Feed" type="rss" xmlUrl="https://feeds.example.test/opml.xml?token=secret-opml-token" htmlUrl="https://feeds.example.test/opml" />',
    "</outline>",
    "</body>",
    "</opml>",
  ].join("\n"));
  writeText(robotsPath, [
    "User-agent: *",
    "Disallow: /private",
    "Allow: /public",
    "Crawl-delay: 5",
    "Sitemap: https://example.test/sitemap.xml?token=secret-robots-token",
  ].join("\n"));
  writeText(securityTxtPath, [
    "Contact: mailto:security@example.test",
    "Contact: https://security.example.test/report?token=secret-security-token",
    "Expires: 2026-12-31T23:59:59Z",
    "Encryption: https://security.example.test/pgp-key.txt",
    "Acknowledgments: https://security.example.test/thanks",
    "Preferred-Languages: en, zh",
    "Canonical: https://example.test/.well-known/security.txt",
    "Policy: https://example.test/security-policy",
    "Hiring: https://example.test/security-jobs",
    "Unrecognized: should-stay-bounded",
  ].join("\n"));
  writeText(assetLinksPath, JSON.stringify([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "ai.drsai.runtime",
        sha256_cert_fingerprints: [
          "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
        ],
      },
    },
  ], null, 2));
  writeText(appleAssociationPath, JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: ["ABCDE12345.ai.drsai.runtime"],
          paths: ["/chat/*", "/handoff/runtime?token=secret-aasa-token"],
          components: [
            { "/": "/chat/*", comment: "Runtime chat handoff" },
            { "/": "/admin/*", exclude: true, comment: "Excluded admin path" },
          ],
        },
      ],
    },
    webcredentials: {
      apps: ["ABCDE12345.ai.drsai.runtime"],
    },
    activitycontinuation: {
      apps: ["ABCDE12345.ai.drsai.runtime"],
    },
  }, null, 2));
  writeText(llmsPath, [
    "# Runtime LLM Site Guide",
    "",
    "## Docs",
    "- [Runtime API](https://llms.example.test/api?token=secret-llms-token)",
    "- [Runtime Guide](https://llms.example.test/guide)",
    "",
    "## Optional",
    "Optional: include changelog links only after review",
    "",
    "## Full context",
    "Full context: see llms-full.txt after explicit review",
  ].join("\n"));
  writeText(browserExtensionManifestPath, JSON.stringify({
    manifest_version: 3,
    name: "Runtime Browser Extension",
    short_name: "RuntimeExt",
    version: "1.2.3",
    description: "Runtime extension fixture",
    permissions: ["tabs", "storage", "scripting", "declarativeNetRequest"],
    host_permissions: ["https://extension.example.test/*", "https://api.extension.example.test/path?token=secret-extension-token"],
    optional_permissions: ["cookies"],
    background: {
      service_worker: "background.js",
    },
    action: {
      default_title: "Runtime Extension Action",
      default_popup: "popup.html",
    },
    content_scripts: [
      {
        matches: ["https://content.extension.example.test/*"],
        js: ["content.js"],
        css: ["content.css"],
      },
    ],
    commands: {
      "runtime-command": {
        suggested_key: { default: "Ctrl+Shift+Y" },
        description: "Run runtime command",
      },
    },
    web_accessible_resources: [
      {
        resources: ["assets/runtime.js"],
        matches: ["https://extension.example.test/*"],
      },
    ],
  }, null, 2));
  writeText(browserExtensionInventoryPath, JSON.stringify({
    browser: "Chrome",
    profile: "Runtime profile export",
    extensions: [
      {
        id: "abcdefghijklmnopabcdefghijklmnop",
        name: "Runtime Extension Inventory",
        version: "1.2.3",
        enabled: true,
        installType: "normal",
        source: "https://clients2.google.com/service/update2/crx?token=secret-extension-inventory-token",
        permissions: ["tabs", "storage", "cookies"],
        host_permissions: ["https://inventory.example.test/*?api_key=secret-extension-inventory-key"],
        manifest: {
          background: { service_worker: "background.js" },
          content_scripts: [{ matches: ["https://inventory.example.test/*"], js: ["content.js"] }],
        },
      },
      {
        id: "disabledruntimeextension0000000001",
        name: "Disabled Runtime Extension",
        version: "0.9.0",
        enabled: false,
        install_type: "policy",
        source: "policy",
        permissions: ["declarativeNetRequest"],
      },
    ],
  }, null, 2));
  writeText(browserCookiesPath, [
    "# Netscape HTTP Cookie File",
    ".example.test\tTRUE\t/\tTRUE\t2147483647\tsessionid\tsecret-cookie-session",
    "#HttpOnly_api.example.test\tFALSE\t/api\tTRUE\t0\tauth_token\tsecret-cookie-token",
    "static.example.test\tFALSE\t/assets\tFALSE\t1\tlegacy_pref\tsecret-cookie-legacy",
  ].join("\n"));
  writeText(hyphenatedBrowserCookiesPath, [
    "# Netscape HTTP Cookie File",
    ".hyphen.example.test\tTRUE\t/\tTRUE\t2147483647\thyphen_session\tsecret-hyphen-cookie-session",
    "#HttpOnly_api.hyphen.example.test\tFALSE\t/api\tTRUE\t0\thyphen_auth\tsecret-hyphen-cookie-auth",
  ].join("\n"));
  writeText(browserPasswordsPath, [
    "name,url,username,password,note",
    "Runtime Login,https://login.passwords.example.test/sign-in?token=secret-password-url-token,runtime-user@example.test,secret-password-value,primary login",
    "Admin Login,https://admin.passwords.example.test/,admin-user,secret-admin-password,admin password token=secret-password-note-token",
  ].join("\n"));
  writeText(browserAutofillCsvPath, [
    "origin,form,field name,type,value",
    "https://checkout.autofill.example.test,checkout,email,email,secret-autofill-email@example.test",
    "https://checkout.autofill.example.test,checkout,cc-number,payment,4111111111111111",
  ].join("\n"));
  writeText(browserAutofillJsonPath, JSON.stringify({
    forms: [
      {
        origin: "https://profile.autofill.example.test",
        formName: "profile",
        fields: [
          { name: "given-name", type: "text", value: "secret-autofill-name" },
          { name: "phone", type: "tel", value: "secret-autofill-phone" },
        ],
      },
    ],
  }, null, 2));
  writeText(browserHistoryCsvPath, [
    "url,title,visit count,typed count,last visit time",
    "https://history.example.test/runtime?token=secret-history-token,Runtime History,4,1,2026-07-10T09:00:00Z",
    "https://docs.history.example.test/page?session=secret-history-session,Docs History,2,0,17835984000000000",
  ].join("\n"));
  writeText(browserHistoryJsonPath, JSON.stringify({
    history: [
      {
        url: "https://json-history.example.test/runtime?api_key=secret-json-history-key",
        title: "JSON Runtime History",
        visitCount: 3,
        typedCount: 1,
        lastVisitTime: "2026-07-10T10:00:00Z",
      },
    ],
  }, null, 2));
  writeBrowserHistorySqliteFixture(browserHistorySqlitePath);
  writeText(browserDownloadsCsvPath, [
    "url,file name,state,danger,referrer,received bytes,total bytes,start time,end time",
    "https://downloads.example.test/artifact.zip?token=secret-download-token,C:\\Users\\tester\\Downloads\\artifact.zip,complete,not dangerous,https://downloads.example.test/start?session=secret-download-session,1024,4096,2026-07-10T11:00:00Z,2026-07-10T11:01:00Z",
    "https://cdn.downloads.example.test/report.pdf?api_key=secret-download-key,C:\\Users\\tester\\Downloads\\report.pdf,interrupted,file blocked,,2048,8192,17835984600000000,17835985200000000",
  ].join("\n"));
  writeText(browserDownloadsJsonPath, JSON.stringify({
    downloads: [
      {
        url: "https://json-downloads.example.test/runtime.exe?token=secret-json-download-token",
        targetPath: "C:\\Users\\tester\\Downloads\\runtime.exe",
        state: "complete",
        danger: "accepted",
        referrer: "https://json-downloads.example.test/list?auth=secret-json-download-auth",
        receivedBytes: 512,
        totalBytes: 512,
        startTime: "2026-07-10T12:00:00Z",
        endTime: "2026-07-10T12:00:05Z",
      },
    ],
  }, null, 2));
  writeBrowserDownloadsSqliteFixture(browserDownloadsSqlitePath);
  writeText(browserPreferencesPath, JSON.stringify({
    profile: {
      name: "Runtime Profile",
      avatar_name: "Runtime Avatar",
      content_settings: {
        exceptions: {
          cookies: {
            "https://prefs.example.test,*": { setting: 1 },
          },
          geolocation: {
            "https://maps.prefs.example.test,*": { setting: 2 },
          },
        },
      },
    },
    default_search_provider: {
      name: "Runtime Search",
      keyword: "runtime",
      search_url: "https://search.prefs.example.test/?q={searchTerms}&token=secret-preferences-token",
      suggest_url: "https://suggest.prefs.example.test/?q={searchTerms}&api_key=secret-preferences-key",
    },
    homepage: "https://home.prefs.example.test/start?session=secret-preferences-session",
    session: {
      restore_on_startup_urls: [
        "https://startup.prefs.example.test/dashboard?token=secret-preferences-startup",
      ],
    },
    download: {
      default_directory: "C:\\Users\\tester\\Downloads\\runtime-preferences",
      prompt_for_download: true,
    },
    extensions: {
      settings: {
        "runtime-extension-id": {
          state: 1,
          manifest: {
            name: "Runtime Preferences Extension",
          },
        },
      },
    },
    password_manager: {
      enabled: false,
      apiToken: "secret-preferences-password-token",
    },
    safebrowsing: {
      enabled: true,
    },
  }, null, 2));
  writeText(browserLocalStoragePath, JSON.stringify({
    "https://storage.example.test": {
      localStorage: {
        theme: "dark",
        apiToken: "secret-local-storage-token",
        runtimeState: JSON.stringify({ selected: "inbox", token: "secret-nested-storage-token" }),
      },
    },
  }, null, 2));
  writeText(browserSessionStoragePath, JSON.stringify({
    entries: [
      {
        origin: "https://session-storage.example.test/app",
        storageArea: "sessionStorage",
        key: "csrfToken",
        value: "secret-session-storage-token",
      },
      {
        origin: "https://session-storage.example.test/app",
        storageArea: "sessionStorage",
        key: "wizardStep",
        value: "confirm",
      },
    ],
  }, null, 2));
  writeText(browserSessionTabsPath, JSON.stringify({
    windows: [
      {
        windowId: "window-1",
        tabs: [
          {
            title: "Runtime Inbox",
            url: "https://tabs.example.test/inbox?token=secret-tab-token",
            active: true,
            pinned: true,
            audible: false,
            discarded: false,
            groupTitle: "Runtime Work",
            openerUrl: "https://opener.tabs.example.test/start?session=secret-tab-opener",
            referrerUrl: "https://referrer.tabs.example.test/path?auth=secret-tab-referrer",
            lastAccessedAt: "2026-07-10T13:00:00Z",
          },
          {
            title: "Runtime Docs",
            url: "https://docs.tabs.example.test/page?api_key=secret-tab-key",
            active: false,
            pinned: false,
            audible: true,
            discarded: true,
            groupTitle: "Runtime Research",
            incognito: true,
          },
        ],
      },
    ],
  }, null, 2));
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
  const warcText = [
    "WARC/1.1",
    "WARC-Type: warcinfo",
    "WARC-Date: 2026-07-12T09:00:00Z",
    "WARC-Record-ID: <urn:uuid:runtime-warc-info>",
    "Content-Type: application/warc-fields",
    "Content-Length: 24",
    "",
    "software: OpenDrSai",
    "",
    "WARC/1.1",
    "WARC-Type: response",
    "WARC-Target-URI: https://archive.example.test/page?token=secret-warc-token",
    "WARC-Date: 2026-07-12T09:01:00Z",
    "WARC-Record-ID: <urn:uuid:runtime-warc-response>",
    "Content-Type: application/http; msgtype=response",
    "Content-Length: 92",
    "",
    "HTTP/1.1 200 OK",
    "Content-Type: text/html",
    "",
    "<html><body>secret-warc-body-token</body></html>",
  ].join("\r\n");
  writeText(warcPath, warcText);
  writeFileSync(warcGzipPath, gzipSync(Buffer.from(warcText, "utf8")));
  writeText(pwaManifestPath, JSON.stringify({
    name: "Runtime PWA Fixture",
    short_name: "RuntimePWA",
    id: "/app/?token=secret-pwa-id-token",
    start_url: "/app/?token=secret-pwa-start-token",
    scope: "/app/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#1f6feb",
    background_color: "#ffffff",
    categories: ["productivity", "developer"],
    icons: [
      {
        src: "/icons/runtime-192.png?token=secret-pwa-icon-token",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: "Open Runtime Inbox",
        url: "/app/inbox?token=secret-pwa-shortcut-token",
      },
    ],
    screenshots: [
      {
        src: "/screens/runtime-wide.png?token=secret-pwa-screenshot-token",
        sizes: "1280x720",
        form_factor: "wide",
      },
    ],
    share_target: {
      action: "/share?token=secret-pwa-share-token",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
    protocol_handlers: [
      {
        protocol: "web+runtime",
        url: "/protocol?url=%s&token=secret-pwa-protocol-token",
      },
    ],
    file_handlers: [
      {
        action: "/open-file?token=secret-pwa-file-token",
        accept: {
          "text/plain": [".txt"],
        },
      },
    ],
  }, null, 2));
  writeText(pwaServiceWorkerPath, [
    "importScripts('/workbox-v7.js?token=secret-sw-import-token');",
    "const CACHE_NAME = 'runtime-cache-v1';",
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/index.html', '/offline.html?token=secret-sw-cache-token'])));",
    "  self.skipWaiting();",
    "});",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil(self.registration.navigationPreload.enable());",
    "});",
    "self.addEventListener('fetch', (event) => {",
    "  event.respondWith(fetch(event.request));",
    "});",
    "self.addEventListener('push', (event) => {",
    "  event.waitUntil(self.registration.showNotification('Runtime alert token=secret-sw-notification-token'));",
    "});",
    "registerRoute(({ request }) => request.destination === 'image', new StaleWhileRevalidate());",
  ].join("\n"));
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
  writeText(androidStringsPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    '  <string name="app_name">Runtime Fixture</string>',
    '  <string name="api_token">secret-android-resource-token</string>',
    '  <color name="brand_primary">#0A84FF</color>',
    '  <bool name="feature_chat_enabled">true</bool>',
    '  <string-array name="quick_actions">',
    "    <item>Plan</item>",
    "    <item>Review</item>",
    "  </string-array>",
    "</resources>",
  ].join("\n"));
  writeText(androidNetworkSecurityPath, [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<network-security-config>",
    '  <base-config cleartextTrafficPermitted="false">',
    '    <trust-anchors><certificates src="system" /></trust-anchors>',
    "  </base-config>",
    '  <domain-config cleartextTrafficPermitted="true">',
    '    <domain includeSubdomains="true">api.opendrsai.test</domain>',
    '    <trust-anchors><certificates src="@raw/runtime_ca" overridePins="true" /></trust-anchors>',
    "  </domain-config>",
    "</network-security-config>",
  ].join("\n"));
  writeText(androidLogcatPath, [
    "--------- beginning of main",
    "07-11 10:05:03.125  1234  1234 I ActivityTaskManager: START u0 {act=android.intent.action.MAIN cmp=org.opendrsai.runtime/.MainActivity}",
    "07-11 10:05:04.222  1234  1300 W NetworkMonitor: token=secret-logcat-token connection retry for api.example.test",
    "07-11 10:05:05.333  2222  2225 E AndroidRuntime: Runtime crash diagnostic token=secret-crash-token",
    "D/DrSaiMobile( 3333): brief format message token=secret-brief-token",
  ].join("\n"));
  writeText(appleUnifiedLogPath, [
    "Timestamp                       Thread     Type        Activity             PID    Process             Subsystem:Category",
    "2026-07-12 10:15:03.123456+0800 0x12345    Default     0x0                  4242   DrSaiMobile         org.opendrsai.mobile:Sync token=secret-oslog-token sync started",
    "2026-07-12 10:15:04.654321+0800 0x12346    Error       0x0                  4242   DrSaiMobile         org.opendrsai.mobile:Network request failed token=secret-network-token",
    "2026-07-12 10:15:05.000000+0800 0x12347    Fault       0x0                  999    diagnosticd         com.apple.diagnostic:Crash Runtime fault token=secret-fault-token",
    "Jul 12 10:15:06 Runtime-iPhone SpringBoard[101]: activation info token=secret-syslog-token",
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
  writeText(appleCrashPath, [
    "Process:               RuntimeFixture [4242]",
    "Identifier:            org.opendrsai.runtime.ios",
    "Version:               2.3.4 (234)",
    "Code Type:             ARM-64 (Native)",
    "Date/Time:             2026-07-12 10:25:00.000 +0800",
    "OS Version:            iPhone OS 17.5 (21F79)",
    "Report Version:        104",
    "Exception Type:        EXC_BAD_ACCESS (SIGSEGV)",
    "Exception Codes:       KERN_INVALID_ADDRESS at 0x0000000100000000 token=secret-crash-token",
    "Termination Reason:    Namespace SIGNAL, Code 11 Segmentation fault",
    "Crashed Thread:        0  Dispatch queue: com.apple.main-thread",
    "",
    "Thread 0 Crashed:",
    "0   RuntimeFixture              0x0000000100012340 RuntimeCrashEntry + 64",
    "1   RuntimeKit                  0x0000000100056780 RuntimeWorker.run(token=secret-frame-token) + 128",
    "2   UIKitCore                   0x0000000190000000 UIApplicationMain + 340",
    "",
    "Binary Images:",
    "0x100000000 - 0x1000fffff RuntimeFixture arm64  <ABCDEF01-2345-6789-ABCD-EF0123456789> /private/var/containers/Bundle/Application/secret-path-token/RuntimeFixture.app/RuntimeFixture",
    "0x100500000 - 0x1005fffff RuntimeKit arm64  <ABCDEF01-2345-6789-ABCD-EF0123456790> /private/var/containers/Bundle/Application/runtime/RuntimeKit.framework/RuntimeKit",
  ].join("\n"));
  writeText(appleIpsPath, JSON.stringify({
    app_name: "RuntimeFixture",
    bundleID: "org.opendrsai.runtime.ips",
    incident: "runtime-incident-001",
    timestamp: "2026-07-12 10:30:00.000 +0800",
    os_version: "macOS 15.5 (24F74)",
    exception: {
      type: "EXC_CRASH",
      signal: "SIGABRT",
      codes: "0x0000000000000000 token=secret-ips-token",
    },
    termination: {
      namespace: "SIGNAL",
      code: 6,
      reason: "Abort trap secret-ips-reason-token",
    },
    faultingThread: 0,
    threads: [
      {
        triggered: true,
        frames: [
          { image: "RuntimeFixture", symbol: "RuntimeAbortEntry", sourceFile: "/Users/tester/project/secret-source-token/main.swift" },
          { image: "RuntimeKit", symbol: "RuntimeWorker.run", sourceFile: "/Users/tester/project/RuntimeWorker.swift" },
        ],
      },
    ],
    usedImages: [
      { name: "RuntimeFixture", base: "0x100000000", path: "/Applications/RuntimeFixture.app/Contents/MacOS/RuntimeFixture" },
      { name: "RuntimeKit", base: "0x100500000", path: "/Applications/RuntimeFixture.app/Contents/Frameworks/RuntimeKit.framework/RuntimeKit" },
    ],
  }));
  writeMobileAppPackageFixture(apkPath, "apk");
  writeMobileAppPackageFixture(aabPath, "aab");
  writeMobileAppPackageFixture(ipaPath, "ipa");
  writeText(supervisorConfigPath, [
    "[supervisord]",
    "logfile=/var/log/supervisor/runtime.log",
    "childlogdir=/var/log/supervisor",
    "",
    "[program:runtime-worker]",
    "command=/usr/local/bin/runtime-worker --token secret-supervisor-token --url https://ops.example.test/run?token=secret-supervisor-url-token",
    "directory=/srv/runtime",
    "user=runtime",
    "autostart=true",
    "autorestart=unexpected",
    "environment=RUNTIME_TOKEN=\"secret-supervisor-env-token\",RUNTIME_MODE=\"fixture\"",
    "stdout_logfile=/var/log/supervisor/runtime-worker.out.log",
    "",
    "[group:runtime]",
    "programs=runtime-worker",
    "",
    "[include]",
    "files=/etc/supervisor/conf.d/*.conf",
  ].join("\n"));
  writeText(texPath, [
    "\\documentclass[11pt]{article}",
    "\\usepackage{amsmath,graphicx}",
    "\\addbibresource{references.bib}",
    "\\title{Runtime LaTeX Fixture}",
    "\\begin{document}",
    "\\section{Runtime Method}\\label{sec:runtime}",
    "We cite \\cite{runtime2026,secretCitationToken} and reference \\ref{eq:runtime}.",
    "\\begin{equation}\\label{eq:runtime}",
    "E = mc^2",
    "\\end{equation}",
    "\\includegraphics{figures/runtime-plot.png}",
    "\\input{sections/results}",
    "% token=secret-latex-comment-token",
    "\\end{document}",
  ].join("\n"));
  writeText(bibPath, [
    "@article{runtime2026,",
    "  author = {Ada Reviewer and Grace Builder},",
    "  title = {Runtime Fixture for Local LaTeX Context},",
    "  year = {2026},",
    "  note = {token=secret-bib-token}",
    "}",
  ].join("\n"));
  writeText(latexmkrcPath, [
    "$pdf_mode = 1;",
    "$pdflatex = 'pdflatex -interaction=nonstopmode %O %S';",
    "$bibtex = 'bibtex %O %B';",
    "$api_token = 'secret-latexmk-token';",
  ].join("\n"));
  writeWavFixture(wavPath);
  writeMp3Fixture(mp3Path);
  writeAacFixture(aacPath);
  writeFlacFixture(flacPath);
  writeM4aFixture(m4aPath);
  writeOggFixture(oggPath);
  writePngColorProfileFixture(pngColorPath);
  writeJpegColorProfileFixture(jpegColorPath);
  writeGifAnimationFixture(gifAnimationPath);
  writeWebpAnimationFixture(webpAnimationPath);
  writeText(svgStructurePath, [
    '<svg width="120" height="80" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">',
    "  <title>Runtime SVG Map</title>",
    "  <desc>Workspace-local structure preview</desc>",
    '  <symbol id="runtime-icon"><path id="runtime-path" d="M1 1 L10 10" /></symbol>',
    '  <use href="#runtime-icon" />',
    '  <image id="runtime-remote-image" href="https://svg.example.test/pixel.png?token=secret-svg-token" width="10" height="10" />',
    '  <foreignObject id="runtime-foreign"><div xmlns="http://www.w3.org/1999/xhtml">Runtime HTML Island</div></foreignObject>',
    '  <script>console.log("secret-svg-script-token")</script>',
    '  <text id="runtime-label">Runtime SVG Label</text>',
    "</svg>",
  ].join("\n"));

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
      gradleVersionCatalogPath,
      mavenConfigPath,
      mavenSettingsPath,
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
    result.items.length === 14,
    `expected 14 imported runtime fixture items, got ${result.items.length}: ${result.items.map((item) => item.title).join(", ")}`,
  );
  assert(result.truncated === false, "runtime fixture import should not be truncated");
  assert(
    result.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "runtime fixture import lost read-only verification copy",
  );

  const constraintsRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      constraintsPath,
    ],
    limit: 2,
  });

  assert(
    constraintsRuntimeResult.items.length === 1,
    `expected 1 imported constraints runtime fixture item, got ${constraintsRuntimeResult.items.length}: ${constraintsRuntimeResult.items.map((item) => item.title).join(", ")}`,
  );
  assert(constraintsRuntimeResult.truncated === false, "constraints runtime fixture import should not be truncated");
  assert(
    constraintsRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "constraints runtime fixture import lost read-only verification copy",
  );

  const jfrRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      jfrPath,
    ],
    limit: 2,
  });

  assert(jfrRuntimeResult.items.length === 1, `expected 1 imported JFR runtime fixture item, got ${jfrRuntimeResult.items.length}`);
  assert(jfrRuntimeResult.truncated === false, "JFR runtime fixture import should not be truncated");
  assert(
    jfrRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "JFR runtime fixture import lost read-only verification copy",
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
      denoLockPath,
      bunLockPath,
      cargoLockPath,
      goSumPath,
    ],
    limit: 8,
  });

  assert(lockfileResult.items.length === 7, `expected 7 imported dependency lockfile runtime fixture items, got ${lockfileResult.items.length}`);
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

  const latexRuntimeResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      texPath,
      bibPath,
      latexmkrcPath,
    ],
    limit: 3,
  });

  assert(latexRuntimeResult.items.length === 3, `expected 3 imported LaTeX runtime fixture items, got ${latexRuntimeResult.items.length}`);
  assert(latexRuntimeResult.truncated === false, "LaTeX runtime fixture import should not be truncated");
  assert(
    latexRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "LaTeX runtime fixture import lost read-only verification copy",
  );

  const repositoryGovernanceResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      codeownersPath,
      editorconfigPath,
      gitattributesPath,
      gitignorePath,
      gitmodulesPath,
      mailmapPath,
      licensePath,
      noticePath,
    ],
    limit: 9,
  });

  assert(repositoryGovernanceResult.items.length === 8, `expected 8 imported repository governance runtime fixture items, got ${repositoryGovernanceResult.items.length}`);
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
      envrcPath,
      regexPatternPath,
    ],
    limit: 3,
  });

  assert(configRuntimeResult.items.length === 3, `expected 3 imported config runtime fixture items, got ${configRuntimeResult.items.length}`);
  assert(configRuntimeResult.truncated === false, ".env config runtime fixture import should not be truncated");
  assert(
    configRuntimeResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    ".env config runtime fixture import lost read-only verification copy",
  );

  const sshConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      sshConfigPath,
      knownHostsPath,
      authorizedKeysPath,
    ],
    limit: 3,
  });

  assert(sshConfigResult.items.length === 3, `expected 3 imported SSH config runtime fixture items, got ${sshConfigResult.items.length}`);
  assert(sshConfigResult.truncated === false, "SSH config runtime fixture import should not be truncated");
  assert(
    sshConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "SSH config runtime fixture import lost read-only verification copy",
  );

  const mcpConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      mcpServersPath,
    ],
    limit: 2,
  });

  assert(mcpConfigResult.items.length === 1, `expected 1 imported MCP server config runtime fixture item, got ${mcpConfigResult.items.length}`);
  assert(mcpConfigResult.truncated === false, "MCP server config runtime fixture import should not be truncated");
  assert(
    mcpConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "MCP server config runtime fixture import lost read-only verification copy",
  );

  const vscodeConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      vscodeSettingsPath,
      vscodeTasksPath,
      vscodeLaunchPath,
      vscodeExtensionsPath,
    ],
    limit: 4,
  });

  assert(vscodeConfigResult.items.length === 4, `expected 4 imported VS Code config runtime fixture items, got ${vscodeConfigResult.items.length}`);
  assert(vscodeConfigResult.truncated === false, "VS Code config runtime fixture import should not be truncated");
  assert(
    vscodeConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "VS Code config runtime fixture import lost read-only verification copy",
  );

  const devcontainerConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      devcontainerPath,
    ],
    limit: 1,
  });

  assert(devcontainerConfigResult.items.length === 1, `expected 1 imported Dev Container config runtime fixture item, got ${devcontainerConfigResult.items.length}`);
  assert(devcontainerConfigResult.truncated === false, "Dev Container config runtime fixture import should not be truncated");
  assert(
    devcontainerConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Dev Container config runtime fixture import lost read-only verification copy",
  );

  const jsToolingConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      eslintConfigPath,
      prettierConfigPath,
      biomeConfigPath,
      cspellConfigPath,
      markdownlintConfigPath,
      typedocConfigPath,
      knipConfigPath,
      vitestConfigPath,
      playwrightConfigPath,
      viteConfigPath,
      rollupConfigPath,
      tsupConfigPath,
    ],
    limit: 12,
  });

  assert(jsToolingConfigResult.items.length === 12, `expected 12 imported JS/TS tooling config runtime fixture items, got ${jsToolingConfigResult.items.length}`);
  assert(jsToolingConfigResult.truncated === false, "JS/TS tooling config runtime fixture import should not be truncated");
  assert(
    jsToolingConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "JS/TS tooling config runtime fixture import lost read-only verification copy",
  );

  const pythonToolingConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      ruffConfigPath,
      pyprojectRuffConfigPath,
    ],
    limit: 2,
  });

  assert(pythonToolingConfigResult.items.length === 2, `expected 2 imported Python tooling config runtime fixture items, got ${pythonToolingConfigResult.items.length}`);
  assert(pythonToolingConfigResult.truncated === false, "Python tooling config runtime fixture import should not be truncated");
  assert(
    pythonToolingConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Python tooling config runtime fixture import lost read-only verification copy",
  );

  const jsWorkspaceConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      pnpmWorkspacePath,
      turboConfigPath,
      nxConfigPath,
    ],
    limit: 3,
  });

  assert(jsWorkspaceConfigResult.items.length === 3, `expected 3 imported JS/TS workspace config runtime fixture items, got ${jsWorkspaceConfigResult.items.length}`);
  assert(jsWorkspaceConfigResult.truncated === false, "JS/TS workspace config runtime fixture import should not be truncated");
  assert(
    jsWorkspaceConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "JS/TS workspace config runtime fixture import lost read-only verification copy",
  );

  const ciWorkflowResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      githubActionsPath,
      githubActionsJobSummaryPath,
      gitlabCiPath,
      azurePipelinesPath,
      bitbucketPipelinesPath,
      circleCiConfigPath,
      buildkitePipelinePath,
    ],
    limit: 7,
  });

  assert(ciWorkflowResult.items.length === 7, `expected 7 imported CI/CD workflow runtime fixture items, got ${ciWorkflowResult.items.length}`);
  assert(ciWorkflowResult.truncated === false, "CI/CD workflow runtime fixture import should not be truncated");
  assert(
    ciWorkflowResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "CI/CD workflow runtime fixture import lost read-only verification copy",
  );

  const githubTemplateResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [githubIssueFormPath, githubPullRequestTemplatePath],
    limit: 2,
  });

  assert(githubTemplateResult.items.length === 2, `expected 2 imported GitHub template runtime fixture items, got ${githubTemplateResult.items.length}`);
  assert(githubTemplateResult.truncated === false, "GitHub template runtime fixture import should not be truncated");
  assert(
    githubTemplateResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "GitHub template runtime fixture import lost read-only verification copy",
  );

  const dependabotConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [dependabotPath],
    limit: 1,
  });

  assert(dependabotConfigResult.items.length === 1, `expected 1 imported Dependabot config runtime fixture item, got ${dependabotConfigResult.items.length}`);
  assert(dependabotConfigResult.truncated === false, "Dependabot config runtime fixture import should not be truncated");
  assert(
    dependabotConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Dependabot config runtime fixture import lost read-only verification copy",
  );

  const preCommitConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [preCommitPath],
    limit: 1,
  });

  assert(preCommitConfigResult.items.length === 1, `expected 1 imported pre-commit config runtime fixture item, got ${preCommitConfigResult.items.length}`);
  assert(preCommitConfigResult.truncated === false, "pre-commit config runtime fixture import should not be truncated");
  assert(
    preCommitConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "pre-commit config runtime fixture import lost read-only verification copy",
  );

  const renovateConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [renovatePath],
    limit: 1,
  });

  assert(renovateConfigResult.items.length === 1, `expected 1 imported Renovate config runtime fixture item, got ${renovateConfigResult.items.length}`);
  assert(renovateConfigResult.truncated === false, "Renovate config runtime fixture import should not be truncated");
  assert(
    renovateConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Renovate config runtime fixture import lost read-only verification copy",
  );

  const testReportResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      junitPath,
      robotPath,
      jmeterPlanPath,
      jmeterXmlPath,
      jmeterCsvPath,
      nunitPath,
      xunitPath,
      trxPath,
      tapPath,
      playwrightJsonPath,
      cypressJsonPath,
      mochaJsonPath,
      allureJsonPath,
      checkstylePath,
    ],
    limit: 14,
  });

  assert(testReportResult.items.length === 14, `expected 14 imported runtime test/static report fixture items, got ${testReportResult.items.length}`);
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
      istanbulCoveragePath,
      istanbulCoverageSummaryPath,
      cloverPath,
      jacocoPath,
    ],
    limit: 7,
  });

  assert(coverageReportResult.items.length === 6, `expected 6 imported coverage runtime fixture items, got ${coverageReportResult.items.length}`);
  assert(coverageReportResult.truncated === false, "coverage runtime fixture import should not be truncated");
  assert(
    coverageReportResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "coverage runtime fixture import lost read-only verification copy",
  );

  const chatExportResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      slackExportPath,
      slackCsvExportPath,
      teamsExportPath,
      discordExportPath,
      chatgptConversationsPath,
      claudeConversationsPath,
    ],
    limit: 6,
  });

  assert(chatExportResult.items.length === 6, `expected 6 imported chat export runtime fixture items, got ${chatExportResult.items.length}`);
  assert(chatExportResult.truncated === false, "chat export runtime fixture import should not be truncated");
  assert(
    chatExportResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "chat export runtime fixture import lost read-only verification copy",
  );

  const documentArchiveResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      pdfPath,
      zipPath,
      playwrightTraceZipPath,
      stlPath,
    ],
    limit: 8,
  });

  assert(documentArchiveResult.items.length === 4, `expected 4 imported document/archive runtime fixture items, got ${documentArchiveResult.items.length}`);
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
      bazelBuildPath,
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

  assert(packageManifestResult.items.length === 12, `expected 12 imported package/config runtime fixture items, got ${packageManifestResult.items.length}`);
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
      yarnClassicPath,
      pnpmfilePath,
      npmignorePath,
      commitlintPath,
      lintStagedPath,
      jvmConfigPath,
      pubspecLockPath,
    ],
    limit: 10,
  });

  assert(packageConfigVariantResult.items.length === 8, `expected 8 imported package/config variant runtime fixture items, got ${packageConfigVariantResult.items.length}`);
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
      pypircPath,
    ],
    limit: 8,
  });

  assert(pythonManifestResult.items.length === 5, `expected 5 imported Python dependency/runtime config fixture items, got ${pythonManifestResult.items.length}`);
  assert(pythonManifestResult.truncated === false, "Python dependency runtime fixture import should not be truncated");
  assert(
    pythonManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Python dependency runtime fixture import lost read-only verification copy",
  );

  const appleManifestVariantResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      packageSwiftPath,
      podfilePath,
      podfileLockPath,
      pbxprojPath,
      podspecPath,
    ],
    limit: 8,
  });

  assert(appleManifestVariantResult.items.length === 5, `expected 5 imported Apple package runtime fixture items, got ${appleManifestVariantResult.items.length}`);
  assert(appleManifestVariantResult.truncated === false, "Apple package runtime fixture import should not be truncated");
  assert(
    appleManifestVariantResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Apple package runtime fixture import lost read-only verification copy",
  );

  const personalInfoResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      emlPath,
      emlxPath,
      mboxPath,
      telegramExportPath,
      whatsappExportPath,
      meetingTranscriptPath,
      vcardPath,
      contactsCsvPath,
      icsPath,
      icalPath,
      vcsPath,
      calendarCsvPath,
    ],
    limit: 12,
  });

  assert(personalInfoResult.items.length === 12, `expected 12 imported personal-info runtime fixture items, got ${personalInfoResult.items.length}`);
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
      graphqlIntrospectionPath,
      pactContractPath,
      restClientPath,
      restClientRestPath,
      protoPath,
      dockerfilePath,
      composePath,
      wingetManifestPath,
      chartPath,
      helmValuesPath,
      kustomizationPath,
      kubeconfigPath,
    ],
    limit: 17,
  });

  assert(apiSchemaContainerResult.items.length === 17, `expected 17 imported API/schema/container runtime fixture items, got ${apiSchemaContainerResult.items.length}`);
  assert(apiSchemaContainerResult.truncated === false, "API/schema/container runtime fixture import should not be truncated");
  assert(
    apiSchemaContainerResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "API/schema/container runtime fixture import lost read-only verification copy",
  );

  const insomniaYamlResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [insomniaYamlPath],
    limit: 1,
  });

  assert(insomniaYamlResult.items.length === 1, `expected 1 imported Insomnia YAML runtime fixture item, got ${insomniaYamlResult.items.length}`);
  assert(insomniaYamlResult.truncated === false, "Insomnia YAML runtime fixture import should not be truncated");
  assert(
    insomniaYamlResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Insomnia YAML runtime fixture import lost read-only verification copy",
  );

  const asyncApiResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      asyncApiPath,
    ],
    limit: 2,
  });

  assert(asyncApiResult.items.length === 1, `expected 1 imported AsyncAPI runtime fixture item, got ${asyncApiResult.items.length}`);
  assert(asyncApiResult.truncated === false, "AsyncAPI runtime fixture import should not be truncated");

  const asyncApiJsonResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      asyncApiJsonPath,
    ],
    limit: 2,
  });

  assert(asyncApiJsonResult.items.length === 1, `expected 1 imported AsyncAPI JSON runtime fixture item, got ${asyncApiJsonResult.items.length}`);
  assert(asyncApiJsonResult.truncated === false, "AsyncAPI JSON runtime fixture import should not be truncated");
  assert(
    asyncApiJsonResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "AsyncAPI JSON runtime fixture import lost read-only verification copy",
  );

  const openApiJsonResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      openApiJsonPath,
    ],
    limit: 2,
  });

  assert(openApiJsonResult.items.length === 1, `expected 1 imported OpenAPI JSON runtime fixture item, got ${openApiJsonResult.items.length}`);
  assert(openApiJsonResult.truncated === false, "OpenAPI JSON runtime fixture import should not be truncated");
  assert(
    openApiJsonResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "OpenAPI JSON runtime fixture import lost read-only verification copy",
  );

  const kubernetesManifestResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      kubernetesManifestPath,
    ],
    limit: 2,
  });

  assert(kubernetesManifestResult.items.length === 1, `expected 1 imported Kubernetes manifest runtime fixture item, got ${kubernetesManifestResult.items.length}`);
  assert(kubernetesManifestResult.truncated === false, "Kubernetes manifest runtime fixture import should not be truncated");
  assert(
    kubernetesManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Kubernetes manifest runtime fixture import lost read-only verification copy",
  );

  const iisWebConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      iisWebConfigPath,
      iisApplicationHostConfigPath,
    ],
    limit: 3,
  });

  assert(iisWebConfigResult.items.length === 2, `expected 2 imported IIS config runtime fixture items, got ${iisWebConfigResult.items.length}`);
  assert(iisWebConfigResult.truncated === false, "IIS web.config runtime fixture import should not be truncated");
  assert(
    iisWebConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "IIS web.config runtime fixture import lost read-only verification copy",
  );

  const webServerConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      nginxConfigPath,
      apacheVhostConfigPath,
      htaccessConfigPath,
    ],
    limit: 3,
  });

  assert(webServerConfigResult.items.length === 3, `expected 3 imported web server config runtime fixture items, got ${webServerConfigResult.items.length}`);
  assert(webServerConfigResult.truncated === false, "Nginx web server config runtime fixture import should not be truncated");
  assert(
    webServerConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Nginx web server config runtime fixture import lost read-only verification copy",
  );

  const securityArtifactResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      sarifPath,
      sarifJsonPath,
      securityAuditPath,
      cyclonedxPath,
      spdxPath,
      syftPath,
      pemPath,
      keepassPath,
      checksumPath,
      wasmPath,
      exePath,
      jarPath,
      classPath,
    ],
    limit: 13,
  });

  assert(securityArtifactResult.items.length === 13, `expected 13 imported security/SBOM/binary runtime fixture items, got ${securityArtifactResult.items.length}`);
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
      graphmlPath,
      scssPath,
    ],
    limit: 12,
  });

  assert(opsDesignResult.items.length === 12, `expected 12 imported ops/design runtime fixture items, got ${opsDesignResult.items.length}`);
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
      rdpPath,
      regPath,
      wprpPath,
      dmpPath,
    ],
    limit: 8,
  });

  assert(windowsNativeResult.items.length === 6, `expected 6 imported Windows-native runtime fixture items, got ${windowsNativeResult.items.length}`);
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
      avroPath,
      avroSchemaPath,
    ],
    limit: 14,
  });

  assert(dataNetworkResult.items.length === 14, `expected 14 imported data/network runtime fixture items, got ${dataNetworkResult.items.length}`);
  assert(dataNetworkResult.truncated === false, "data/network runtime fixture import should not be truncated");
  assert(
    dataNetworkResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "data/network runtime fixture import lost read-only verification copy",
  );

  const terminalRecordingResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [terminalRecordingPath, powershellTranscriptPath],
    limit: 2,
  });

  assert(terminalRecordingResult.items.length === 2, `expected 2 imported terminal execution-log runtime fixture items, got ${terminalRecordingResult.items.length}`);
  assert(terminalRecordingResult.truncated === false, "terminal execution-log runtime fixture import should not be truncated");
  assert(
    terminalRecordingResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "terminal execution-log runtime fixture import lost read-only verification copy",
  );

  const logMonitorResult = adapters.importChannelContext({
    adapterId: "logs-monitor",
    workspacePath: workspace,
    limit: 2,
  });

  assert(logMonitorResult.items.length === 1, `expected 1 imported log monitor runtime fixture item, got ${logMonitorResult.items.length}`);
  assert(logMonitorResult.truncated === false, "log monitor runtime fixture import should not be truncated");
  assert(
    logMonitorResult.verification.includes("durable cursor"),
    "log monitor runtime fixture import lost durable cursor verification copy",
  );

  const databaseSchemaDslResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      prismaPath,
      dbmlPath,
    ],
    limit: 2,
  });

  assert(databaseSchemaDslResult.items.length === 2, `expected 2 imported database schema DSL runtime fixture items, got ${databaseSchemaDslResult.items.length}`);
  assert(databaseSchemaDslResult.truncated === false, "database schema DSL runtime fixture import should not be truncated");
  assert(
    databaseSchemaDslResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "database schema DSL runtime fixture import lost read-only verification copy",
  );

  const jsonSchemaResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [jsonSchemaPath],
    limit: 1,
  });

  assert(jsonSchemaResult.items.length === 1, `expected 1 imported JSON Schema runtime fixture item, got ${jsonSchemaResult.items.length}`);
  assert(jsonSchemaResult.truncated === false, "JSON Schema runtime fixture import should not be truncated");
  assert(
    jsonSchemaResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "JSON Schema runtime fixture import lost read-only verification copy",
  );

  const devtoolsProfileResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      cpuProfilePath,
      heapSnapshotPath,
    ],
    limit: 2,
  });

  assert(devtoolsProfileResult.items.length === 2, `expected 2 imported DevTools/V8 profile runtime fixture items, got ${devtoolsProfileResult.items.length}`);
  assert(devtoolsProfileResult.truncated === false, "DevTools/V8 profile runtime fixture import should not be truncated");
  assert(
    devtoolsProfileResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "DevTools/V8 profile runtime fixture import lost read-only verification copy",
  );

  const redisPersistenceResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      redisRdbPath,
      redisAofPath,
    ],
    limit: 2,
  });

  assert(redisPersistenceResult.items.length === 2, `expected 2 imported Redis persistence runtime fixture items, got ${redisPersistenceResult.items.length}`);
  assert(redisPersistenceResult.truncated === false, "Redis persistence runtime fixture import should not be truncated");
  assert(
    redisPersistenceResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Redis persistence runtime fixture import lost read-only verification copy",
  );

  const opsScheduleResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      systemdServicePath,
      cronSchedulePath,
      supervisorConfigPath,
      hostsPath,
    ],
    limit: 4,
  });

  assert(opsScheduleResult.items.length === 4, `expected 4 imported ops schedule/runtime config fixture items, got ${opsScheduleResult.items.length}`);
  assert(opsScheduleResult.truncated === false, "ops schedule runtime fixture import should not be truncated");
  assert(
    opsScheduleResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "ops schedule runtime fixture import lost read-only verification copy",
  );

  const vpnConfigResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      wireguardConfigPath,
      openVpnConfigPath,
    ],
    limit: 2,
  });

  assert(vpnConfigResult.items.length === 2, `expected 2 imported VPN config runtime fixture items, got ${vpnConfigResult.items.length}`);
  assert(vpnConfigResult.truncated === false, "VPN config runtime fixture import should not be truncated");
  assert(
    vpnConfigResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "VPN config runtime fixture import lost read-only verification copy",
  );

  const netlogResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [netlogPath],
    limit: 1,
  });

  assert(netlogResult.items.length === 1, `expected 1 imported NetLog runtime fixture item, got ${netlogResult.items.length}`);
  assert(netlogResult.truncated === false, "NetLog runtime fixture import should not be truncated");
  assert(
    netlogResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "NetLog runtime fixture import lost read-only verification copy",
  );

  const otelResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [otelPath],
    limit: 1,
  });

  assert(otelResult.items.length === 1, `expected 1 imported OpenTelemetry runtime fixture item, got ${otelResult.items.length}`);
  assert(otelResult.truncated === false, "OpenTelemetry runtime fixture import should not be truncated");
  assert(
    otelResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "OpenTelemetry runtime fixture import lost read-only verification copy",
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
      bookmarksJsonPath,
      urlShortcutPath,
      weblocPath,
      desktopEntryPath,
      rssPath,
      atomPath,
      jsonFeedPath,
      robotsPath,
      securityTxtPath,
      assetLinksPath,
      appleAssociationPath,
      llmsPath,
      sitemapPath,
      sitemapGzipPath,
      warcPath,
      warcGzipPath,
      pwaManifestPath,
      pwaServiceWorkerPath,
      srtPath,
      vttPath,
    ],
    limit: 23,
  });

  assert(contentMediaResult.items.length === 23, `expected 23 imported content/media runtime fixture items, got ${contentMediaResult.items.length}`);
  assert(contentMediaResult.truncated === false, "content/media runtime fixture import should not be truncated");
  assert(
    contentMediaResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "content/media runtime fixture import lost read-only verification copy",
  );

  const lottieAnimationResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [lottieAnimationPath],
    limit: 1,
  });

  assert(lottieAnimationResult.items.length === 1, `expected 1 imported Lottie animation runtime fixture item, got ${lottieAnimationResult.items.length}`);
  assert(lottieAnimationResult.truncated === false, "Lottie animation runtime fixture import should not be truncated");
  assert(
    lottieAnimationResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "Lottie animation runtime fixture import lost read-only verification copy",
  );
  const lottieSummary = summaryFor(lottieAnimationResult, "animation.json");
  assert(lottieSummary.includes("Lottie/Bodymovin animation JSON preview"), "animation.json did not use Lottie animation JSON preview");
  assert(lottieSummary.includes("5.12.2") && lottieSummary.includes("640x360") && lottieSummary.includes("30 fps"), "animation.json summary omitted version/canvas/frame-rate evidence");
  assert(lottieSummary.includes("90 frames") && lottieSummary.includes("3.00s"), "animation.json summary omitted duration evidence");
  assert(lottieSummary.includes("Runtime Shape Layer") && lottieSummary.includes("Runtime Image Layer") && lottieSummary.includes("type=shape"), "animation.json summary omitted layer evidence");
  assert(lottieSummary.includes("image_0") && lottieSummary.includes("[redacted]") && !lottieSummary.includes("secret-lottie-token"), "animation.json summary omitted asset redaction evidence");
  assert(lottieSummary.includes("Runtime intro") && !lottieSummary.includes("secret-lottie-marker"), "animation.json summary omitted marker redaction evidence");
  assert(lottieSummary.includes("no renderer, After Effects/Bodymovin tool, script execution, frame extraction"), "animation.json summary omitted no-runtime safety copy");
  assert(lottieAnimationResult.items[0].mime === "application/vnd.lottie+json", "animation.json did not preserve Lottie MIME provenance");

  const dotLottieResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [dotLottiePath],
    limit: 1,
  });

  assert(dotLottieResult.items.length === 1, `expected 1 imported dotLottie runtime fixture item, got ${dotLottieResult.items.length}`);
  assert(dotLottieResult.truncated === false, "dotLottie runtime fixture import should not be truncated");
  assert(
    dotLottieResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "dotLottie runtime fixture import lost read-only verification copy",
  );
  const dotLottieSummary = summaryFor(dotLottieResult, "runtime.lottie");
  assert(dotLottieSummary.includes("dotLottie archive preview"), "runtime.lottie did not use dotLottie archive preview");
  assert(dotLottieSummary.includes("OpenDrSai runtime fixture") && dotLottieSummary.includes("Runtime Animator"), "runtime.lottie summary omitted manifest metadata");
  assert(dotLottieSummary.includes("runtime-main") && dotLottieSummary.includes("loop=true") && dotLottieSummary.includes("autoplay=false"), "runtime.lottie summary omitted manifest animation evidence");
  assert(dotLottieSummary.includes("animations/runtime-main.json") && dotLottieSummary.includes("320x180") && dotLottieSummary.includes("24fps"), "runtime.lottie summary omitted animation JSON evidence");
  assert(dotLottieSummary.includes("themes/runtime-theme.json") && dotLottieSummary.includes("images/runtime.png") && dotLottieSummary.includes("state_machines/runtime-machine.json"), "runtime.lottie summary omitted theme/image/state-machine evidence");
  assert(!dotLottieSummary.includes("secret-dotlottie-keyframe") && !dotLottieSummary.includes("secret-dotlottie-asset"), "runtime.lottie summary leaked animation entry secrets");
  assert(dotLottieSummary.includes("archive entries were not extracted to disk") && dotLottieSummary.includes("no renderer, animation playback, frame extraction"), "runtime.lottie summary omitted no-extraction/no-runtime safety copy");
  assert(dotLottieResult.items[0].mime === "application/vnd.lottie+zip", "runtime.lottie did not preserve dotLottie MIME provenance");

  const sourceMapResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [sourceMapPath],
    limit: 1,
  });

  assert(sourceMapResult.items.length === 1, `expected 1 imported source map runtime fixture item, got ${sourceMapResult.items.length}`);
  assert(sourceMapResult.truncated === false, "source map runtime fixture import should not be truncated");
  assert(
    sourceMapResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "source map runtime fixture import lost read-only verification copy",
  );
  const sourceMapSummary = summaryFor(sourceMapResult, "runtime.js.map");
  assert(sourceMapSummary.includes("Source map JSON preview"), "runtime.js.map did not use source map JSON preview");
  assert(sourceMapSummary.includes("Version: 3") && sourceMapSummary.includes("runtime.bundle.js"), "runtime.js.map summary omitted version or target evidence");
  assert(sourceMapSummary.includes("webpack://runtime-app/?token="), "runtime.js.map summary omitted sourceRoot redaction evidence");
  assert(sourceMapSummary.includes("runtime-helper.ts") && sourceMapSummary.includes("RuntimeView"), "runtime.js.map summary omitted source/name samples");
  assert(sourceMapSummary.includes("Static source correlation hints"), "runtime.js.map summary omitted static source correlation hints");
  assert(sourceMapSummary.includes("target .js") && sourceMapSummary.includes("sourceRoot webpack URL"), "runtime.js.map summary omitted target/sourceRoot correlation evidence");
  assert(sourceMapSummary.includes("source extensions .ts=2") && sourceMapSummary.includes("sourcesContent coverage 2/2"), "runtime.js.map summary omitted source extension or sourcesContent coverage evidence");
  assert(sourceMapSummary.includes("sourcesContent entries: 2 (contents not expanded)"), "runtime.js.map summary omitted sourcesContent non-expansion evidence");
  assert(!sourceMapSummary.includes("secret-sourcemap-root") && !sourceMapSummary.includes("secret-sourcemap-source") && !sourceMapSummary.includes("secret-sourcemap-content"), "runtime.js.map summary leaked source map secrets or source content");
  assert(sourceMapSummary.includes("mappings were not decoded") && sourceMapSummary.includes("no bundler/devtool/browser"), "runtime.js.map summary omitted no-decode/no-runtime safety copy");
  assert(sourceMapResult.items[0].mime === "application/vnd.drsai.source-map+json", "runtime.js.map did not preserve source map MIME provenance");

  const browserCookiesResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserCookiesPath, hyphenatedBrowserCookiesPath],
    limit: 2,
  });

  assert(browserCookiesResult.items.length === 2, `expected 2 imported browser cookie runtime fixture items, got ${browserCookiesResult.items.length}`);
  assert(browserCookiesResult.truncated === false, "browser cookie runtime fixture import should not be truncated");
  assert(
    browserCookiesResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser cookie runtime fixture import lost read-only verification copy",
  );

  const browserPasswordsResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserPasswordsPath],
    limit: 1,
  });

  assert(browserPasswordsResult.items.length === 1, `expected 1 imported browser password runtime fixture item, got ${browserPasswordsResult.items.length}`);
  assert(browserPasswordsResult.truncated === false, "browser password runtime fixture import should not be truncated");
  assert(
    browserPasswordsResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser password runtime fixture import lost read-only verification copy",
  );

  const browserAutofillResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserAutofillCsvPath, browserAutofillJsonPath],
    limit: 2,
  });

  assert(browserAutofillResult.items.length === 2, `expected 2 imported browser autofill runtime fixture items, got ${browserAutofillResult.items.length}`);
  assert(browserAutofillResult.truncated === false, "browser autofill runtime fixture import should not be truncated");
  assert(
    browserAutofillResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser autofill runtime fixture import lost read-only verification copy",
  );

  const browserExtensionManifestResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserExtensionManifestPath],
    limit: 1,
  });

  assert(browserExtensionManifestResult.items.length === 1, `expected 1 imported browser extension manifest runtime fixture item, got ${browserExtensionManifestResult.items.length}`);
  assert(browserExtensionManifestResult.truncated === false, "browser extension manifest runtime fixture import should not be truncated");
  assert(
    browserExtensionManifestResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser extension manifest runtime fixture import lost read-only verification copy",
  );

  const browserExtensionInventoryResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserExtensionInventoryPath],
    limit: 1,
  });

  assert(browserExtensionInventoryResult.items.length === 1, `expected 1 imported browser extension inventory runtime fixture item, got ${browserExtensionInventoryResult.items.length}`);
  assert(browserExtensionInventoryResult.truncated === false, "browser extension inventory runtime fixture import should not be truncated");
  assert(
    browserExtensionInventoryResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser extension inventory runtime fixture import lost read-only verification copy",
  );

  const extensionPackageResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [vsixPath, crxPath],
    limit: 2,
  });

  assert(extensionPackageResult.items.length === 2, `expected 2 imported extension package runtime fixture items, got ${extensionPackageResult.items.length}`);
  assert(extensionPackageResult.truncated === false, "extension package runtime fixture import should not be truncated");
  assert(
    extensionPackageResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "extension package runtime fixture import lost read-only verification copy",
  );

  const browserHistoryResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserHistoryCsvPath, browserHistoryJsonPath, browserHistorySqlitePath],
    limit: 3,
  });

  assert(browserHistoryResult.items.length === 3, `expected 3 imported browser history runtime fixture items, got ${browserHistoryResult.items.length}`);
  assert(browserHistoryResult.truncated === false, "browser history runtime fixture import should not be truncated");
  assert(
    browserHistoryResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser history runtime fixture import lost read-only verification copy",
  );

  const browserDownloadsResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserDownloadsCsvPath, browserDownloadsJsonPath, browserDownloadsSqlitePath],
    limit: 3,
  });

  assert(browserDownloadsResult.items.length === 3, `expected 3 imported browser downloads runtime fixture items, got ${browserDownloadsResult.items.length}`);
  assert(browserDownloadsResult.truncated === false, "browser downloads runtime fixture import should not be truncated");
  assert(
    browserDownloadsResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser downloads runtime fixture import lost read-only verification copy",
  );

  const browserPreferencesResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserPreferencesPath],
    limit: 1,
  });

  assert(browserPreferencesResult.items.length === 1, `expected 1 imported browser preferences runtime fixture item, got ${browserPreferencesResult.items.length}`);
  assert(browserPreferencesResult.truncated === false, "browser preferences runtime fixture import should not be truncated");
  assert(
    browserPreferencesResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser preferences runtime fixture import lost read-only verification copy",
  );

  const browserStorageResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserLocalStoragePath, browserSessionStoragePath],
    limit: 2,
  });

  assert(browserStorageResult.items.length === 2, `expected 2 imported browser storage runtime fixture items, got ${browserStorageResult.items.length}`);
  assert(browserStorageResult.truncated === false, "browser storage runtime fixture import should not be truncated");
  assert(
    browserStorageResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser storage runtime fixture import lost read-only verification copy",
  );

  const browserSessionTabsResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [browserSessionTabsPath],
    limit: 1,
  });

  assert(browserSessionTabsResult.items.length === 1, `expected 1 imported browser session tabs runtime fixture item, got ${browserSessionTabsResult.items.length}`);
  assert(browserSessionTabsResult.truncated === false, "browser session tabs runtime fixture import should not be truncated");
  assert(
    browserSessionTabsResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "browser session tabs runtime fixture import lost read-only verification copy",
  );

  const opmlSubscriptionResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [opmlPath],
    limit: 1,
  });

  assert(opmlSubscriptionResult.items.length === 1, `expected 1 imported OPML runtime fixture item, got ${opmlSubscriptionResult.items.length}`);
  assert(opmlSubscriptionResult.truncated === false, "OPML runtime fixture import should not be truncated");
  assert(
    opmlSubscriptionResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "OPML runtime fixture import lost read-only verification copy",
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
      androidStringsPath,
      androidNetworkSecurityPath,
      androidLogcatPath,
      appleUnifiedLogPath,
      infoPlistPath,
      appleCrashPath,
      appleIpsPath,
    ],
    limit: 9,
  });

  assert(mobileManifestResult.items.length === 8, `expected 8 imported mobile manifest runtime fixture items, got ${mobileManifestResult.items.length}`);
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
      wavPath,
      mp3Path,
      aacPath,
      flacPath,
      m4aPath,
      oggPath,
    ],
    limit: 8,
  });

  assert(audioResult.items.length === 6, `expected 6 imported audio runtime fixture items, got ${audioResult.items.length}`);
  assert(audioResult.truncated === false, "audio runtime fixture import should not be truncated");
  assert(
    audioResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "audio runtime fixture import lost read-only verification copy",
  );

  const imageColorResult = adapters.importChannelContext({
    adapterId: "file-input",
    workspacePath: workspace,
    paths: [
      pngColorPath,
      jpegColorPath,
      gifAnimationPath,
      webpAnimationPath,
      svgStructurePath,
    ],
    limit: 6,
  });

  assert(imageColorResult.items.length === 5, `expected 5 imported image color/runtime fixture items, got ${imageColorResult.items.length}`);
  assert(imageColorResult.truncated === false, "image color runtime fixture import should not be truncated");
  assert(
    imageColorResult.verification.includes("Read-only channel import is limited to workspace-local file summaries"),
    "image color runtime fixture import lost read-only verification copy",
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

  const yarnClassicSummary = summaryFor(packageConfigVariantResult, ".yarnrc");
  assert(yarnClassicSummary.includes("Node package-manager config preview"), ".yarnrc did not use Node package-manager config preview");
  assert(yarnClassicSummary.includes("Yarn classic config"), ".yarnrc summary omitted Yarn classic format evidence");
  assert(yarnClassicSummary.includes("cache-folder"), ".yarnrc summary omitted cache setting evidence");
  assert(yarnClassicSummary.includes("[redacted]") && !yarnClassicSummary.includes("secret-yarn-classic-token"), ".yarnrc summary omitted token redaction evidence");
  assert(yarnClassicSummary.includes("no npm, pnpm, Yarn, Bun, node command"), ".yarnrc summary omitted no-package-manager safety copy");

  const pnpmfileSummary = summaryFor(packageConfigVariantResult, ".pnpmfile.cjs");
  assert(pnpmfileSummary.includes("Node package-manager config preview"), ".pnpmfile.cjs did not use Node package-manager config preview");
  assert(pnpmfileSummary.includes("pnpm hook config"), ".pnpmfile.cjs summary omitted pnpm hook format evidence");
  assert(pnpmfileSummary.includes("readPackage") && pnpmfileSummary.includes("afterAllResolved"), ".pnpmfile.cjs summary omitted pnpm hook evidence");
  assert(!pnpmfileSummary.includes("secret-pnpmfile-token"), ".pnpmfile.cjs summary leaked hook token value");
  assert(pnpmfileSummary.includes("no npm, pnpm, Yarn, Bun, node command"), ".pnpmfile.cjs summary omitted no-package-manager safety copy");

  const npmignoreSummary = summaryFor(packageConfigVariantResult, ".npmignore");
  assert(npmignoreSummary.includes("Node package-manager config preview"), ".npmignore did not use Node package-manager config preview");
  assert(npmignoreSummary.includes("npm publish ignore file"), ".npmignore summary omitted publish-ignore format evidence");
  assert(npmignoreSummary.includes("publish ignore pattern") && npmignoreSummary.includes("publish include override"), ".npmignore summary omitted ignore/include pattern evidence");
  assert(npmignoreSummary.includes("no npm, pnpm, Yarn, Bun, node command"), ".npmignore summary omitted no-package-manager safety copy");

  const commitlintSummary = summaryFor(packageConfigVariantResult, ".commitlintrc.json");
  assert(commitlintSummary.includes("JS/TS tooling config preview (Commitlint"), ".commitlintrc.json did not use JS/TS tooling config preview");
  assert(commitlintSummary.includes("parserPreset") && commitlintSummary.includes("defaultIgnores"), ".commitlintrc.json summary omitted Commitlint metadata evidence");
  assert(commitlintSummary.includes("type-enum") && commitlintSummary.includes("scope-empty"), ".commitlintrc.json summary omitted Commitlint rule evidence");
  assert(commitlintSummary.includes("[redacted]") && !commitlintSummary.includes("secret-commitlint"), ".commitlintrc.json summary omitted secret redaction evidence");
  assert(commitlintSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), ".commitlintrc.json summary omitted no-runner safety copy");

  const lintStagedSummary = summaryFor(packageConfigVariantResult, ".lintstagedrc");
  assert(lintStagedSummary.includes("JS/TS tooling config preview (lint-staged"), ".lintstagedrc did not use JS/TS tooling config preview");
  assert(lintStagedSummary.includes("concurrent") && lintStagedSummary.includes("relative") && lintStagedSummary.includes("shell"), ".lintstagedrc summary omitted lint-staged metadata evidence");
  assert(lintStagedSummary.includes("eslint --fix") && lintStagedSummary.includes("[redacted]"), ".lintstagedrc summary omitted command redaction evidence");
  assert(!lintStagedSummary.includes("secret-lint-staged"), ".lintstagedrc summary leaked command secret");
  assert(lintStagedSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), ".lintstagedrc summary omitted no-runner safety copy");

  const mcpConfigSummary = summaryFor(mcpConfigResult, "mcp-servers.json");
  assert(mcpConfigSummary.includes("MCP server configuration preview"), "mcp-servers.json did not use MCP server config preview");
  assert(mcpConfigSummary.includes("Servers declared: 3"), "mcp-servers.json summary omitted server count");
  assert(mcpConfigSummary.includes("filesystem command=node"), "mcp-servers.json summary omitted stdio command evidence");
  assert(mcpConfigSummary.includes("remoteDocs") && mcpConfigSummary.includes("transport=sse"), "mcp-servers.json summary omitted remote transport evidence");
  assert(mcpConfigSummary.includes("MCP_API_TOKEN") && mcpConfigSummary.includes("SAFE_MODE"), "mcp-servers.json summary omitted env key evidence");
  assert(mcpConfigSummary.includes("https://mcp.example.test/sse?token=[redacted]"), "mcp-servers.json summary omitted URL redaction evidence");
  assert(mcpConfigSummary.includes("Local schema hints") && mcpConfigSummary.includes("brokenLegacy: missing command/url"), "mcp-servers.json summary omitted local schema hint evidence");
  assert(mcpConfigSummary.includes("args is not an array") && mcpConfigSummary.includes("env is not an object"), "mcp-servers.json summary omitted MCP schema shape evidence");
  assert(mcpConfigSummary.includes("unknown transport=named-pipe") && mcpConfigSummary.includes("disabled is not boolean"), "mcp-servers.json summary omitted MCP transport/disabled schema evidence");
  assert(!mcpConfigSummary.includes("secret-mcp"), "mcp-servers.json summary leaked MCP secret values");
  assert(mcpConfigSummary.includes("no stdio/server process was started"), "mcp-servers.json summary omitted no-runtime safety copy");

  const vscodeSettingsSummary = summaryFor(vscodeConfigResult, "settings.json");
  assert(vscodeSettingsSummary.includes("VS Code workspace config preview (VS Code settings.json"), "settings.json did not use VS Code config preview");
  assert(vscodeSettingsSummary.includes("editor.formatOnSave") && vscodeSettingsSummary.includes("python.defaultInterpreterPath"), "settings.json summary omitted setting key evidence");
  assert(!vscodeSettingsSummary.includes("secret-vscode-settings-token"), "settings.json summary leaked setting secret value");
  assert(vscodeSettingsSummary.includes("no VS Code process, task/debug launch, extension install"), "settings.json summary omitted no-runtime safety copy");
  assert(vscodeConfigResult.items.find((item) => item.title === "settings.json")?.mime === "application/vnd.code.settings+json", "settings.json MIME provenance is missing");

  const vscodeTasksSummary = summaryFor(vscodeConfigResult, "tasks.json");
  assert(vscodeTasksSummary.includes("VS Code workspace config preview (VS Code tasks.json"), "tasks.json did not use VS Code config preview");
  assert(vscodeTasksSummary.includes("Runtime build task") && vscodeTasksSummary.includes("problemMatcher=$tsc"), "tasks.json summary omitted task/problem matcher evidence");
  assert(vscodeTasksSummary.includes("runtimeTarget type=pickString"), "tasks.json summary omitted input evidence");
  assert(vscodeTasksSummary.includes("token=[redacted]") && !vscodeTasksSummary.includes("secret-vscode-task-token"), "tasks.json summary omitted command redaction evidence");

  const vscodeLaunchSummary = summaryFor(vscodeConfigResult, "launch.json");
  assert(vscodeLaunchSummary.includes("Runtime renderer debug") && vscodeLaunchSummary.includes("type=node"), "launch.json summary omitted debug configuration evidence");
  assert(vscodeLaunchSummary.includes("request=launch"), "launch.json summary omitted request evidence");

  const vscodeExtensionsSummary = summaryFor(vscodeConfigResult, "extensions.json");
  assert(vscodeExtensionsSummary.includes("ms-vscode.vscode-typescript-next"), "extensions.json summary omitted extension recommendation evidence");
  assert(vscodeExtensionsSummary.includes("unwanted:[redacted]"), "extensions.json summary omitted unwanted extension redaction evidence");
  assert(vscodeConfigResult.items.find((item) => item.title === "extensions.json")?.mime === "application/vnd.code.extensions+json", "extensions.json MIME provenance is missing");

  const eslintSummary = summaryFor(jsToolingConfigResult, ".eslintrc.json");
  assert(eslintSummary.includes("JS/TS tooling config preview (ESLint"), ".eslintrc.json did not use JS/TS tooling config preview");
  assert(eslintSummary.includes("extends key") && eslintSummary.includes("rules key"), ".eslintrc.json summary omitted ESLint metadata evidence");
  assert(eslintSummary.includes("no-console") && eslintSummary.includes("@typescript-eslint/no-explicit-any"), ".eslintrc.json summary omitted rule evidence");
  assert(!eslintSummary.includes("secret-eslint-token"), ".eslintrc.json summary leaked sensitive rule value");
  assert(eslintSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), ".eslintrc.json summary omitted no-runner safety copy");
  assert(jsToolingConfigResult.items.every((item) => item.mime === "application/vnd.drsai.js-tooling-config"), "JS/TS tooling config MIME provenance is missing");

  const prettierSummary = summaryFor(jsToolingConfigResult, ".prettierrc.yaml");
  assert(prettierSummary.includes("JS/TS tooling config preview (Prettier"), ".prettierrc.yaml did not use JS/TS tooling config preview");
  assert(prettierSummary.includes("printWidth") && prettierSummary.includes("singleQuote") && prettierSummary.includes("prettier-plugin-tailwindcss"), ".prettierrc.yaml summary omitted formatter metadata evidence");
  assert(!prettierSummary.includes("secret-prettier-token"), ".prettierrc.yaml summary leaked token value");

  const biomeSummary = summaryFor(jsToolingConfigResult, "biome.jsonc");
  assert(biomeSummary.includes("JS/TS tooling config preview (Biome"), "biome.jsonc did not use JS/TS tooling config preview");
  assert(biomeSummary.includes("formatter key") && biomeSummary.includes("linter key"), "biome.jsonc summary omitted Biome key evidence");
  assert(biomeSummary.includes("noDebugger"), "biome.jsonc summary omitted linter rule evidence");
  assert(!biomeSummary.includes("secret-biome-token"), "biome.jsonc summary leaked token value");

  const cspellSummary = summaryFor(jsToolingConfigResult, "cspell.jsonc");
  assert(cspellSummary.includes("JS/TS tooling config preview (CSpell"), "cspell.jsonc did not use JS/TS tooling config preview");
  assert(cspellSummary.includes("words key") && cspellSummary.includes("dictionaries key") && cspellSummary.includes("ignorePaths key"), "cspell.jsonc summary omitted CSpell metadata evidence");
  assert(cspellSummary.includes("OpenDrSai") && cspellSummary.includes("typescript") && cspellSummary.includes("release/**"), "cspell.jsonc summary omitted spell-check word/dictionary/path evidence");
  assert(!cspellSummary.includes("secret-cspell-token"), "cspell.jsonc summary leaked token value");
  assert(cspellSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), "cspell.jsonc summary omitted no-runner safety copy");

  const markdownlintSummary = summaryFor(jsToolingConfigResult, ".markdownlint.json");
  assert(markdownlintSummary.includes("JS/TS tooling config preview (Markdownlint"), ".markdownlint.json did not use JS/TS tooling config preview");
  assert(markdownlintSummary.includes("default key") && markdownlintSummary.includes("MD013 key") && markdownlintSummary.includes("MD033 key"), ".markdownlint.json summary omitted Markdownlint metadata evidence");
  assert(markdownlintSummary.includes("docs/**/*.md") && markdownlintSummary.includes("release/**"), ".markdownlint.json summary omitted Markdownlint glob/ignore evidence");
  assert(!markdownlintSummary.includes("secret-markdownlint-token"), ".markdownlint.json summary leaked token value");
  assert(markdownlintSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), ".markdownlint.json summary omitted no-runner safety copy");

  const typedocSummary = summaryFor(jsToolingConfigResult, "typedoc.json");
  assert(typedocSummary.includes("JS/TS tooling config preview (TypeDoc"), "typedoc.json did not use JS/TS tooling config preview");
  assert(typedocSummary.includes("entryPoints key") && typedocSummary.includes("out key") && typedocSummary.includes("plugin key"), "typedoc.json summary omitted TypeDoc metadata evidence");
  assert(typedocSummary.includes("src/index.ts") && typedocSummary.includes("docs/api") && typedocSummary.includes("typedoc-plugin-markdown"), "typedoc.json summary omitted TypeDoc entry/output/plugin evidence");
  assert(!typedocSummary.includes("secret-typedoc-token"), "typedoc.json summary leaked token value");
  assert(typedocSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), "typedoc.json summary omitted no-runner safety copy");

  const knipSummary = summaryFor(jsToolingConfigResult, "knip.jsonc");
  assert(knipSummary.includes("JS/TS tooling config preview (Knip"), "knip.jsonc did not use JS/TS tooling config preview");
  assert(knipSummary.includes("entry key") && knipSummary.includes("project key") && knipSummary.includes("ignoreDependencies key"), "knip.jsonc summary omitted Knip metadata evidence");
  assert(knipSummary.includes("src/index.ts") && knipSummary.includes("src/**/*.ts") && knipSummary.includes("electron-builder"), "knip.jsonc summary omitted Knip entry/project/binary evidence");
  assert(!knipSummary.includes("secret-knip"), "knip.jsonc summary leaked token value");
  assert(knipSummary.includes("no node/npm/pnpm/Yarn/Bun command, lint/test/format runner"), "knip.jsonc summary omitted no-runner safety copy");

  const ruffSummary = summaryFor(pythonToolingConfigResult, ".ruff.toml");
  assert(ruffSummary.includes("Ruff config preview (.ruff.toml"), ".ruff.toml did not use Ruff config preview");
  assert(ruffSummary.includes("target-version=py311") && ruffSummary.includes("line-length=100"), ".ruff.toml summary omitted Ruff setting evidence");
  assert(ruffSummary.includes("select=E,F,I") && ruffSummary.includes("extend-select=B,UP") && ruffSummary.includes("ignore=E501"), ".ruff.toml summary omitted Ruff rule selector evidence");
  assert(
    ruffSummary.includes("build/**") &&
      ruffSummary.includes("release/**") &&
      ruffSummary.includes("tests/**") &&
      ruffSummary.includes("S101"),
    ".ruff.toml summary omitted Ruff path/per-file evidence",
  );
  assert(ruffSummary.includes("preview enabled"), ".ruff.toml summary omitted Ruff static risk cue evidence");
  assert(!ruffSummary.includes("secret-ruff-token"), ".ruff.toml summary leaked token value");
  assert(ruffSummary.includes("no Python interpreter, Ruff command, formatter/linter execution"), ".ruff.toml summary omitted no-runtime safety copy");
  assert(pythonToolingConfigResult.items.find((item) => item.title === ".ruff.toml")?.mime === "application/vnd.astral-sh.ruff+toml", ".ruff.toml MIME provenance is missing");

  const pyprojectRuffSummary = summaryFor(pythonToolingConfigResult, "pyproject.toml");
  assert(pyprojectRuffSummary.includes("Ruff config preview (pyproject.toml"), "pyproject.toml with [tool.ruff] did not use Ruff config preview");
  assert(pyprojectRuffSummary.includes("pyproject.toml Ruff sections were detected"), "pyproject.toml Ruff summary omitted route evidence");
  assert(pyprojectRuffSummary.includes("tool.ruff") && pyprojectRuffSummary.includes("tool.ruff.lint"), "pyproject.toml Ruff summary omitted tool.ruff section evidence");
  assert(pyprojectRuffSummary.includes("target-version=py312") && pyprojectRuffSummary.includes("line-length=88"), "pyproject.toml Ruff summary omitted setting evidence");
  assert(pyprojectRuffSummary.includes("select=E,F,I,UP") && pyprojectRuffSummary.includes("ignore=E203"), "pyproject.toml Ruff summary omitted rule selector evidence");
  assert(pyprojectRuffSummary.includes("dist/**") && pyprojectRuffSummary.includes("scripts/**") && pyprojectRuffSummary.includes("T201"), "pyproject.toml Ruff summary omitted path/per-file evidence");
  assert(!pyprojectRuffSummary.includes("secret-pyproject-ruff-token"), "pyproject.toml Ruff summary leaked token value");
  assert(pyprojectRuffSummary.includes("no Python interpreter, Ruff command, formatter/linter execution"), "pyproject.toml Ruff summary omitted no-runtime safety copy");
  assert(pythonToolingConfigResult.items.find((item) => item.path === pyprojectRuffConfigPath)?.mime === "application/vnd.astral-sh.ruff+toml", "pyproject.toml Ruff MIME provenance is missing");

  const vitestSummary = summaryFor(jsToolingConfigResult, "vitest.config.ts");
  assert(vitestSummary.includes("JS/TS tooling config preview (Vitest"), "vitest.config.ts did not use JS/TS tooling config preview");
  assert(vitestSummary.includes("environment: 'jsdom'") && vitestSummary.includes("coverage"), "vitest.config.ts summary omitted test environment/coverage evidence");
  assert(vitestSummary.includes("environment-variable reference") && vitestSummary.includes("module import reference"), "vitest.config.ts summary omitted static risk cues");
  assert(vitestSummary.includes("config module import, environment loading, plugin resolution"), "vitest.config.ts summary omitted no-import/no-env safety copy");

  const playwrightSummary = summaryFor(jsToolingConfigResult, "playwright.config.ts");
  assert(playwrightSummary.includes("JS/TS tooling config preview (Playwright"), "playwright.config.ts did not use JS/TS tooling config preview");
  assert(playwrightSummary.includes("project=chromium") && playwrightSummary.includes("project=webkit"), "playwright.config.ts summary omitted project evidence");
  assert(playwrightSummary.includes("webServer declaration") && playwrightSummary.includes("Playwright browser launch"), "playwright.config.ts summary omitted webServer/no-browser evidence");
  assert(playwrightSummary.includes("token=[redacted]") && !playwrightSummary.includes("secret-playwright-token"), "playwright.config.ts summary omitted token redaction evidence");

  const viteSummary = summaryFor(jsToolingConfigResult, "vite.config.ts");
  assert(viteSummary.includes("JS/TS tooling config preview (Vite"), "vite.config.ts did not use JS/TS tooling config preview");
  assert(viteSummary.includes("plugins cue") && viteSummary.includes("server cue") && viteSummary.includes("rollupOptions cue"), "vite.config.ts summary omitted Vite metadata evidence");
  assert(viteSummary.includes("outDir: 'dist'") && viteSummary.includes("sourcemap: true") && viteSummary.includes("port: 5173"), "vite.config.ts summary omitted Vite build/server evidence");
  assert(viteSummary.includes("Vite dev server") && viteSummary.includes("config module import, environment loading, plugin resolution"), "vite.config.ts summary omitted no-dev-server/no-import safety copy");
  assert(!viteSummary.includes("secret-vite-token"), "vite.config.ts summary leaked secret value");

  const rollupSummary = summaryFor(jsToolingConfigResult, "rollup.config.mjs");
  assert(rollupSummary.includes("JS/TS tooling config preview (Rollup"), "rollup.config.mjs did not use JS/TS tooling config preview");
  assert(rollupSummary.includes("input cue") && rollupSummary.includes("output cue") && rollupSummary.includes("external cue"), "rollup.config.mjs summary omitted Rollup metadata evidence");
  assert(rollupSummary.includes("input: 'src/index.ts'") && rollupSummary.includes("format: 'esm'"), "rollup.config.mjs summary omitted Rollup input/output evidence");
  assert(rollupSummary.includes("Rollup/Tsup build") && !rollupSummary.includes("secret-rollup-token"), "rollup.config.mjs summary omitted build boundary or leaked token");

  const tsupSummary = summaryFor(jsToolingConfigResult, "tsup.config.ts");
  assert(tsupSummary.includes("JS/TS tooling config preview (Tsup"), "tsup.config.ts did not use JS/TS tooling config preview");
  assert(tsupSummary.includes("entry cue") && tsupSummary.includes("format cue") && tsupSummary.includes("dts cue"), "tsup.config.ts summary omitted Tsup metadata evidence");
  assert(tsupSummary.includes("target: 'node22'") && tsupSummary.includes("outDir: 'dist'"), "tsup.config.ts summary omitted Tsup target/output evidence");
  assert(tsupSummary.includes("Rollup/Tsup build") && !tsupSummary.includes("secret-tsup-token"), "tsup.config.ts summary omitted build boundary or leaked token value");

  const pnpmWorkspaceSummary = summaryFor(jsWorkspaceConfigResult, "pnpm-workspace.yaml");
  assert(pnpmWorkspaceSummary.includes("JS/TS workspace config preview (pnpm workspace"), "pnpm-workspace.yaml did not use JS/TS workspace config preview");
  assert(pnpmWorkspaceSummary.includes("package pattern apps/*") && pnpmWorkspaceSummary.includes("package pattern packages/*"), "pnpm-workspace.yaml summary omitted package pattern evidence");
  assert(pnpmWorkspaceSummary.includes("catalog key") && pnpmWorkspaceSummary.includes("onlyBuiltDependencies key"), "pnpm-workspace.yaml summary omitted workspace key evidence");
  assert(!pnpmWorkspaceSummary.includes("secret-pnpm-workspace-token"), "pnpm-workspace.yaml summary leaked token value");
  assert(pnpmWorkspaceSummary.includes("no pnpm/npm/Yarn/Bun command, Turbo/Nx runner"), "pnpm-workspace.yaml summary omitted no-runner safety copy");
  assert(jsWorkspaceConfigResult.items.every((item) => item.mime === "application/vnd.drsai.js-workspace-config"), "JS/TS workspace config MIME provenance is missing");

  const turboSummary = summaryFor(jsWorkspaceConfigResult, "turbo.json");
  assert(turboSummary.includes("JS/TS workspace config preview (Turborepo"), "turbo.json did not use JS/TS workspace config preview");
  assert(turboSummary.includes("task build") && turboSummary.includes("task test"), "turbo.json summary omitted task evidence");
  assert(turboSummary.includes("remote-cache declaration") && turboSummary.includes("task graph/cache metadata"), "turbo.json summary omitted remote cache/task graph risk cues");
  assert(!turboSummary.includes("secret-turbo-token"), "turbo.json summary leaked remote cache token");

  const nxSummary = summaryFor(jsWorkspaceConfigResult, "nx.json");
  assert(nxSummary.includes("JS/TS workspace config preview (Nx workspace"), "nx.json did not use JS/TS workspace config preview");
  assert(nxSummary.includes("target default build") && nxSummary.includes("target default test"), "nx.json summary omitted target default evidence");
  assert(nxSummary.includes("plugins:") && nxSummary.includes("@nx/vite/plugin"), "nx.json summary omitted plugin evidence");
  assert(!nxSummary.includes("secret-nx-token"), "nx.json summary leaked access token value");

  const coverageSummary = summaryFor(result, "coverage.xml");
  assert(coverageSummary.includes("Coverage report preview (Cobertura XML"), "coverage.xml did not use Cobertura coverage report preview");
  assert(coverageSummary.includes("75% (3/4)") && coverageSummary.includes("50% (1/2)"), "coverage.xml summary omitted Cobertura line/branch counts");
  assert(coverageSummary.includes("core"), "coverage.xml summary omitted Cobertura package evidence");
  assert(coverageSummary.includes("src/app.ts") && coverageSummary.includes("src/[redacted].ts"), "coverage.xml summary omitted Cobertura file evidence or secret redaction");
  assert(!coverageSummary.includes("secret-token"), "coverage.xml summary leaked secret-like path segment");
  assert(coverageSummary.includes("no test runner, coverage tool"), "coverage.xml summary omitted no-runner safety copy");

  const lcovSummary = summaryFor(coverageReportResult, "lcov.info");
  assert(lcovSummary.includes("Coverage report preview (LCOV"), "lcov.info did not use LCOV coverage report preview");
  assert(lcovSummary.includes("50% (2/4)") && lcovSummary.includes("50% (1/2)"), "lcov.info summary omitted LCOV line/branch coverage counts");
  assert(lcovSummary.includes("src/chatbar/runtime.ts") && lcovSummary.includes("src/chatbar/[redacted].ts"), "lcov.info summary omitted file evidence or secret redaction");
  assert(!lcovSummary.includes("secret-token"), "lcov.info summary leaked secret-like path segment");
  assert(lcovSummary.includes("no test runner, coverage tool"), "lcov.info summary omitted no-runner safety copy");
  const istanbulCoverageSummary = summaryFor(coverageReportResult, "coverage-final.json");
  assert(istanbulCoverageSummary.includes("Coverage report preview (Istanbul JSON"), "coverage-final.json did not use Istanbul JSON coverage report preview");
  assert(istanbulCoverageSummary.includes("50% (2/4)") && istanbulCoverageSummary.includes("75% (3/4)"), "coverage-final.json summary omitted Istanbul statement/branch counts");
  assert(istanbulCoverageSummary.includes("src/chatbar/istanbul.ts") && istanbulCoverageSummary.includes("src/chatbar/[redacted].ts"), "coverage-final.json summary omitted file evidence or secret redaction");
  assert(!istanbulCoverageSummary.includes("secret-token"), "coverage-final.json summary leaked secret-like path segment");
  assert(istanbulCoverageSummary.includes("no test runner, coverage tool"), "coverage-final.json summary omitted no-runner safety copy");
  const istanbulSummaryJson = summaryFor(coverageReportResult, "coverage-summary.json");
  assert(istanbulSummaryJson.includes("Coverage report preview (Istanbul JSON Summary"), "coverage-summary.json did not use Istanbul summary coverage preview");
  assert(istanbulSummaryJson.includes("75% (6/8)") && istanbulSummaryJson.includes("60% (3/5)"), "coverage-summary.json summary omitted total line/branch counts");
  assert(istanbulSummaryJson.includes("src/chatbar/summary.ts") && istanbulSummaryJson.includes("src/chatbar/[redacted].ts"), "coverage-summary.json summary omitted file evidence or secret redaction");
  assert(!istanbulSummaryJson.includes("secret-token"), "coverage-summary.json summary leaked secret-like path segment");
  assert(istanbulSummaryJson.includes("no test runner, coverage tool"), "coverage-summary.json summary omitted no-runner safety copy");
  const cloverSummary = summaryFor(coverageReportResult, "clover.xml");
  assert(cloverSummary.includes("Coverage report preview (Clover XML"), "clover.xml did not use Clover coverage report preview");
  assert(cloverSummary.includes("70% (7/10)") && cloverSummary.includes("75% (3/4)"), "clover.xml summary omitted Clover statement/conditional coverage counts");
  assert(cloverSummary.includes("chatbar.runtime"), "clover.xml summary omitted package evidence");
  assert(cloverSummary.includes("src/chatbar/runtime.ts") && cloverSummary.includes("src/chatbar/[redacted].ts"), "clover.xml summary omitted file evidence or secret redaction");
  assert(!cloverSummary.includes("secret-token"), "clover.xml summary leaked secret-like path segment");
  assert(cloverSummary.includes("no test runner, coverage tool"), "clover.xml summary omitted no-runner safety copy");
  const jacocoSummary = summaryFor(coverageReportResult, "jacoco.xml");
  assert(jacocoSummary.includes("Coverage report preview (JaCoCo XML"), "jacoco.xml did not use JaCoCo coverage report preview");
  assert(jacocoSummary.includes("75% (9/12)") && jacocoSummary.includes("75% (3/4)"), "jacoco.xml summary omitted JaCoCo line/branch coverage counts");
  assert(jacocoSummary.includes("chatbar/runtime"), "jacoco.xml summary omitted package evidence");
  assert(jacocoSummary.includes("RuntimeCoverage.java") && jacocoSummary.includes("[redacted].java"), "jacoco.xml summary omitted file evidence or secret redaction");
  assert(!jacocoSummary.includes("secret-token"), "jacoco.xml summary leaked secret-like path segment");
  assert(jacocoSummary.includes("no test runner, coverage tool"), "jacoco.xml summary omitted no-runner safety copy");

  const junitSummary = summaryFor(testReportResult, "runtime.junit.xml");
  assert(junitSummary.includes("Test report preview (JUnit XML"), "runtime.junit.xml did not use JUnit test report preview");
  assert(junitSummary.includes("Cases: 3; failures: 1; errors: 0; skipped: 1"), "runtime.junit.xml summary omitted case/failure counts");
  assert(junitSummary.includes("RuntimeFixtureSuite"), "runtime.junit.xml summary omitted suite evidence");
  assert(junitSummary.includes("RuntimeFixture.fails [failure]"), `runtime.junit.xml summary omitted failure preview evidence: ${junitSummary}`);
  assert(junitSummary.includes("JUnit properties: browser=chromium, api.token=[redacted]"), "runtime.junit.xml summary omitted property detail evidence");
  assert(junitSummary.includes("JUnit attachment cues: artifacts/runtime-failure.png, artifacts/[redacted].zip"), "runtime.junit.xml summary omitted attachment cue evidence");
  assert(!junitSummary.includes("secret-junit-token") && !junitSummary.includes("secret-token-trace"), "runtime.junit.xml summary leaked JUnit secret detail values");
  assert(junitSummary.includes("no test runner, build command"), "runtime.junit.xml summary omitted no-runner safety copy");

  const robotSummary = summaryFor(testReportResult, "output.xml");
  assert(robotSummary.includes("Test report preview (Robot Framework XML"), "output.xml did not use Robot Framework test report preview");
  assert(robotSummary.includes("Cases: 3; passed: 1; non-passing: 1; skipped: 1"), "output.xml summary omitted Robot outcome counts");
  assert(robotSummary.includes("Runtime Robot Suite"), "output.xml summary omitted Robot suite evidence");
  assert(robotSummary.includes("Runtime Robot Fail [FAIL]"), "output.xml summary omitted failing Robot test evidence");
  assert(robotSummary.includes("Robot tags: smoke") && robotSummary.includes("quarantine"), "output.xml summary omitted Robot tag evidence");
  assert(robotSummary.includes("Robot keyword cues: Open Runtime Chat") && robotSummary.includes("Call Provider API"), "output.xml summary omitted Robot keyword evidence");
  assert(!robotSummary.includes("secret-robot-token") && !robotSummary.includes("secret-robot-keyword-token"), "output.xml summary leaked Robot secret detail values");
  assert(robotSummary.includes("no test runner, build command"), "output.xml summary omitted no-runner safety copy");
  assert(testReportResult.items.find((item) => item.title === "output.xml")?.mime === "application/vnd.robotframework+xml", "Robot Framework MIME provenance is missing");

  const jmeterPlanSummary = summaryFor(testReportResult, "runtime.jmx");
  assert(jmeterPlanSummary.includes("JMeter test plan preview"), "runtime.jmx did not use JMeter test plan preview");
  assert(jmeterPlanSummary.includes("Runtime JMeter Plan") && jmeterPlanSummary.includes("Runtime Thread Group"), "runtime.jmx summary omitted plan or thread group evidence");
  assert(jmeterPlanSummary.includes("Runtime GET /chat"), "runtime.jmx summary omitted sampler evidence");
  assert(jmeterPlanSummary.includes("Runtime status assertion"), "runtime.jmx summary omitted assertion evidence");
  assert(jmeterPlanSummary.includes("Runtime Headers"), "runtime.jmx summary omitted config element evidence");
  assert(jmeterPlanSummary.includes("Variable keys") && jmeterPlanSummary.includes("baseUrl") && jmeterPlanSummary.includes("authToken"), "runtime.jmx summary omitted variable-key evidence");
  assert(jmeterPlanSummary.includes("variable values were not expanded") && jmeterPlanSummary.includes("no JMeter command, load test, HTTP replay"), "runtime.jmx summary omitted no-runtime/no-value-expansion safety copy");
  assert(!jmeterPlanSummary.includes("secret-jmx-comment-token") && !jmeterPlanSummary.includes("secret-jmx-base-token") && !jmeterPlanSummary.includes("secret-jmx-auth-token") && !jmeterPlanSummary.includes("secret-jmx-header-token"), "runtime.jmx summary leaked JMeter plan secrets");
  assert(testReportResult.items.find((item) => item.title === "runtime.jmx")?.mime === "application/vnd.jmeter+xml", "runtime.jmx MIME provenance is missing");

  const jmeterXmlSummary = summaryFor(testReportResult, "runtime.jmeter.xml");
  assert(jmeterXmlSummary.includes("Test report preview (JMeter XML"), "runtime.jmeter.xml did not use JMeter XML test report preview");
  assert(jmeterXmlSummary.includes("Samples: 3; passed: 2; non-passing: 1"), "runtime.jmeter.xml summary omitted JMeter XML sample counts");
  assert(jmeterXmlSummary.includes("Runtime JMeter Thread Group"), "runtime.jmeter.xml summary omitted thread group evidence");
  assert(jmeterXmlSummary.includes("POST /provider [500]"), "runtime.jmeter.xml summary omitted failing sample evidence");
  assert(jmeterXmlSummary.includes("JMeter assertion cues: Runtime provider SLA: JMeter assertion token=[redacted]"), "runtime.jmeter.xml summary omitted assertion detail evidence");
  assert(jmeterXmlSummary.includes("JMeter response-data cues: Runtime response body token=[redacted]"), "runtime.jmeter.xml summary omitted response data detail evidence");
  assert(!jmeterXmlSummary.includes("secret-jmeter-token") && !jmeterXmlSummary.includes("secret-jmeter-assertion") && !jmeterXmlSummary.includes("secret-jmeter-response"), "runtime.jmeter.xml summary leaked JMeter diagnostic secret");
  assert(jmeterXmlSummary.includes("no test runner, build command"), "runtime.jmeter.xml summary omitted no-runner safety copy");

  const jmeterCsvSummary = summaryFor(testReportResult, "runtime.jmeter.csv");
  assert(jmeterCsvSummary.includes("Test report preview (JMeter JTL/CSV"), "runtime.jmeter.csv did not use JMeter CSV test report preview");
  assert(jmeterCsvSummary.includes("Samples: 3; passed: 2; non-passing: 1"), "runtime.jmeter.csv summary omitted JMeter CSV sample counts");
  assert(jmeterCsvSummary.includes("Columns: timeStamp, elapsed, label"), "runtime.jmeter.csv summary omitted column evidence");
  assert(jmeterCsvSummary.includes("CSV POST /provider [503]"), "runtime.jmeter.csv summary omitted failing CSV sample evidence");
  assert(jmeterCsvSummary.includes("JMeter thread cues: Runtime JMeter CSV Thread Group"), "runtime.jmeter.csv summary omitted thread detail evidence");
  assert(jmeterCsvSummary.includes("JMeter CSV failure details: CSV assertion token=[redacted]"), "runtime.jmeter.csv summary omitted CSV failure detail evidence");
  assert(!jmeterCsvSummary.includes("secret-jmeter-csv-token") && !jmeterCsvSummary.includes("secret-jmeter-csv-assertion"), "runtime.jmeter.csv summary leaked JMeter CSV diagnostic secret");
  assert(jmeterCsvSummary.includes("no test runner, build command"), "runtime.jmeter.csv summary omitted no-runner safety copy");

  const nunitSummary = summaryFor(testReportResult, "runtime.nunit.xml");
  assert(nunitSummary.includes("Test report preview (NUnit XML"), "runtime.nunit.xml did not use NUnit XML test report preview");
  assert(nunitSummary.includes("Cases: 3; passed: 1; non-passing: 1; skipped: 1"), "runtime.nunit.xml summary omitted NUnit outcome counts");
  assert(nunitSummary.includes("Runtime.NUnit"), "runtime.nunit.xml summary omitted suite evidence");
  assert(nunitSummary.includes("RuntimeNUnitFail"), "runtime.nunit.xml summary omitted failing case evidence");
  assert(nunitSummary.includes("NUnit properties: target.framework=net8.0, api.token=[redacted]"), "runtime.nunit.xml summary omitted NUnit property detail evidence");
  assert(nunitSummary.includes("NUnit attachment cues: artifacts/[redacted].log"), "runtime.nunit.xml summary omitted NUnit attachment detail evidence");
  assert(!nunitSummary.includes("secret-nunit-token") && !nunitSummary.includes("secret-nunit-property"), "runtime.nunit.xml summary leaked NUnit diagnostic secret");
  assert(nunitSummary.includes("no test runner, build command"), "runtime.nunit.xml summary omitted no-runner safety copy");

  const xunitSummary = summaryFor(testReportResult, "runtime.xunit.xml");
  assert(xunitSummary.includes("Test report preview (xUnit XML"), "runtime.xunit.xml did not use xUnit XML test report preview");
  assert(xunitSummary.includes("Cases: 3; passed: 1; non-passing: 1; skipped: 1"), "runtime.xunit.xml summary omitted xUnit outcome counts");
  assert(xunitSummary.includes("Runtime xUnit Collection"), "runtime.xunit.xml summary omitted collection evidence");
  assert(xunitSummary.includes("RuntimeXunitFail"), "runtime.xunit.xml summary omitted failing case evidence");
  assert(xunitSummary.includes("xUnit properties: runtime=win11, api.token=[redacted]"), "runtime.xunit.xml summary omitted xUnit property detail evidence");
  assert(xunitSummary.includes("xUnit attachment cues: artifacts/[redacted].zip"), "runtime.xunit.xml summary omitted xUnit attachment detail evidence");
  assert(!xunitSummary.includes("secret-xunit-token") && !xunitSummary.includes("secret-xunit-property"), "runtime.xunit.xml summary leaked xUnit diagnostic secret");
  assert(xunitSummary.includes("no test runner, build command"), "runtime.xunit.xml summary omitted no-runner safety copy");

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

  const cypressJsonSummary = summaryFor(testReportResult, "runtime.cypress-results.json");
  assert(cypressJsonSummary.includes("Test report preview (Cypress JSON"), "runtime.cypress-results.json did not use Cypress JSON test report preview");
  assert(cypressJsonSummary.includes("Cases: 4; passed: 2; non-passing: 1; skipped: 1"), "runtime.cypress-results.json summary omitted Cypress outcome counts");
  assert(cypressJsonSummary.includes("cypress/e2e/runtime.cy.ts"), "runtime.cypress-results.json summary omitted spec evidence");
  assert(cypressJsonSummary.includes("Runtime Cypress Suite > blocks failed provider send [failed]"), "runtime.cypress-results.json summary omitted failing Cypress test evidence");
  assert(!cypressJsonSummary.includes("secret-cypress-token"), "runtime.cypress-results.json summary leaked Cypress diagnostic secret");
  assert(cypressJsonSummary.includes("no test runner, build command"), "runtime.cypress-results.json summary omitted no-runner safety copy");

  const mochaJsonSummary = summaryFor(testReportResult, "runtime.mocha.json");
  assert(mochaJsonSummary.includes("Test report preview (Mocha JSON"), "runtime.mocha.json did not use Mocha JSON test report preview");
  assert(mochaJsonSummary.includes("Cases: 4; passed: 2; non-passing: 1; skipped: 1"), "runtime.mocha.json summary omitted Mocha outcome counts");
  assert(mochaJsonSummary.includes("Runtime Mocha Suite"), "runtime.mocha.json summary omitted suite evidence");
  assert(mochaJsonSummary.includes("Runtime Mocha Suite blocks failed provider send [failed]"), "runtime.mocha.json summary omitted failing Mocha test evidence");
  assert(!mochaJsonSummary.includes("secret-mocha-token"), "runtime.mocha.json summary leaked Mocha diagnostic secret");
  assert(mochaJsonSummary.includes("no test runner, build command"), "runtime.mocha.json summary omitted no-runner safety copy");

  const allureJsonSummary = summaryFor(testReportResult, "runtime.allure-result.json");
  assert(allureJsonSummary.includes("Test report preview (Allure JSON"), "runtime.allure-result.json did not use Allure JSON test report preview");
  assert(allureJsonSummary.includes("Cases: 1; passed: 0; non-passing: 1; skipped: 0"), "runtime.allure-result.json summary omitted Allure outcome counts");
  assert(allureJsonSummary.includes("Runtime Allure Suite"), "runtime.allure-result.json summary omitted suite evidence");
  assert(allureJsonSummary.includes("Runtime Allure Suite blocks failed provider send [failed]"), "runtime.allure-result.json summary omitted failing Allure test evidence");
  assert(allureJsonSummary.includes("Allure labels: parentSuite=Runtime Allure Parent") && allureJsonSummary.includes("api.token=[redacted]"), "runtime.allure-result.json summary omitted Allure label detail evidence");
  assert(allureJsonSummary.includes("Allure links: runtime issue=https://tracker.example.test/DRSAI-42?token=[redacted]"), "runtime.allure-result.json summary omitted Allure link detail evidence");
  assert(allureJsonSummary.includes("Allure attachment cues: local screenshot -> artifacts/[redacted].png (image/png)"), "runtime.allure-result.json summary omitted Allure attachment cue evidence");
  assert(allureJsonSummary.includes("Allure steps: Attach local context [passed], Avoid provider send [failed]"), "runtime.allure-result.json summary omitted Allure step detail evidence");
  assert(allureJsonSummary.includes("Allure status trace cue: stack trace token=[redacted]"), "runtime.allure-result.json summary omitted Allure status trace cue evidence");
  assert(!allureJsonSummary.includes("secret-allure-token") && !allureJsonSummary.includes("secret-allure-trace") && !allureJsonSummary.includes("secret-allure-label-token") && !allureJsonSummary.includes("secret-allure-link-token") && !allureJsonSummary.includes("secret-allure-attachment"), "runtime.allure-result.json summary leaked Allure diagnostic secret");
  assert(allureJsonSummary.includes("no test runner, build command"), "runtime.allure-result.json summary omitted no-runner safety copy");

  const slackExportSummary = summaryFor(chatExportResult, "slack-export.json");
  assert(slackExportSummary.includes("Chat export JSON preview (Slack export JSON"), "slack-export.json did not use Slack chat export preview");
  assert(slackExportSummary.includes("Messages in bounded preview: 2"), "slack-export.json summary omitted message count evidence");
  assert(slackExportSummary.includes("runtime-slack-channel") && slackExportSummary.includes("U12345"), "slack-export.json summary omitted channel or sender evidence");
  assert(slackExportSummary.includes("Slack runtime export message"), "slack-export.json summary omitted message sample evidence");
  assert(!slackExportSummary.includes("secret-slack-export-token"), "slack-export.json summary leaked Slack export secret");
  assert(slackExportSummary.includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login"), "slack-export.json summary omitted no-provider safety copy");

  const slackCsvExportSummary = summaryFor(chatExportResult, "slack-export.csv");
  assert(slackCsvExportSummary.includes("Chat CSV export preview (Slack export CSV"), "slack-export.csv did not use Slack chat CSV export preview");
  assert(slackCsvExportSummary.includes("Messages in bounded preview: 2"), "slack-export.csv summary omitted message count evidence");
  assert(slackCsvExportSummary.includes("runtime-slack-csv-channel") && slackCsvExportSummary.includes("U34567"), "slack-export.csv summary omitted channel or sender evidence");
  assert(slackCsvExportSummary.includes("Slack CSV runtime export message"), "slack-export.csv summary omitted message sample evidence");
  assert(!slackCsvExportSummary.includes("secret-slack-csv-export-token"), "slack-export.csv summary leaked Slack CSV export secret");
  assert(slackCsvExportSummary.includes("no Slack/Teams/Discord/Telegram connector login"), "slack-export.csv summary omitted no-provider safety copy");
  assert(chatExportResult.items.find((item) => item.title === "slack-export.csv")?.mime === "text/csv+chat-export", "slack-export.csv MIME provenance is missing");

  const teamsExportSummary = summaryFor(chatExportResult, "teams-export.json");
  assert(teamsExportSummary.includes("Chat export JSON preview (Microsoft Teams export JSON"), "teams-export.json did not use Teams chat export preview");
  assert(teamsExportSummary.includes("Runtime Teams Channel") && teamsExportSummary.includes("Ada Reviewer"), "teams-export.json summary omitted Teams channel or sender evidence");
  assert(teamsExportSummary.includes("Teams runtime export message"), "teams-export.json summary omitted Teams message evidence");
  assert(!teamsExportSummary.includes("secret-teams-export-token"), "teams-export.json summary leaked Teams export secret");
  assert(teamsExportSummary.includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login"), "teams-export.json summary omitted no-provider safety copy");

  const discordExportSummary = summaryFor(chatExportResult, "discord-export.json");
  assert(discordExportSummary.includes("Chat export JSON preview (Discord export JSON"), "discord-export.json did not use Discord chat export preview");
  assert(discordExportSummary.includes("Runtime Discord Guild") || discordExportSummary.includes("runtime-discord-channel"), "discord-export.json summary omitted Discord guild or channel evidence");
  assert(discordExportSummary.includes("Discord Reviewer"), "discord-export.json summary omitted Discord author evidence");
  assert(discordExportSummary.includes("Discord runtime export message"), "discord-export.json summary omitted Discord message evidence");
  assert(!discordExportSummary.includes("secret-discord-export-token"), "discord-export.json summary leaked Discord export secret");
  assert(discordExportSummary.includes("no Discord connector login"), "discord-export.json summary omitted no-Discord-provider safety copy");

  const chatgptExportSummary = summaryFor(chatExportResult, "chatgpt-conversations.json");
  assert(chatgptExportSummary.includes("Chat export JSON preview (ChatGPT conversations JSON"), "chatgpt-conversations.json did not use ChatGPT conversations preview");
  assert(chatgptExportSummary.includes("Runtime ChatGPT Conversation") && chatgptExportSummary.includes("assistant"), "chatgpt-conversations.json summary omitted conversation or role evidence");
  assert(chatgptExportSummary.includes("ChatGPT export prompt"), "chatgpt-conversations.json summary omitted ChatGPT message evidence");
  assert(!chatgptExportSummary.includes("secret-chatgpt-export-token"), "chatgpt-conversations.json summary leaked ChatGPT export secret");
  assert(chatgptExportSummary.includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login"), "chatgpt-conversations.json summary omitted no-provider safety copy");

  const claudeExportSummary = summaryFor(chatExportResult, "claude-conversations.json");
  assert(claudeExportSummary.includes("Chat export JSON preview (Claude conversations JSON"), "claude-conversations.json did not use Claude conversations preview");
  assert(claudeExportSummary.includes("Runtime Claude Conversation") && claudeExportSummary.includes("assistant"), "claude-conversations.json summary omitted conversation or role evidence");
  assert(claudeExportSummary.includes("Claude export prompt"), "claude-conversations.json summary omitted Claude message evidence");
  assert(!claudeExportSummary.includes("secret-claude-export-token"), "claude-conversations.json summary leaked Claude export secret");
  assert(claudeExportSummary.includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login"), "claude-conversations.json summary omitted no-provider safety copy");

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

  const texSummary = summaryFor(latexRuntimeResult, "paper.tex");
  assert(texSummary.includes("LaTeX context preview (TeX/LaTeX document"), "paper.tex did not use LaTeX context preview");
  assert(texSummary.includes("documentclass=article") && texSummary.includes("package=amsmath") && texSummary.includes("package=graphicx"), "paper.tex summary omitted document metadata evidence");
  assert(texSummary.includes("section=Runtime Method") && texSummary.includes("input=sections/results") && texSummary.includes("includegraphics=figures/runtime-plot.png"), "paper.tex summary omitted structure/include evidence");
  assert(texSummary.includes("label=sec:runtime") && texSummary.includes("cite=runtime2026") && texSummary.includes("ref=eq:runtime"), "paper.tex summary omitted reference evidence");
  assert(texSummary.includes("environment=equation"), "paper.tex summary omitted formula environment evidence");
  assert(texSummary.includes("addbibresource=references.bib"), "paper.tex summary omitted bibliography resource evidence");
  assert(!texSummary.includes("secret-latex-comment-token"), "paper.tex summary leaked LaTeX comment secret");
  assert(texSummary.includes("no latexmk/pdflatex/xelatex/lualatex/bibtex/biber command"), "paper.tex summary omitted no-TeX-runtime safety copy");

  const bibSummary = summaryFor(latexRuntimeResult, "references.bib");
  assert(bibSummary.includes("LaTeX context preview (BibTeX bibliography"), "references.bib did not use BibTeX context preview");
  assert(bibSummary.includes("article:runtime2026") && bibSummary.includes("title=Runtime Fixture for Local LaTeX Context") && bibSummary.includes("year=2026"), "references.bib summary omitted entry/title/year evidence");
  assert(bibSummary.includes("author=Ada Reviewer and Grace Builder"), "references.bib summary omitted author evidence");
  assert(!bibSummary.includes("secret-bib-token"), "references.bib summary leaked BibTeX secret");
  assert(bibSummary.includes("no latexmk/pdflatex/xelatex/lualatex/bibtex/biber command"), "references.bib summary omitted no-BibTeX-runtime safety copy");

  const latexmkSummary = summaryFor(latexRuntimeResult, "latexmkrc");
  assert(latexmkSummary.includes("LaTeX context preview (latexmk configuration"), "latexmkrc did not use LaTeX context preview");
  assert(latexmkSummary.includes("setting=pdf_mode") && latexmkSummary.includes("setting=pdflatex") && latexmkSummary.includes("setting=bibtex"), "latexmkrc summary omitted setting evidence");
  assert(latexmkSummary.includes("latexmk command/runtime setting"), "latexmkrc summary omitted runtime risk cue");
  assert(!latexmkSummary.includes("secret-latexmk-token"), "latexmkrc summary leaked latexmk secret");
  assert(latexmkSummary.includes("no latexmk/pdflatex/xelatex/lualatex/bibtex/biber command"), "latexmkrc summary omitted no-TeX-runtime safety copy");

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

  const gitmodulesSummary = summaryFor(repositoryGovernanceResult, ".gitmodules");
  assert(gitmodulesSummary.includes("Git submodule mapping"), ".gitmodules summary omitted submodule format evidence");
  assert(gitmodulesSummary.includes("runtime-tools: path=vendor/runtime-tools"), ".gitmodules summary omitted submodule path evidence");
  assert(gitmodulesSummary.includes("branch=main") && gitmodulesSummary.includes("update=checkout") && gitmodulesSummary.includes("shallow=true"), ".gitmodules summary omitted submodule option evidence");
  assert(gitmodulesSummary.includes("token=[redacted]") && !gitmodulesSummary.includes("secret-gitmodules-token"), ".gitmodules summary leaked token-like URL value");
  assert(gitmodulesSummary.includes("no git command"), ".gitmodules summary omitted no-git safety copy");

  const mailmapSummary = summaryFor(repositoryGovernanceResult, ".mailmap");
  assert(mailmapSummary.includes("Git mailmap identity mapping"), ".mailmap summary omitted mailmap format evidence");
  assert(mailmapSummary.includes("Runtime Canonical") && mailmapSummary.includes("Runtime Alias"), ".mailmap summary omitted identity mapping evidence");
  assert(mailmapSummary.includes("<[redacted]@example.test>"), ".mailmap summary omitted email redaction evidence");
  assert(!mailmapSummary.includes("canonical@example.test") && !mailmapSummary.includes("alias@example.test"), ".mailmap summary leaked raw email values");
  assert(mailmapSummary.includes("no git command"), ".mailmap summary omitted no-git safety copy");

  const licenseSummary = summaryFor(repositoryGovernanceResult, "LICENSE");
  assert(licenseSummary.includes("license text"), "LICENSE summary omitted license format evidence");
  assert(licenseSummary.includes("License cues: MIT"), "LICENSE summary omitted MIT cue evidence");
  assert(licenseSummary.includes("license compliance scanner"), "LICENSE summary omitted no-license-scanner safety copy");

  const noticeSummary = summaryFor(repositoryGovernanceResult, "NOTICE");
  assert(noticeSummary.includes("notice text"), "NOTICE summary omitted notice format evidence");
  assert(noticeSummary.includes("Notice/copyright lines"), "NOTICE summary omitted notice/copyright evidence");
  assert(noticeSummary.includes("provider send"), "NOTICE summary omitted no-provider safety copy");

  const dotenvSummary = summaryFor(configRuntimeResult, ".env.runtime");
  assert(dotenvSummary.includes("dotenv environment file preview"), ".env.runtime did not use dotenv environment preview");
  assert(dotenvSummary.includes("RUNTIME_MODE") && dotenvSummary.includes("API_TOKEN") && dotenvSummary.includes("PUBLIC_URL") && dotenvSummary.includes("DERIVED_URL"), ".env.runtime summary omitted key evidence");
  assert(dotenvSummary.includes("Exported keys: DERIVED_URL"), ".env.runtime summary omitted exported key evidence");
  assert(dotenvSummary.includes("Sensitive-looking keys: API_TOKEN"), ".env.runtime summary omitted sensitive-key evidence");
  assert(dotenvSummary.includes("Public/client-exposed keys: PUBLIC_URL"), ".env.runtime summary omitted public-key evidence");
  assert(dotenvSummary.includes("Variable references: PUBLIC_URL"), ".env.runtime summary omitted variable-reference evidence");
  assert(dotenvSummary.includes("Duplicate keys: DUPLICATE_KEY"), ".env.runtime summary omitted duplicate key evidence");
  assert(dotenvSummary.includes("[value hidden;"), ".env.runtime summary omitted value-hidden samples");
  assert(!dotenvSummary.includes("secret-env-token"), ".env.runtime summary leaked sensitive token value");
  assert(!dotenvSummary.includes("secret-env-query"), ".env.runtime summary leaked token-like URL value");
  assert(dotenvSummary.includes("dotenv values were not expanded or printed"), ".env.runtime summary omitted value non-disclosure safety copy");
  assert(dotenvSummary.includes("no shell command or dotenv runtime was executed"), ".env.runtime summary omitted no-dotenv-runtime safety copy");
  assert(configRuntimeResult.items.find((item) => item.title === ".env.runtime")?.mime === "text/x-dotenv", ".env.runtime MIME provenance is missing");

  const envrcSummary = summaryFor(configRuntimeResult, ".envrc");
  assert(envrcSummary.includes("direnv .envrc preview"), ".envrc did not use direnv preview");
  assert(envrcSummary.includes("RUNTIME_ENV") && envrcSummary.includes("API_TOKEN"), ".envrc summary omitted exported key evidence");
  assert(envrcSummary.includes("dotenv targets: .env.runtime, .env.local"), ".envrc summary omitted dotenv target evidence");
  assert(envrcSummary.includes("use directives: node 22"), ".envrc summary omitted use directive evidence");
  assert(envrcSummary.includes("layout directives: python .venv"), ".envrc summary omitted layout directive evidence");
  assert(envrcSummary.includes("watch targets: pyproject.toml"), ".envrc summary omitted watch target evidence");
  assert(envrcSummary.includes("source targets: .env.shared"), ".envrc summary omitted source target evidence");
  assert(envrcSummary.includes("network download/request") && envrcSummary.includes("dynamic sourcing/execution"), ".envrc summary omitted static risk cue evidence");
  assert(!envrcSummary.includes("secret-envrc-token"), ".envrc summary leaked sensitive token value");
  assert(!envrcSummary.includes("secret-envrc-query"), ".envrc summary leaked token-like URL value");
  assert(envrcSummary.includes("direnv was not executed") && envrcSummary.includes("dotenv/source targets were not opened"), ".envrc summary omitted no-direnv/no-source safety copy");

  const regexPatternSummary = summaryFor(configRuntimeResult, "runtime.regex");
  assert(regexPatternSummary.includes("Regular expression pattern preview"), "runtime.regex did not use regex pattern preview");
  assert(regexPatternSummary.includes("Patterns in bounded preview: 3"), "runtime.regex summary omitted pattern count evidence");
  assert(regexPatternSummary.includes("Flags") && regexPatternSummary.includes("g") && regexPatternSummary.includes("i"), "runtime.regex summary omitted regex flags evidence");
  assert(regexPatternSummary.includes("Named capture groups") && regexPatternSummary.includes("level") && regexPatternSummary.includes("component"), "runtime.regex summary omitted named capture group evidence");
  assert(regexPatternSummary.includes("lookbehind") && regexPatternSummary.includes("broad dot-star match") && regexPatternSummary.includes("nested quantifier"), "runtime.regex summary omitted static feature/risk evidence");
  assert(regexPatternSummary.includes("Replacement templates") && regexPatternSummary.includes("$<level>"), "runtime.regex summary omitted replacement template evidence");
  assert(regexPatternSummary.includes("Declared sample targets") && regexPatternSummary.includes("runtime.log"), "runtime.regex summary omitted target sample evidence");
  assert(!regexPatternSummary.includes("secret-regex-token"), "runtime.regex summary leaked regex fixture secret");
  assert(regexPatternSummary.includes("patterns were not compiled or executed") && regexPatternSummary.includes("no files were searched"), "runtime.regex summary omitted no-compile/no-search safety copy");
  assert(configRuntimeResult.items.find((item) => item.title === "runtime.regex")?.mime === "text/x-regex", "runtime.regex MIME provenance is missing");

  const sshConfigSummary = summaryFor(sshConfigResult, "config");
  assert(sshConfigSummary.includes("SSH configuration preview"), ".ssh/config did not use SSH configuration preview");
  assert(sshConfigSummary.includes("runtime-prod") && sshConfigSummary.includes("runtime-alias"), ".ssh/config summary omitted Host pattern evidence");
  assert(sshConfigSummary.includes("runtime.example.test") && sshConfigSummary.includes("runtime-user") && sshConfigSummary.includes("2222"), ".ssh/config summary omitted destination/user/port evidence");
  assert(sshConfigSummary.includes("id_runtime_secret"), ".ssh/config summary omitted identity filename label evidence");
  assert(sshConfigSummary.includes("ProxyJump") && sshConfigSummary.includes("ProxyCommand may execute a local command"), ".ssh/config summary omitted proxy/static risk evidence");
  assert(sshConfigSummary.includes("Include targets") && sshConfigSummary.includes("secret-ssh-include.conf"), ".ssh/config summary omitted Include target evidence");
  assert(!sshConfigSummary.includes("secret-ssh-token"), ".ssh/config summary leaked token-like host value");
  assert(sshConfigSummary.includes("private key files and Include targets were not opened"), ".ssh/config summary omitted no-key-read/no-include safety copy");
  assert(sshConfigResult.items.find((item) => item.title === "config")?.mime === "text/x-ssh-config", ".ssh/config MIME provenance is missing");

  const knownHostsSummary = summaryFor(sshConfigResult, "known_hosts");
  assert(knownHostsSummary.includes("known_hosts"), "known_hosts summary omitted format evidence");
  assert(knownHostsSummary.includes("runtime.example.test") && knownHostsSummary.includes("hashed-host"), "known_hosts summary omitted host evidence");
  assert(knownHostsSummary.includes("ssh-ed25519") && knownHostsSummary.includes("ssh-rsa"), "known_hosts summary omitted key type evidence");
  assert(!knownHostsSummary.includes("secretKnownHostMaterial") && !knownHostsSummary.includes("SecretKnownHostHash"), "known_hosts summary leaked key material");

  const authorizedKeysSummary = summaryFor(sshConfigResult, "authorized_keys");
  assert(authorizedKeysSummary.includes("authorized_keys"), "authorized_keys summary omitted format evidence");
  assert(authorizedKeysSummary.includes("ssh-ed25519") && authorizedKeysSummary.includes("ssh-rsa"), "authorized_keys summary omitted key type evidence");
  assert(authorizedKeysSummary.includes("runtime deploy key") && authorizedKeysSummary.includes("runtime readonly key"), "authorized_keys summary omitted bounded key comment evidence");
  assert(authorizedKeysSummary.includes("authorized_keys option command") && authorizedKeysSummary.includes("authorized_keys option restrict"), "authorized_keys summary omitted option risk cues");
  assert(!authorizedKeysSummary.includes("AuthorizedSecretMaterial") && !authorizedKeysSummary.includes("secret-authorized-command"), "authorized_keys summary leaked key material or forced-command token");
  assert(authorizedKeysSummary.includes("authorized_keys key material were not expanded"), "authorized_keys summary omitted no-key-material safety copy");

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

  const gradleVersionCatalogSummary = summaryFor(result, "libs.versions.toml");
  assert(gradleVersionCatalogSummary.includes("Gradle version catalog preview"), "libs.versions.toml did not use Gradle version catalog preview");
  assert(gradleVersionCatalogSummary.includes("agp=8.8.2") && gradleVersionCatalogSummary.includes("kotlin=2.1.20"), "libs.versions.toml summary omitted version alias evidence");
  assert(gradleVersionCatalogSummary.includes("androidx-core=androidx.core:core-ktx") && gradleVersionCatalogSummary.includes("compose-bom=androidx.compose:compose-bom"), "libs.versions.toml summary omitted library alias evidence");
  assert(gradleVersionCatalogSummary.includes("android-application=com.android.application") && gradleVersionCatalogSummary.includes("kotlin-android=org.jetbrains.kotlin.android"), "libs.versions.toml summary omitted plugin alias evidence");
  assert(gradleVersionCatalogSummary.includes("compose=androidx-core, compose-bom"), "libs.versions.toml summary omitted bundle evidence");
  assert(gradleVersionCatalogSummary.includes("SNAPSHOT/pre-release dependency"), "libs.versions.toml summary omitted static risk cue evidence");
  assert(gradleVersionCatalogSummary.includes("[redacted]") && !gradleVersionCatalogSummary.includes("token-secret-gradle-catalog"), "libs.versions.toml summary leaked token-shaped catalog value");
  assert(gradleVersionCatalogSummary.includes("no Gradle command, wrapper launch, dependency resolution"), "libs.versions.toml summary omitted no-Gradle safety copy");
  assert(result.items.find((item) => item.title === "libs.versions.toml")?.mime === "application/vnd.gradle.version-catalog+toml", "libs.versions.toml MIME provenance is missing");

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

  const mavenSettingsSummary = summaryFor(result, "settings.xml");
  assert(mavenSettingsSummary.includes("Maven settings.xml preview"), ".m2/settings.xml did not use Maven settings preview");
  assert(mavenSettingsSummary.includes("runtime-mirror") && mavenSettingsSummary.includes("mirrorOf=*"), ".m2/settings.xml summary omitted mirror evidence");
  assert(mavenSettingsSummary.includes("runtime-releases") && mavenSettingsSummary.includes("credential keys=username,password,privateKey"), ".m2/settings.xml summary omitted server credential-key evidence");
  assert(mavenSettingsSummary.includes("runtime-profile") && mavenSettingsSummary.includes("runtime-snapshots"), ".m2/settings.xml summary omitted profile/repository evidence");
  assert(mavenSettingsSummary.includes("runtime-proxy") && mavenSettingsSummary.includes("proxy.example.test"), ".m2/settings.xml summary omitted proxy evidence");
  assert(mavenSettingsSummary.includes("REDACTED") || mavenSettingsSummary.includes("[redacted]"), ".m2/settings.xml summary omitted URL token redaction evidence");
  assert(!mavenSettingsSummary.includes("secret-maven-url-token") && !mavenSettingsSummary.includes("secret-maven-password") && !mavenSettingsSummary.includes("secret-maven-private-key") && !mavenSettingsSummary.includes("secret-proxy-password") && !mavenSettingsSummary.includes("secret-maven-profile-token"), ".m2/settings.xml summary leaked Maven settings secret values");
  assert(mavenSettingsSummary.includes("settings.xml merge was not performed"), ".m2/settings.xml summary omitted no-merge safety copy");
  assert(result.items.find((item) => item.title === "settings.xml")?.mime === "application/vnd.apache.maven.settings+xml", ".m2/settings.xml MIME provenance is missing");

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

  const constraintsSummary = summaryFor(constraintsRuntimeResult, "constraints-runtime.txt");
  assert(constraintsSummary.includes("Python dependency manifest preview"), "constraints-runtime.txt did not use Python dependency manifest preview");
  assert(constraintsSummary.includes("constraints.txt"), "constraints-runtime.txt summary omitted constraints format evidence");
  assert(constraintsSummary.includes("requests") && constraintsSummary.includes("httpx"), "constraints-runtime.txt summary omitted package evidence");
  assert(constraintsSummary.includes("Dependency groups: constraints"), "constraints-runtime.txt summary omitted constraints group evidence");
  assert(constraintsSummary.includes("-c base-constraints.txt"), "constraints-runtime.txt summary omitted nested constraint hint evidence");
  assert(!constraintsSummary.includes("secret-constraints-token"), "constraints-runtime.txt summary leaked token-like index URL value");
  assert(constraintsSummary.includes("no Python interpreter"), "constraints-runtime.txt summary omitted no-Python safety copy");

  const preCommitSummary = summaryFor(preCommitConfigResult, ".pre-commit-config.yaml");
  assert(preCommitSummary.includes("Pre-commit hook config preview"), ".pre-commit-config.yaml did not use pre-commit config preview");
  assert(preCommitSummary.includes("pre-commit-hooks") && preCommitSummary.includes("local"), ".pre-commit-config.yaml summary omitted repository evidence");
  assert(preCommitSummary.includes("trailing-whitespace") && preCommitSummary.includes("check-yaml") && preCommitSummary.includes("runtime-local-test"), ".pre-commit-config.yaml summary omitted hook id evidence");
  assert(preCommitSummary.includes("system") && preCommitSummary.includes("pre-push"), ".pre-commit-config.yaml summary omitted language/stage evidence");
  assert(preCommitSummary.includes("[redacted]") && !preCommitSummary.includes("secret-precommit-url-token") && !preCommitSummary.includes("secret-precommit-entry-token"), ".pre-commit-config.yaml summary leaked token-shaped values");
  assert(preCommitSummary.includes("hooks were not installed or executed") && preCommitSummary.includes("no git hook was modified"), ".pre-commit-config.yaml summary omitted no-hook safety copy");
  assert(preCommitConfigResult.items.find((item) => item.title === ".pre-commit-config.yaml")?.mime === "application/vnd.pre-commit.config+yaml", ".pre-commit-config.yaml MIME provenance is missing");

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

  const denoLockSummary = summaryFor(lockfileResult, "deno.lock");
  assert(denoLockSummary.includes("Dependency lockfile preview"), "deno.lock did not use dependency lockfile preview");
  assert(denoLockSummary.includes("Ecosystem: Deno"), "deno.lock summary omitted Deno ecosystem evidence");
  assert(denoLockSummary.includes("chalk") && denoLockSummary.includes("ansi-styles"), "deno.lock summary omitted npm package evidence");
  assert(denoLockSummary.includes("(npm specifier) -> chalk") && denoLockSummary.includes("chalk -> ansi-styles"), "deno.lock summary omitted local Deno edge evidence");
  assert(denoLockSummary.includes("without package manager execution"), "deno.lock summary omitted no-package-manager safety copy");

  const bunLockSummary = summaryFor(lockfileResult, "bun.lock");
  assert(bunLockSummary.includes("Dependency lockfile preview"), "bun.lock did not use dependency lockfile preview");
  assert(bunLockSummary.includes("Ecosystem: Bun"), "bun.lock summary omitted Bun ecosystem evidence");
  assert(bunLockSummary.includes("react") && bunLockSummary.includes("runtime-bun-tool"), "bun.lock summary omitted workspace package evidence");
  assert(bunLockSummary.includes("(workspace) -> react") && bunLockSummary.includes("react -> scheduler"), "bun.lock summary omitted local Bun edge evidence");
  assert(bunLockSummary.includes("without package manager execution"), "bun.lock summary omitted no-package-manager safety copy");

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

  const githubActionsJobSummary = summaryFor(ciWorkflowResult, "GITHUB_STEP_SUMMARY.md");
  assert(githubActionsJobSummary.includes("GitHub Actions job summary preview"), "GITHUB_STEP_SUMMARY.md did not use GitHub Actions job summary preview");
  assert(githubActionsJobSummary.includes("Runtime GitHub Actions Summary"), "GITHUB_STEP_SUMMARY.md summary omitted heading evidence");
  assert(githubActionsJobSummary.includes("Unit tests -> failed"), "GITHUB_STEP_SUMMARY.md summary omitted table failure evidence");
  assert(githubActionsJobSummary.includes("failed") && githubActionsJobSummary.includes("warning") && githubActionsJobSummary.includes("coverage"), "GITHUB_STEP_SUMMARY.md summary omitted status cue evidence");
  assert(githubActionsJobSummary.includes("coverage report=https://artifact.example.test/report.zip?token=[redacted]"), "GITHUB_STEP_SUMMARY.md summary omitted redacted artifact link evidence");
  assert(githubActionsJobSummary.includes("npm test -- --token [redacted]"), "GITHUB_STEP_SUMMARY.md summary omitted command redaction evidence");
  assert(!githubActionsJobSummary.includes("secret-gha-summary-token") && !githubActionsJobSummary.includes("secret-gha-summary-link-token"), "GITHUB_STEP_SUMMARY.md summary leaked token-like value");
  assert(githubActionsJobSummary.includes("no GitHub API call") && githubActionsJobSummary.includes("linked artifacts were not downloaded"), "GITHUB_STEP_SUMMARY.md summary omitted no-provider/no-artifact-download safety copy");
  assert(ciWorkflowResult.items.find((item) => item.title === "GITHUB_STEP_SUMMARY.md")?.mime === "text/markdown+github-actions-summary", "GITHUB_STEP_SUMMARY.md MIME provenance is missing");

  const githubIssueTemplateSummary = summaryFor(githubTemplateResult, "bug_report.yml");
  assert(githubIssueTemplateSummary.includes("GitHub issue/PR template preview"), "bug_report.yml did not use GitHub template preview");
  assert(githubIssueTemplateSummary.includes("issue form YAML"), "bug_report.yml summary omitted issue form kind");
  assert(githubIssueTemplateSummary.includes("Runtime bug report"), "bug_report.yml summary omitted template name evidence");
  assert(githubIssueTemplateSummary.includes("bug") && githubIssueTemplateSummary.includes("windows"), "bug_report.yml summary omitted label evidence");
  assert(githubIssueTemplateSummary.includes("opendrsai/runtime"), "bug_report.yml summary omitted assignee evidence");
  assert(githubIssueTemplateSummary.includes("type=input") && githubIssueTemplateSummary.includes("id=runtime-version"), "bug_report.yml summary omitted body field evidence");
  assert(githubIssueTemplateSummary.includes("credential-shaped default redacted"), "bug_report.yml summary omitted credential-shaped risk cue");
  assert(!githubIssueTemplateSummary.includes("secret-template-description-token") && !githubIssueTemplateSummary.includes("secret-template-placeholder-token"), "bug_report.yml summary leaked token-like value");
  assert(githubIssueTemplateSummary.includes("no GitHub API call") && githubIssueTemplateSummary.includes("no issue or PR creation"), "bug_report.yml summary omitted no-provider/no-issue safety copy");
  assert(githubTemplateResult.items.find((item) => item.title === "bug_report.yml")?.mime === "application/vnd.github.template", "bug_report.yml MIME provenance was not preserved");

  const githubPrTemplateSummary = summaryFor(githubTemplateResult, "pull_request_template.md");
  assert(githubPrTemplateSummary.includes("pull request template Markdown"), "pull_request_template.md summary omitted PR template kind");
  assert(githubPrTemplateSummary.includes("Runtime PR checklist"), "pull_request_template.md summary omitted heading evidence");
  assert(githubPrTemplateSummary.includes("Tests added or updated") && githubPrTemplateSummary.includes("Windows packaged smoke considered"), "pull_request_template.md summary omitted checklist evidence");
  assert(!githubPrTemplateSummary.includes("secret-pr-template-token"), "pull_request_template.md summary leaked token-like value");
  assert(githubTemplateResult.items.find((item) => item.title === "pull_request_template.md")?.mime === "application/vnd.github.template", "pull_request_template.md MIME provenance was not preserved");

  const dependabotSummary = summaryFor(dependabotConfigResult, "dependabot.yml");
  assert(dependabotSummary.includes("Dependabot config preview"), "dependabot.yml did not use Dependabot config preview");
  assert(dependabotSummary.includes("Version: 2"), "dependabot.yml summary omitted version evidence");
  assert(dependabotSummary.includes("Update entries in bounded preview: 2"), "dependabot.yml summary omitted update count evidence");
  assert(dependabotSummary.includes("npm") && dependabotSummary.includes("github-actions"), "dependabot.yml summary omitted ecosystem evidence");
  assert(dependabotSummary.includes("/apps/desktop/windows") && dependabotSummary.includes("Directories:"), "dependabot.yml summary omitted directory evidence");
  assert(dependabotSummary.includes("interval=weekly") && dependabotSummary.includes("timezone=Asia/Shanghai"), "dependabot.yml summary omitted schedule evidence");
  assert(dependabotSummary.includes("electron-runtime") && dependabotSummary.includes("dependency-name=vite"), "dependabot.yml summary omitted group/ignore evidence");
  assert(dependabotSummary.includes("registries"), "dependabot.yml summary omitted registry risk cue");
  assert(!dependabotSummary.includes("secret-dependabot-registry-token"), "dependabot.yml summary leaked registry token");
  assert(dependabotSummary.includes("no GitHub API call") && dependabotSummary.includes("no package manager command"), "dependabot.yml summary omitted no-provider/no-package-manager safety copy");
  assert(dependabotConfigResult.items.find((item) => item.title === "dependabot.yml")?.mime === "application/vnd.github.dependabot.config+yaml", "dependabot.yml MIME provenance is missing");

  const renovateSummary = summaryFor(renovateConfigResult, "renovate.json");
  assert(renovateSummary.includes("Renovate config preview"), "renovate.json did not use Renovate config preview");
  assert(renovateSummary.includes("config:recommended") && renovateSummary.includes(":dependencyDashboard"), "renovate.json summary omitted extends evidence");
  assert(renovateSummary.includes("npm") && renovateSummary.includes("github-actions"), "renovate.json summary omitted manager evidence");
  assert(renovateSummary.includes("before 5am on monday"), "renovate.json summary omitted schedule evidence");
  assert(renovateSummary.includes("electron") && renovateSummary.includes("packageRules configured"), "renovate.json summary omitted package rule evidence");
  assert(renovateSummary.includes("registryAliases") && renovateSummary.includes("hostrules"), "renovate.json summary omitted registry/host risk cues");
  assert(!renovateSummary.includes("secret-renovate-registry-token") && !renovateSummary.includes("secret-renovate-host-token"), "renovate.json summary leaked registry or host token");
  assert(renovateSummary.includes("no Renovate CLI command") && renovateSummary.includes("no package manager command"), "renovate.json summary omitted no-runtime/no-package-manager safety copy");
  assert(renovateConfigResult.items.find((item) => item.title === "renovate.json")?.mime === "application/vnd.renovate.config+json", "renovate.json MIME provenance is missing");

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

  const bitbucketPipelinesSummary = summaryFor(ciWorkflowResult, "bitbucket-pipelines.yml");
  assert(bitbucketPipelinesSummary.includes("CI/CD workflow preview (Bitbucket Pipelines)"), "bitbucket-pipelines.yml did not use Bitbucket workflow preview");
  assert(bitbucketPipelinesSummary.includes("default") && bitbucketPipelinesSummary.includes("branches"), "bitbucket-pipelines.yml summary omitted pipeline trigger evidence");
  assert(bitbucketPipelinesSummary.includes("node:22"), "bitbucket-pipelines.yml summary omitted image evidence");
  assert(!bitbucketPipelinesSummary.includes("secret-ci-token"), "bitbucket-pipelines.yml summary leaked CI token-like value");
  assert(bitbucketPipelinesSummary.includes("no CI runner"), "bitbucket-pipelines.yml summary omitted no-runner safety copy");

  const circleCiSummary = summaryFor(ciWorkflowResult, "config.yml");
  assert(circleCiSummary.includes("CI/CD workflow preview (CircleCI)"), ".circleci/config.yml did not use CircleCI workflow preview");
  assert(circleCiSummary.includes("runtime"), ".circleci/config.yml summary omitted workflow trigger evidence");
  assert(circleCiSummary.includes("runtime-circle"), ".circleci/config.yml summary omitted job evidence");
  assert(circleCiSummary.includes("cimg/node:22.0"), ".circleci/config.yml summary omitted docker image evidence");
  assert(!circleCiSummary.includes("secret-ci-token"), ".circleci/config.yml summary leaked CI token-like value");
  assert(circleCiSummary.includes("no CI runner"), ".circleci/config.yml summary omitted no-runner safety copy");

  const buildkitePipelineSummary = summaryFor(ciWorkflowResult, "pipeline.yml");
  assert(buildkitePipelineSummary.includes("CI/CD workflow preview (Buildkite)"), ".buildkite/pipeline.yml did not use Buildkite workflow preview");
  assert(buildkitePipelineSummary.includes("runtime-buildkite"), ".buildkite/pipeline.yml summary omitted label evidence");
  assert(buildkitePipelineSummary.includes("docker#v5.11.0"), ".buildkite/pipeline.yml summary omitted plugin evidence");
  assert(!buildkitePipelineSummary.includes("secret-ci-token"), ".buildkite/pipeline.yml summary leaked CI token-like value");
  assert(buildkitePipelineSummary.includes("no CI runner"), ".buildkite/pipeline.yml summary omitted no-runner safety copy");

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

  const playwrightTraceSummary = summaryFor(documentArchiveResult, "trace.zip");
  assert(playwrightTraceSummary.includes("Playwright trace ZIP preview"), "trace.zip did not use Playwright trace ZIP preview");
  assert(playwrightTraceSummary.includes("Trace event entries: trace.trace"), "trace.zip summary omitted trace event entry evidence");
  assert(playwrightTraceSummary.includes("Network trace entries: trace.network"), "trace.zip summary omitted network entry evidence");
  assert(playwrightTraceSummary.includes("resources=2; screenshots=1; videos=1"), "trace.zip summary omitted resource/media evidence");
  assert(playwrightTraceSummary.includes("test.json"), "trace.zip summary omitted metadata entry evidence");
  assert(!playwrightTraceSummary.includes("secret-trace-token"), "trace.zip summary leaked trace diagnostic secret");
  assert(playwrightTraceSummary.includes("trace resources were not extracted"), "trace.zip summary omitted no-extraction safety copy");
  assert(documentArchiveResult.items.find((item) => item.title === "trace.zip")?.mime === "application/vnd.playwright.trace+zip", "trace.zip MIME provenance is missing");

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

  const bazelBuildSummary = summaryFor(packageManifestResult, "BUILD.bazel");
  assert(bazelBuildSummary.includes("Bazel/Starlark build file preview"), "BUILD.bazel did not use Bazel/Starlark preview");
  assert(bazelBuildSummary.includes("Bazel BUILD package"), "BUILD.bazel summary omitted BUILD format evidence");
  assert(bazelBuildSummary.includes("@rules_js//js:defs.bzl"), "BUILD.bazel summary omitted load statement evidence");
  assert(bazelBuildSummary.includes("runtime_bazel_lib"), "BUILD.bazel summary omitted target evidence");
  assert(bazelBuildSummary.includes("//apps/desktop/windows:shared"), "BUILD.bazel summary omitted dependency label evidence");
  assert(bazelBuildSummary.includes("genrule command") && bazelBuildSummary.includes("shell command attribute"), "BUILD.bazel summary omitted static risk evidence");
  assert(!bazelBuildSummary.includes("secret-bazel-token"), "BUILD.bazel summary leaked secret-shaped command value");
  assert(bazelBuildSummary.includes("no bazel/bzlmod command"), "BUILD.bazel summary omitted no-Bazel safety copy");
  assert(packageManifestResult.items.find((item) => item.title === "BUILD.bazel")?.mime === "text/x-bazel", "BUILD.bazel MIME provenance is missing");

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

  const pypircSummary = summaryFor(pythonManifestResult, ".pypirc");
  assert(pypircSummary.includes("Python package index config preview"), ".pypirc did not use Python package index config preview");
  assert(pypircSummary.includes("Index servers (2): pypi, internal"), ".pypirc summary omitted index server evidence");
  assert(pypircSummary.includes("pypi=https://upload.pypi.org/legacy/?token=[redacted]"), ".pypirc summary omitted redacted repository URL evidence");
  assert(pypircSummary.includes("Credential keys") && pypircSummary.includes("pypi.password [value hidden]"), ".pypirc summary omitted credential key hiding evidence");
  assert(pypircSummary.includes("Certificate/keyring hints") && pypircSummary.includes("internal.ca_cert") && pypircSummary.includes("internal.client_cert"), ".pypirc summary omitted certificate hint evidence");
  assert(!pypircSummary.includes("secret-pypirc-token") && !pypircSummary.includes("secret-pypirc-internal-token") && !pypircSummary.includes("secret-pypirc-url-token"), ".pypirc summary leaked secret values");
  assert(pypircSummary.includes("no Python interpreter, twine, pip"), ".pypirc summary omitted no-Python/twine safety copy");
  assert(pythonManifestResult.items.find((item) => item.title === ".pypirc")?.mime === "text/x-pypirc", ".pypirc MIME provenance is missing");

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

  const podfileSummary = summaryFor(appleManifestVariantResult, "Podfile");
  assert(podfileSummary.includes("Apple package manifest preview"), "Podfile did not use Apple package manifest preview");
  assert(podfileSummary.includes("CocoaPods Podfile"), "Podfile summary omitted CocoaPods format evidence");
  assert(podfileSummary.includes("RuntimeFixtureApp"), "Podfile summary omitted target evidence");
  assert(podfileSummary.includes("Alamofire"), "Podfile summary omitted pod dependency evidence");
  assert(podfileSummary.includes("no swift, xcodebuild, pod"), "Podfile summary omitted no-Apple-toolchain safety copy");

  const podfileLockSummary = summaryFor(appleManifestVariantResult, "Podfile.lock");
  assert(podfileLockSummary.includes("Apple package manifest preview"), "Podfile.lock did not use Apple package manifest preview");
  assert(podfileLockSummary.includes("CocoaPods Podfile.lock"), "Podfile.lock summary omitted CocoaPods lockfile format evidence");
  assert(podfileLockSummary.includes("Alamofire") && podfileLockSummary.includes("RuntimeFixtureKit"), "Podfile.lock summary omitted locked dependency evidence");
  assert(podfileLockSummary.includes("spec checksums"), "Podfile.lock summary omitted checksum section evidence");
  assert(podfileLockSummary.includes("no swift, xcodebuild, pod"), "Podfile.lock summary omitted no-Apple-toolchain safety copy");

  const pbxprojSummary = summaryFor(appleManifestVariantResult, "project.pbxproj");
  assert(pbxprojSummary.includes("Xcode project.pbxproj preview"), "project.pbxproj did not use Xcode project preview");
  assert(pbxprojSummary.includes("RuntimeFixtureApp"), "project.pbxproj summary omitted target evidence");
  assert(pbxprojSummary.includes("PRODUCT_BUNDLE_IDENTIFIER=org.opendrsai.runtime.ios"), "project.pbxproj summary omitted bundle identifier evidence");
  assert(pbxprojSummary.includes("IPHONEOS_DEPLOYMENT_TARGET=17.0"), "project.pbxproj summary omitted deployment target evidence");
  assert(pbxprojSummary.includes("AppDelegate.swift"), "project.pbxproj summary omitted source file evidence");
  assert(!pbxprojSummary.includes("SECRETTEAM"), "project.pbxproj summary leaked signing team token");
  assert(pbxprojSummary.includes("no Xcode project load, xcodebuild command"), "project.pbxproj summary omitted no-Xcode-runtime safety copy");

  const podspecSummary = summaryFor(appleManifestVariantResult, "RuntimeFixture.podspec");
  assert(podspecSummary.includes("Apple package manifest preview"), "podspec did not use Apple package manifest preview");
  assert(podspecSummary.includes("CocoaPods podspec"), "podspec summary omitted CocoaPods podspec format evidence");
  assert(podspecSummary.includes("RuntimeFixtureKit"), "podspec summary omitted podspec package evidence");
  assert(podspecSummary.includes("source_files"), "podspec summary omitted source_files product evidence");
  assert(podspecSummary.includes("no swift, xcodebuild, pod"), "podspec summary omitted no-Apple-toolchain safety copy");

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

  const emlxSummary = summaryFor(personalInfoResult, "message.emlx");
  assert(emlxSummary.includes("Email message preview"), "message.emlx did not use email message preview");
  assert(emlxSummary.includes("Runtime Apple Mail fixture"), "message.emlx summary omitted subject evidence");
  assert(emlxSummary.includes("Apple Mail EMLX envelope metadata was stripped"), "message.emlx summary omitted EMLX envelope stripping evidence");
  assert(!emlxSummary.includes("<?xml"), "message.emlx summary leaked Apple Mail plist metadata");
  assert(emlxSummary.includes("no IMAP/SMTP login"), "message.emlx summary omitted no-mailbox safety copy");

  const mboxSummary = summaryFor(personalInfoResult, "mailbox.mbox");
  assert(mboxSummary.includes("Mailbox archive preview"), "mailbox.mbox did not use mailbox archive preview");
  assert(mboxSummary.includes("Runtime mailbox fixture"), "mailbox.mbox summary omitted subject evidence");
  assert(mboxSummary.includes("no IMAP/SMTP login"), "mailbox.mbox summary omitted no-mailbox safety copy");

  const telegramSummary = summaryFor(personalInfoResult, "telegram-export.json");
  assert(telegramSummary.includes("Chat export JSON preview (Telegram export JSON"), "telegram-export.json did not use Telegram chat export preview");
  assert(telegramSummary.includes("Runtime Telegram Fixture"), "telegram-export.json summary omitted Telegram conversation evidence");
  assert(telegramSummary.includes("Runtime Telegram Sender") && telegramSummary.includes("Runtime Telegram Reviewer"), "telegram-export.json summary omitted Telegram participant evidence");
  assert(telegramSummary.includes("token=[redacted]"), "telegram-export.json summary omitted token redaction evidence");
  assert(!telegramSummary.includes("secret-telegram-token"), "telegram-export.json summary leaked Telegram token value");
  assert(telegramSummary.includes("no Slack/Teams/Telegram/ChatGPT/OpenAI connector login"), "telegram-export.json summary omitted no-provider safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "telegram-export.json")?.mime === "application/vnd.drsai.chat-export+json", "telegram-export.json MIME provenance is missing");

  const whatsappSummary = summaryFor(personalInfoResult, "whatsapp-chat.txt");
  assert(whatsappSummary.includes("Chat text export preview (WhatsApp chat text export"), "whatsapp-chat.txt did not use WhatsApp chat text preview");
  assert(whatsappSummary.includes("Runtime WhatsApp Sender") && whatsappSummary.includes("Runtime WhatsApp Reviewer"), "whatsapp-chat.txt summary omitted WhatsApp participant evidence");
  assert(whatsappSummary.includes("continued detail line"), "whatsapp-chat.txt summary omitted continued message evidence");
  assert(whatsappSummary.includes("token=[redacted]"), "whatsapp-chat.txt summary omitted token redaction evidence");
  assert(!whatsappSummary.includes("secret-whatsapp-token"), "whatsapp-chat.txt summary leaked WhatsApp token value");
  assert(whatsappSummary.includes("no WhatsApp/mobile connector login"), "whatsapp-chat.txt summary omitted no-mobile safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "whatsapp-chat.txt")?.mime === "text/plain+chat-export", "whatsapp-chat.txt MIME provenance is missing");

  const meetingTranscriptSummary = summaryFor(personalInfoResult, "zoom-transcript.txt");
  assert(meetingTranscriptSummary.includes("Meeting transcript preview (Zoom meeting transcript"), "zoom-transcript.txt did not use Zoom meeting transcript preview");
  assert(meetingTranscriptSummary.includes("Runtime Transcript Review"), "zoom-transcript.txt summary omitted meeting title evidence");
  assert(meetingTranscriptSummary.includes("Runtime Facilitator") && meetingTranscriptSummary.includes("Runtime Reviewer") && meetingTranscriptSummary.includes("Runtime Owner"), "zoom-transcript.txt summary omitted participant evidence");
  assert(meetingTranscriptSummary.includes("Decision/risk: Decision: keep local preview only"), "zoom-transcript.txt summary omitted decision cue evidence");
  assert(meetingTranscriptSummary.includes("Action: Action item: add fixture coverage due by Friday"), "zoom-transcript.txt summary omitted action cue evidence");
  assert(meetingTranscriptSummary.includes("token=[redacted]"), "zoom-transcript.txt summary omitted token redaction evidence");
  assert(!meetingTranscriptSummary.includes("secret-meeting-transcript-token"), "zoom-transcript.txt summary leaked meeting transcript token value");
  assert(meetingTranscriptSummary.includes("no Zoom/Teams/Google Meet app") && meetingTranscriptSummary.includes("transcription service"), "zoom-transcript.txt summary omitted no-meeting-runtime safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "zoom-transcript.txt")?.mime === "text/plain+meeting-transcript", "zoom-transcript.txt MIME provenance is missing");

  const vcardSummary = summaryFor(personalInfoResult, "contact.vcf");
  assert(vcardSummary.includes("vCard contact preview"), "contact.vcf did not use vCard preview");
  assert(vcardSummary.includes("Runtime Contact"), "contact.vcf summary omitted contact name evidence");
  assert(vcardSummary.includes("no contacts app access"), "contact.vcf summary omitted no-contacts safety copy");

  const contactsCsvSummary = summaryFor(personalInfoResult, "contacts.csv");
  assert(contactsCsvSummary.includes("Contact CSV export preview"), "contacts.csv did not use contact CSV preview");
  assert(contactsCsvSummary.includes("Runtime CSV Contact"), "contacts.csv summary omitted contact name evidence");
  assert(contactsCsvSummary.includes("OpenDrSai CSV") && contactsCsvSummary.includes("Runtime Reviewer"), "contacts.csv summary omitted organization/title evidence");
  assert(contactsCsvSummary.includes("*@example.test"), "contacts.csv summary omitted email-domain evidence");
  assert(contactsCsvSummary.includes("Mobile Phone: <redacted 11 digits>"), "contacts.csv summary omitted phone redaction evidence");
  assert(contactsCsvSummary.includes("Shanghai, CN"), "contacts.csv summary omitted bounded location evidence");
  assert(!contactsCsvSummary.includes("runtime-csv-secret") && !contactsCsvSummary.includes("555-0199") && !contactsCsvSummary.includes("secret-contact-csv-token"), "contacts.csv summary leaked contact sensitive values");
  assert(contactsCsvSummary.includes("no contacts app access") && contactsCsvSummary.includes("contact write"), "contacts.csv summary omitted no-contacts/no-write safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "contacts.csv")?.mime === "text/csv+contacts", "contacts.csv MIME provenance is missing");

  const icsSummary = summaryFor(personalInfoResult, "calendar.ics");
  assert(icsSummary.includes("Calendar ICS file preview"), "calendar.ics did not use calendar ICS preview");
  assert(icsSummary.includes("Runtime Fixture Review"), "calendar.ics summary omitted event title evidence");
  assert(icsSummary.includes("Time zones: Asia/Shanghai"), "calendar.ics summary omitted timezone evidence");
  assert(icsSummary.includes("Status: CONFIRMED") && icsSummary.includes("Organizer: runtime-owner@example.test"), "calendar.ics summary omitted status/organizer evidence");
  assert(icsSummary.includes("Recurrence: FREQ=WEEKLY;COUNT=4;BYDAY=TH"), "calendar.ics summary omitted recurrence rule evidence");
  assert(icsSummary.includes("Exdates: 20260723T173000 (Asia/Shanghai)"), "calendar.ics summary omitted recurrence exclusion evidence");
  assert(icsSummary.includes("Alarms: action=DISPLAY") && icsSummary.includes("trigger=-PT15M") && icsSummary.includes("description=Review reminder token=[redacted]"), "calendar.ics summary omitted alarm evidence");
  assert(icsSummary.includes("token=[redacted]"), "calendar.ics summary omitted token redaction evidence");
  assert(!icsSummary.includes("secret-runtime-ics-token") && !icsSummary.includes("secret-runtime-ics-alarm"), "calendar.ics summary leaked token-like calendar value");
  assert(icsSummary.includes("no calendar app access"), "calendar.ics summary omitted no-calendar safety copy");

  const icalSummary = summaryFor(personalInfoResult, "calendar.ical");
  assert(icalSummary.includes("Calendar ICS file preview"), "calendar.ical did not use calendar ICS preview");
  assert(icalSummary.includes("Runtime ICAL Planning"), "calendar.ical summary omitted event title evidence");
  assert(icalSummary.includes("no calendar app access"), "calendar.ical summary omitted no-calendar safety copy");

  const vcsSummary = summaryFor(personalInfoResult, "calendar.vcs");
  assert(vcsSummary.includes("Calendar ICS file preview"), "calendar.vcs did not use calendar ICS preview");
  assert(vcsSummary.includes("Runtime VCS Handoff"), "calendar.vcs summary omitted event title evidence");
  assert(vcsSummary.includes("token=[redacted]"), "calendar.vcs summary omitted token redaction evidence");
  assert(!vcsSummary.includes("secret-runtime-vcs-token"), "calendar.vcs summary leaked token-like location value");
  assert(vcsSummary.includes("no calendar app access"), "calendar.vcs summary omitted no-calendar safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "calendar.vcs")?.mime === "text/x-vcalendar", "calendar.vcs MIME provenance is missing");

  const calendarCsvSummary = summaryFor(personalInfoResult, "calendar-agenda.csv");
  assert(calendarCsvSummary.includes("Calendar CSV agenda preview"), "calendar-agenda.csv did not use calendar CSV agenda preview");
  assert(calendarCsvSummary.includes("Runtime CSV Planning"), "calendar-agenda.csv summary omitted event title evidence");
  assert(calendarCsvSummary.includes("CSV Room token=[redacted]"), "calendar-agenda.csv summary omitted token redaction evidence");
  assert(!calendarCsvSummary.includes("secret-calendar-csv-token"), "calendar-agenda.csv summary leaked token-like location value");
  assert(!calendarCsvSummary.includes("secret-calendar-description-token"), "calendar-agenda.csv summary leaked description value");
  assert(calendarCsvSummary.includes("event descriptions were not expanded"), "calendar-agenda.csv summary omitted no-description-expansion safety copy");
  assert(calendarCsvSummary.includes("no calendar app access"), "calendar-agenda.csv summary omitted no-calendar safety copy");
  assert(personalInfoResult.items.find((item) => item.title === "calendar-agenda.csv")?.mime === "text/csv+calendar", "calendar-agenda.csv MIME provenance is missing");

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

  const openApiJsonSummary = summaryFor(openApiJsonResult, "openapi.json");
  assert(openApiJsonSummary.includes("API spec/collection preview"), "openapi.json did not use API spec preview");
  assert(openApiJsonSummary.includes("OpenAPI 3.1.0"), "openapi.json summary omitted OpenAPI JSON format evidence");
  assert(openApiJsonSummary.includes("Runtime Fixture JSON API"), "openapi.json summary omitted JSON API title evidence");
  assert(openApiJsonSummary.includes("/json-runs"), "openapi.json summary omitted JSON endpoint evidence");
  assert(openApiJsonSummary.includes("json-api.example.test"), "openapi.json summary omitted JSON server host evidence");
  assert(openApiJsonSummary.includes("apiKeyAuth"), "openapi.json summary omitted JSON security scheme evidence");
  assert(!openApiJsonSummary.includes("secret-json-openapi-token"), "openapi.json summary leaked sensitive URL token");
  assert(openApiJsonSummary.includes("no request execution"), "openapi.json summary omitted no-request safety copy");

  const asyncApiSummary = summaryFor(asyncApiResult, "asyncapi.yaml");
  assert(asyncApiSummary.includes("API spec/collection preview"), "asyncapi.yaml did not use API spec preview");
  assert(asyncApiSummary.includes("AsyncAPI YAML 2.6.0"), "asyncapi.yaml summary omitted AsyncAPI format evidence");
  assert(asyncApiSummary.includes("Runtime Fixture Events"), "asyncapi.yaml summary omitted AsyncAPI title evidence");
  assert(asyncApiSummary.includes("runtime/runs/started"), "asyncapi.yaml summary omitted subscribe channel evidence");
  assert(asyncApiSummary.includes("runtime/runs/commands"), "asyncapi.yaml summary omitted publish channel evidence");
  assert(!asyncApiSummary.includes("secret-asyncapi-token"), "asyncapi.yaml summary leaked sensitive broker token");
  assert(asyncApiSummary.includes("no request execution, broker connection"), "asyncapi.yaml summary omitted no-request/no-broker safety copy");

  const asyncApiJsonSummary = summaryFor(asyncApiJsonResult, "asyncapi.json");
  assert(asyncApiJsonSummary.includes("API spec/collection preview"), "asyncapi.json did not use API spec preview");
  assert(asyncApiJsonSummary.includes("AsyncAPI 3.0.0"), "asyncapi.json summary omitted AsyncAPI JSON format evidence");
  assert(asyncApiJsonSummary.includes("Runtime Fixture JSON Events"), "asyncapi.json summary omitted AsyncAPI JSON title evidence");
  assert(asyncApiJsonSummary.includes("runtime/json/runs/started"), "asyncapi.json summary omitted receive channel evidence");
  assert(asyncApiJsonSummary.includes("runtime/json/runs/commands"), "asyncapi.json summary omitted send channel evidence");
  assert(asyncApiJsonSummary.includes("brokerJsonToken"), "asyncapi.json summary omitted security scheme evidence");
  assert(!asyncApiJsonSummary.includes("secret-asyncapi-json-token"), "asyncapi.json summary leaked sensitive broker token");
  assert(asyncApiJsonSummary.includes("no request execution, broker connection"), "asyncapi.json summary omitted no-request/no-broker safety copy");

  const insomniaSummary = summaryFor(apiSchemaContainerResult, "insomnia.json");
  assert(insomniaSummary.includes("API spec/collection preview"), "insomnia.json did not use API client collection preview");
  assert(insomniaSummary.includes("Insomnia export"), "insomnia.json summary omitted Insomnia format evidence");
  assert(insomniaSummary.includes("Runtime Insomnia Workspace"), "insomnia.json summary omitted workspace title evidence");
  assert(insomniaSummary.includes("Runtime Insomnia List"), "insomnia.json summary omitted request name evidence");
  assert(insomniaSummary.includes("https://api.example.test/insomnia/runs?token=REDACTED"), "insomnia.json summary omitted sanitized request evidence");
  assert(!insomniaSummary.includes("secret-insomnia-token"), "insomnia.json summary leaked sensitive token");
  assert(insomniaSummary.includes("no request execution"), "insomnia.json summary omitted no-request safety copy");

  const insomniaYamlSummary = summaryFor(insomniaYamlResult, "insomnia.yaml");
  assert(insomniaYamlSummary.includes("API spec/collection preview"), "insomnia.yaml did not use API client collection preview");
  assert(insomniaYamlSummary.includes("Insomnia YAML export"), "insomnia.yaml summary omitted Insomnia YAML format evidence");
  assert(insomniaYamlSummary.includes("Runtime Insomnia YAML Workspace"), "insomnia.yaml summary omitted workspace title evidence");
  assert(insomniaYamlSummary.includes("Runtime Insomnia YAML List"), "insomnia.yaml summary omitted request name evidence");
  assert(insomniaYamlSummary.includes("https://api.example.test/insomnia-yaml/runs?token=REDACTED"), "insomnia.yaml summary omitted sanitized request evidence");
  assert(insomniaYamlSummary.includes("bearer"), "insomnia.yaml summary omitted authentication mode evidence");
  assert(!insomniaYamlSummary.includes("secret-insomnia-yaml-token"), "insomnia.yaml summary leaked sensitive token");
  assert(insomniaYamlSummary.includes("no request execution"), "insomnia.yaml summary omitted no-request safety copy");

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

  const graphqlIntrospectionSummary = summaryFor(apiSchemaContainerResult, "schema-introspection.json");
  assert(graphqlIntrospectionSummary.includes("GraphQL introspection JSON preview"), "schema-introspection.json did not use GraphQL introspection preview");
  assert(graphqlIntrospectionSummary.includes("query:Query") && graphqlIntrospectionSummary.includes("mutation:Mutation"), "schema-introspection.json summary omitted root type evidence");
  assert(graphqlIntrospectionSummary.includes("RuntimeRun") && graphqlIntrospectionSummary.includes("StartRunInput"), "schema-introspection.json summary omitted object/input type evidence");
  assert(graphqlIntrospectionSummary.includes("@runtimeAuth"), "schema-introspection.json summary omitted directive evidence");
  assert(graphqlIntrospectionSummary.includes("Node: RuntimeRun"), "schema-introspection.json summary omitted possible type evidence");
  assert(!graphqlIntrospectionSummary.includes("secret-graphql-introspection-token"), "schema-introspection.json summary leaked description secret");
  assert(!graphqlIntrospectionSummary.includes("secret-default-value"), "schema-introspection.json summary leaked default value");
  assert(graphqlIntrospectionSummary.includes("no GraphQL request execution, schema introspection request"), "schema-introspection.json summary omitted no-request/no-introspection safety copy");

  const pactContractSummary = summaryFor(apiSchemaContainerResult, "runtime.pact.json");
  assert(pactContractSummary.includes("Pact contract JSON preview"), "runtime.pact.json did not use Pact contract preview");
  assert(pactContractSummary.includes("Runtime Desktop Client"), "runtime.pact.json summary omitted consumer evidence");
  assert(pactContractSummary.includes("Runtime API"), "runtime.pact.json summary omitted provider evidence");
  assert(pactContractSummary.includes("Pact specification: 3.0.0"), "runtime.pact.json summary omitted Pact spec version evidence");
  assert(pactContractSummary.includes("GET /runs?token=[redacted] -> 200"), "runtime.pact.json summary omitted sanitized GET interaction evidence");
  assert(pactContractSummary.includes("POST /runs -> 201"), "runtime.pact.json summary omitted POST interaction evidence");
  assert(pactContractSummary.includes("runtime runs exist") && pactContractSummary.includes("runtime creation is allowed"), "runtime.pact.json summary omitted provider state evidence");
  assert(pactContractSummary.includes("$.body.runs[*].id") && pactContractSummary.includes("$.body.prompt"), "runtime.pact.json summary omitted matching rule evidence");
  assert(!pactContractSummary.includes("secret-pact-query-token"), "runtime.pact.json summary leaked query token");
  assert(!pactContractSummary.includes("secret-pact-auth-token"), "runtime.pact.json summary leaked auth token");
  assert(!pactContractSummary.includes("secret-pact-request-body-token"), "runtime.pact.json summary leaked request body token");
  assert(!pactContractSummary.includes("secret-pact-response-token"), "runtime.pact.json summary leaked response body token");
  assert(pactContractSummary.includes("no Pact CLI command, Pact Broker connection, provider verification"), "runtime.pact.json summary omitted no-Pact-runtime safety copy");

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
  assert(apiComposeSummary.includes("api=./services/api"), "docker-compose.yaml summary omitted build context evidence");
  assert(apiComposeSummary.includes("api:8080:8080"), "docker-compose.yaml summary omitted port mapping evidence");
  assert(apiComposeSummary.includes("api->db"), "docker-compose.yaml summary omitted depends_on evidence");
  assert(apiComposeSummary.includes("Profiles: runtime"), "docker-compose.yaml summary omitted profile evidence");
  assert(apiComposeSummary.includes("volumes.runtime-db") && apiComposeSummary.includes("networks.runtime-net") && apiComposeSummary.includes("secrets.runtime-api-token"), "docker-compose.yaml summary omitted top-level resource evidence");
  assert(!apiComposeSummary.includes("secret-compose-token"), "docker-compose.yaml summary leaked secret-like environment value");
  assert(apiComposeSummary.includes("no docker compose command"), "docker-compose.yaml summary omitted no-compose safety copy in API/schema/container fixture group");
  assert(apiSchemaContainerResult.items.find((item) => item.title === "docker-compose.yaml")?.mime === "application/vnd.docker.compose+yaml", "docker-compose.yaml MIME provenance is missing");

  const wingetSummary = summaryFor(apiSchemaContainerResult, "HepAI.OpenDrSai.installer.yaml");
  assert(wingetSummary.includes("Windows Package Manager manifest preview"), "winget manifest did not use winget preview");
  assert(wingetSummary.includes("Package identifier: HepAI.OpenDrSai"), "winget manifest summary omitted package identifier evidence");
  assert(wingetSummary.includes("Package version: 1.4.2"), "winget manifest summary omitted package version evidence");
  assert(wingetSummary.includes("Manifest type: installer"), "winget manifest summary omitted manifest type evidence");
  assert(wingetSummary.includes("x64 type=wix scope=machine"), "winget manifest summary omitted installer architecture/type/scope evidence");
  assert(wingetSummary.includes("token=REDACTED"), "winget manifest summary omitted redacted installer URL token evidence");
  assert(wingetSummary.includes("sha256=64 chars prefix 0123456789ab"), "winget manifest summary omitted bounded SHA256 evidence");
  assert(!wingetSummary.includes("secret-winget-token"), "winget manifest summary leaked installer URL token");
  assert(wingetSummary.includes("no winget command, installer download, installer execution"), "winget manifest summary omitted no-winget/no-installer safety copy");
  assert(apiSchemaContainerResult.items.find((item) => item.title === "HepAI.OpenDrSai.installer.yaml")?.mime === "application/vnd.microsoft.winget.manifest+yaml", "winget manifest MIME provenance is missing");

  const chartSummary = summaryFor(apiSchemaContainerResult, "Chart.yaml");
  assert(chartSummary.includes("Kubernetes package config preview"), "Chart.yaml did not use Kubernetes package config preview");
  assert(chartSummary.includes("Helm Chart.yaml"), "Chart.yaml summary omitted Helm format evidence");
  assert(chartSummary.includes("runtime-chart"), "Chart.yaml summary omitted chart name evidence");
  assert(chartSummary.includes("runtime-lib"), "Chart.yaml summary omitted dependency evidence");
  assert(chartSummary.includes("token=REDACTED"), "Chart.yaml summary omitted redacted repository URL token evidence");
  assert(!chartSummary.includes("secret-helm-token"), "Chart.yaml summary leaked Helm repository token");
  assert(chartSummary.includes("no helm/kubectl/kustomize command"), "Chart.yaml summary omitted no-runtime safety copy");

  const helmValuesSummary = summaryFor(apiSchemaContainerResult, "values.yaml");
  assert(helmValuesSummary.includes("Helm values preview"), "values.yaml did not use Helm values preview");
  assert(helmValuesSummary.includes("repository=ghcr.io/example/runtime-api"), "values.yaml summary omitted image repository evidence");
  assert(helmValuesSummary.includes("tag=v1.2.3"), "values.yaml summary omitted image tag evidence");
  assert(helmValuesSummary.includes("replicaCount=3"), "values.yaml summary omitted replica evidence");
  assert(helmValuesSummary.includes("type=ClusterIP") && helmValuesSummary.includes("port=80"), "values.yaml summary omitted service evidence");
  assert(helmValuesSummary.includes("enabled=true") && helmValuesSummary.includes("className=nginx") && helmValuesSummary.includes("host=runtime.example.test"), "values.yaml summary omitted ingress evidence");
  assert(helmValuesSummary.includes("resources.requests.cpu") && helmValuesSummary.includes("resources.limits.memory"), "values.yaml summary omitted resource key evidence");
  assert(helmValuesSummary.includes("LOG_LEVEL"), "values.yaml summary omitted env key evidence");
  assert(helmValuesSummary.includes("APP_MODE"), "values.yaml summary omitted config key evidence");
  assert(helmValuesSummary.includes("secretApiToken"), "values.yaml summary omitted secret key-name evidence");
  assert(!helmValuesSummary.includes("secret-helm-values-token"), "values.yaml summary leaked secret-shaped value");
  assert(helmValuesSummary.includes("no helm/kubectl command, chart dependency build, template rendering"), "values.yaml summary omitted no-Helm runtime safety copy");
  assert(apiSchemaContainerResult.items.find((item) => item.title === "values.yaml")?.mime === "application/vnd.cncf.helm.values+yaml", "Helm values MIME provenance is missing");

  const kustomizationSummary = summaryFor(apiSchemaContainerResult, "kustomization.yaml");
  assert(kustomizationSummary.includes("Kubernetes package config preview"), "kustomization.yaml did not use Kubernetes package config preview");
  assert(kustomizationSummary.includes("Kustomize kustomization"), "kustomization.yaml summary omitted Kustomize format evidence");
  assert(kustomizationSummary.includes("deployment.yaml") && kustomizationSummary.includes("service.yaml"), "kustomization.yaml summary omitted resource evidence");
  assert(kustomizationSummary.includes("ghcr.io/example/runtime=>ghcr.io/example/runtime-app:v1.2.3"), "kustomization.yaml summary omitted image rewrite evidence");
  assert(kustomizationSummary.includes("patches/deployment.yaml"), "kustomization.yaml summary omitted patch evidence");
  assert(kustomizationSummary.includes("runtime-system"), "kustomization.yaml summary omitted namespace evidence");
  assert(kustomizationSummary.includes("no helm/kubectl/kustomize command"), "kustomization.yaml summary omitted no-runtime safety copy");

  const kubeconfigSummary = summaryFor(apiSchemaContainerResult, "config");
  assert(kubeconfigSummary.includes("Kubernetes kubeconfig preview"), ".kube/config did not use Kubernetes kubeconfig preview");
  assert(kubeconfigSummary.includes("Current context: runtime-prod"), ".kube/config summary omitted current-context evidence");
  assert(kubeconfigSummary.includes("runtime-prod-cluster") && kubeconfigSummary.includes("server=https://kube.example.test:6443"), ".kube/config summary omitted cluster/server evidence");
  assert(kubeconfigSummary.includes("runtime-prod cluster=runtime-prod-cluster user=runtime-admin namespace=runtime-system"), ".kube/config summary omitted context evidence");
  assert(kubeconfigSummary.includes("runtime-admin auth=token+client-certificate-data+client-key-data"), ".kube/config summary omitted user credential-key evidence");
  assert(kubeconfigSummary.includes("cluster.certificate-authority-data"), ".kube/config summary omitted cluster credential-key evidence");
  assert(!kubeconfigSummary.includes("secret-kube"), ".kube/config summary leaked kubeconfig credential material");
  assert(kubeconfigSummary.includes("no kubectl command, cluster connection, token validation"), ".kube/config summary omitted no-kubectl/no-cluster safety copy");
  assert(apiSchemaContainerResult.items.find((item) => item.title === "config")?.mime === "application/vnd.kubernetes.kubeconfig+yaml", ".kube/config MIME provenance is missing");

  const kubernetesManifestSummary = summaryFor(kubernetesManifestResult, "runtime-kubernetes.yaml");
  assert(kubernetesManifestSummary.includes("Kubernetes manifest preview"), "runtime-kubernetes.yaml did not use Kubernetes manifest preview");
  assert(kubernetesManifestSummary.includes("Deployment/runtime-api namespace=runtime-system"), "runtime-kubernetes.yaml summary omitted Deployment resource evidence");
  assert(kubernetesManifestSummary.includes("Service/runtime-api namespace=runtime-system"), "runtime-kubernetes.yaml summary omitted Service resource evidence");
  assert(kubernetesManifestSummary.includes("Ingress/runtime-api"), "runtime-kubernetes.yaml summary omitted Ingress resource evidence");
  assert(kubernetesManifestSummary.includes("Container names: api"), "runtime-kubernetes.yaml summary omitted container evidence");
  assert(kubernetesManifestSummary.includes("ghcr.io/example/runtime-api:v1.2.3"), "runtime-kubernetes.yaml summary omitted image evidence");
  assert(kubernetesManifestSummary.includes("configMapRef:runtime-config") && kubernetesManifestSummary.includes("serviceAccountName:runtime-runner"), "runtime-kubernetes.yaml summary omitted config/service account references");
  assert(kubernetesManifestSummary.includes("Local resource details"), "runtime-kubernetes.yaml summary omitted local resource detail line");
  assert(kubernetesManifestSummary.includes("Selector app=runtime-api"), "runtime-kubernetes.yaml summary omitted selector evidence");
  assert(kubernetesManifestSummary.includes("Service port http:80->8080/TCP"), "runtime-kubernetes.yaml summary omitted service port evidence");
  assert(kubernetesManifestSummary.includes("Ingress host runtime.example.test") && kubernetesManifestSummary.includes("Ingress path /api"), "runtime-kubernetes.yaml summary omitted ingress host/path evidence");
  assert(kubernetesManifestSummary.includes("ConfigMap key APP_MODE") && kubernetesManifestSummary.includes("Secret key api-token"), "runtime-kubernetes.yaml summary omitted ConfigMap/Secret key evidence");
  assert(!kubernetesManifestSummary.includes("secret-kubernetes-token"), "runtime-kubernetes.yaml summary leaked Kubernetes secret value");
  assert(kubernetesManifestSummary.includes("no kubectl command, cluster connection, manifest apply"), "runtime-kubernetes.yaml summary omitted no-kubectl/no-cluster safety copy");

  const iisWebConfigSummary = summaryFor(iisWebConfigResult, "web.config");
  assert(iisWebConfigSummary.includes("IIS web.config preview"), "web.config did not use IIS web.config preview");
  assert(iisWebConfigSummary.includes("FeatureFlag=enabled"), "web.config summary omitted appSettings evidence");
  assert(iisWebConfigSummary.includes("ApiSecret=[redacted]"), "web.config summary omitted appSettings secret redaction");
  assert(iisWebConfigSummary.includes("RuntimeDb provider=System.Data.SqlClient"), "web.config summary omitted connection string name/provider evidence");
  assert(!iisWebConfigSummary.includes("secret-iis-db-password"), "web.config summary leaked connection string secret");
  assert(iisWebConfigSummary.includes("RuntimeHandler") && iisWebConfigSummary.includes("ManagedPipelineHandler"), "web.config summary omitted handler evidence");
  assert(iisWebConfigSummary.includes("RuntimeModule"), "web.config summary omitted module evidence");
  assert(iisWebConfigSummary.includes("authentication mode=Windows") && iisWebConfigSummary.includes("windowsAuthentication enabled=true"), "web.config summary omitted authentication evidence");
  assert(iisWebConfigSummary.includes("Runtime rewrite") && iisWebConfigSummary.includes("token=[redacted]"), "web.config summary omitted rewrite/token redaction evidence");
  assert(!iisWebConfigSummary.includes("secret-iis-token") && !iisWebConfigSummary.includes("secret-iis-url-token"), "web.config summary leaked secret tokens");
  assert(iisWebConfigSummary.includes("compilation targetFramework=4.8") && iisWebConfigSummary.includes("httpRuntime maxRequestLength=4096"), "web.config summary omitted ASP.NET hints");
  assert(iisWebConfigSummary.includes("admin/[redacted]"), "web.config summary omitted location path redaction evidence");
  assert(iisWebConfigSummary.includes("no IIS service, appcmd, PowerShell, ASP.NET runtime"), "web.config summary omitted no-IIS-runtime safety copy");

  const iisApplicationHostSummary = summaryFor(iisWebConfigResult, "applicationHost.config");
  assert(iisApplicationHostSummary.includes("IIS web.config preview (IIS applicationHost.config"), "applicationHost.config did not use IIS applicationHost preview");
  assert(iisApplicationHostSummary.includes("name=Runtime Site id=7 serverAutoStart=true"), "applicationHost.config summary omitted Runtime Site evidence");
  assert(iisApplicationHostSummary.includes("name=Admin Site id=8 serverAutoStart=false"), "applicationHost.config summary omitted Admin Site evidence");
  assert(iisApplicationHostSummary.includes("name=RuntimeAppPool runtime=v4.0 pipeline=Integrated autoStart=true"), "applicationHost.config summary omitted RuntimeAppPool evidence");
  assert(iisApplicationHostSummary.includes("name=LegacyPool runtime=v2.0 pipeline=Classic autoStart=false"), "applicationHost.config summary omitted LegacyPool evidence");
  assert(iisApplicationHostSummary.includes("Runtime Site protocol=https binding=*:443:runtime-host.example.test?token=[redacted] sslFlags=1"), "applicationHost.config summary omitted HTTPS binding redaction evidence");
  assert(iisApplicationHostSummary.includes("Admin Site protocol=https binding=*:8443:admin-runtime.example.test?token=[redacted]"), "applicationHost.config summary omitted admin binding redaction evidence");
  assert(!iisApplicationHostSummary.includes("secret-apphost-binding-token") && !iisApplicationHostSummary.includes("secret-apphost-admin-token"), "applicationHost.config summary leaked binding token");
  assert(iisApplicationHostSummary.includes("no IIS service, appcmd, PowerShell, ASP.NET runtime"), "applicationHost.config summary omitted no-IIS-runtime safety copy");

  const webServerConfigSummary = summaryFor(webServerConfigResult, "nginx.conf");
  assert(webServerConfigSummary.includes("Web server config preview"), "nginx.conf did not use web server config preview");
  assert(webServerConfigSummary.includes("server_name=runtime.example.test"), "nginx.conf summary omitted server_name evidence");
  assert(webServerConfigSummary.includes("listen=443 ssl"), "nginx.conf summary omitted listen evidence");
  assert(webServerConfigSummary.includes("location=/api/"), "nginx.conf summary omitted location evidence");
  assert(webServerConfigSummary.includes("upstream=runtime_backend") && webServerConfigSummary.includes("upstream server=127.0.0.1:8080"), "nginx.conf summary omitted upstream evidence");
  assert(webServerConfigSummary.includes("proxy_pass=https://runtime_backend?token=[redacted]"), "nginx.conf summary omitted proxy token redaction evidence");
  assert(webServerConfigSummary.includes("header=Authorization Bearer [redacted]"), "nginx.conf summary omitted header secret redaction evidence");
  assert(webServerConfigSummary.includes("auth=/auth"), "nginx.conf summary omitted auth_request evidence");
  assert(webServerConfigSummary.includes("rewrite=^/old/(.*)$ /new/$1?token=[redacted]"), "nginx.conf summary omitted rewrite redaction evidence");
  assert(!webServerConfigSummary.includes("secret-nginx-token") && !webServerConfigSummary.includes("secret-nginx-key"), "nginx.conf summary leaked secret-shaped values");
  assert(webServerConfigSummary.includes("include targets and certificate/key files were not opened"), "nginx.conf summary omitted include/certificate boundary copy");
  assert(webServerConfigSummary.includes("no nginx/apache/httpd command, service reload, config test"), "nginx.conf summary omitted no-runtime safety copy");

  const apacheVhostSummary = summaryFor(webServerConfigResult, "runtime.vhost.conf");
  assert(apacheVhostSummary.includes("Web server config preview (Apache/httpd config"), "runtime.vhost.conf did not use Apache/httpd web server preview");
  assert(apacheVhostSummary.includes("ServerName=apache-runtime.example.test"), "runtime.vhost.conf summary omitted Apache ServerName evidence");
  assert(apacheVhostSummary.includes("ServerAlias=api.apache-runtime.example.test"), "runtime.vhost.conf summary omitted Apache ServerAlias evidence");
  assert(apacheVhostSummary.includes("VirtualHost=*:"), "runtime.vhost.conf summary omitted VirtualHost listen evidence");
  assert(apacheVhostSummary.includes("ProxyPass=/api https://127.0.0.1:8443/api?token=[redacted]"), "runtime.vhost.conf summary omitted ProxyPass redaction evidence");
  assert(apacheVhostSummary.includes("header=Authorization \"Bearer [redacted]\""), "runtime.vhost.conf summary omitted Apache header redaction evidence");
  assert(apacheVhostSummary.includes("auth=Basic") && apacheVhostSummary.includes("auth=valid-user"), "runtime.vhost.conf summary omitted Apache auth evidence");
  assert(apacheVhostSummary.includes("rewrite=302 ^/old/(.*)$ /new/$1?token=[redacted]"), "runtime.vhost.conf summary omitted Apache redirect redaction evidence");
  assert(!apacheVhostSummary.includes("secret-apache-token") && !apacheVhostSummary.includes("secret-apache-key"), "runtime.vhost.conf summary leaked Apache secret-shaped values");
  assert(apacheVhostSummary.includes("no nginx/apache/httpd command, service reload, config test"), "runtime.vhost.conf summary omitted no-runtime safety copy");
  assert(webServerConfigResult.items.find((item) => item.title === "runtime.vhost.conf")?.mime === "text/x-web-server-config", "runtime.vhost.conf MIME provenance is missing");

  const htaccessSummary = summaryFor(webServerConfigResult, ".htaccess");
  assert(htaccessSummary.includes("Web server config preview (Apache .htaccess"), ".htaccess did not use Apache .htaccess preview");
  assert(htaccessSummary.includes("rewrite=^private/(.*)$ /login?token=[redacted]"), ".htaccess summary omitted RewriteRule redaction evidence");
  assert(htaccessSummary.includes("auth=Basic") && htaccessSummary.includes("auth=all granted"), ".htaccess summary omitted auth/access evidence");
  assert(htaccessSummary.includes("env=RUNTIME_TOKEN [redacted]"), ".htaccess summary omitted SetEnv redaction evidence");
  assert(htaccessSummary.includes("header=X-Runtime-Trace [redacted]"), ".htaccess summary omitted Header redaction evidence");
  assert(!htaccessSummary.includes("secret-htaccess-token"), ".htaccess summary leaked secret-shaped value");
  assert(htaccessSummary.includes("include targets and certificate/key files were not opened"), ".htaccess summary omitted include/certificate boundary copy");
  assert(webServerConfigResult.items.find((item) => item.title === ".htaccess")?.mime === "text/x-web-server-config", ".htaccess MIME provenance is missing");

  const sarifSummary = summaryFor(securityArtifactResult, "results.sarif");
  assert(sarifSummary.includes("SARIF static analysis result preview"), "results.sarif did not use SARIF preview");
  assert(sarifSummary.includes("Runtime Analyzer"), "results.sarif summary omitted tool evidence");
  assert(sarifSummary.includes("runtime-secret"), "results.sarif summary omitted rule evidence");
  assert(sarifSummary.includes("no scanner/test runner/code execution"), "results.sarif summary omitted no-scanner safety copy");

  const sarifJsonSummary = summaryFor(securityArtifactResult, "results.sarif.json");
  assert(sarifJsonSummary.includes("SARIF static analysis result preview"), "results.sarif.json did not use SARIF preview");
  assert(sarifJsonSummary.includes("CodeQL"), "results.sarif.json summary omitted tool evidence");
  assert(sarifJsonSummary.includes("js/path-injection"), "results.sarif.json summary omitted rule evidence");
  assert(sarifJsonSummary.includes("src/routes.ts:44"), "results.sarif.json summary omitted location evidence");
  assert(sarifJsonSummary.includes("SARIF extension provenance was preserved"), "results.sarif.json summary omitted extension provenance evidence");
  assert(sarifJsonSummary.includes("no scanner/test runner/code execution"), "results.sarif.json summary omitted no-scanner safety copy");

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

  const keepassSummary = summaryFor(securityArtifactResult, "runtime.kdbx");
  assert(keepassSummary.includes("KeePass KDBX database preview"), "runtime.kdbx did not use KeePass KDBX preview");
  assert(keepassSummary.includes("signature valid") && keepassSummary.includes("version 4.1"), "runtime.kdbx summary omitted KDBX signature/version evidence");
  assert(keepassSummary.includes("CipherID=16 B") && keepassSummary.includes("CompressionFlags=4 B"), "runtime.kdbx summary omitted header field evidence");
  assert(keepassSummary.includes("Compression flags: gzip"), "runtime.kdbx summary omitted compression evidence");
  assert(keepassSummary.includes("KDBX4 KDF parameters"), "runtime.kdbx summary omitted KDF evidence");
  assert(!keepassSummary.includes("encrypted-entry-secret-kdbx-token"), "runtime.kdbx summary leaked encrypted payload fixture secret");
  assert(keepassSummary.includes("encrypted entries were not decrypted or enumerated"), "runtime.kdbx summary omitted no-decryption safety copy");
  assert(securityArtifactResult.items.find((item) => item.title === "runtime.kdbx")?.mime === "application/x-keepass2", "runtime.kdbx MIME provenance is missing");

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

  const jfrSummary = summaryFor(jfrRuntimeResult, "runtime.jfr");
  assert(jfrSummary.includes("Java Flight Recorder snapshot preview"), "runtime.jfr did not use JFR preview");
  assert(jfrSummary.includes("Magic: FLR\\0 JFR chunk header detected"), "runtime.jfr summary omitted JFR magic evidence");
  assert(jfrSummary.includes("Version: 2.1"), "runtime.jfr summary omitted JFR version evidence");
  assert(jfrSummary.includes("First chunk declared size: 256 B"), "runtime.jfr summary omitted chunk-size evidence");
  assert(jfrSummary.includes("jdk.ExecutionSample") && jfrSummary.includes("jdk.ObjectAllocationInNewTLAB"), "runtime.jfr summary omitted readable event hints");
  assert(!jfrSummary.includes("secret-jfr-token"), "runtime.jfr summary leaked secret-shaped value");
  assert(jfrSummary.includes("no JVM/JDK Mission Control/jfr/jcmd command"), "runtime.jfr summary omitted no-JVM/no-JFR-command safety copy");
  assert(jfrRuntimeResult.items.find((item) => item.title === "runtime.jfr")?.mime === "application/jfr", "runtime.jfr MIME provenance is missing");

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

  const graphmlSummary = summaryFor(opsDesignResult, "runtime.graphml");
  assert(graphmlSummary.includes("Diagram source preview"), "runtime.graphml did not use diagram source preview");
  assert(graphmlSummary.includes("GraphML XML diagram source"), "runtime.graphml summary omitted GraphML format evidence");
  assert(graphmlSummary.includes("RuntimeGraph") && graphmlSummary.includes("edgedefault=directed"), "runtime.graphml summary omitted graph evidence");
  assert(graphmlSummary.includes("Runtime") && graphmlSummary.includes("Review"), "runtime.graphml summary omitted node evidence");
  assert(graphmlSummary.includes("runtime-edge Runtime->Review"), "runtime.graphml summary omitted edge evidence");
  assert(graphmlSummary.includes("runtimeLabel") && graphmlSummary.includes("edgeToken"), "runtime.graphml summary omitted key evidence");
  assert(graphmlSummary.includes("secret=[redacted]"), "runtime.graphml summary omitted redacted data evidence");
  assert(!graphmlSummary.includes("secret-graphml-token"), "runtime.graphml summary leaked sensitive data value");
  assert(graphmlSummary.includes("no diagram renderer"), "runtime.graphml summary omitted no-diagram-runtime safety copy");

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

  const rdpSummary = summaryFor(windowsNativeResult, "runtime.rdp");
  assert(rdpSummary.includes("Remote Desktop RDP configuration preview"), "runtime.rdp did not use RDP config preview");
  assert(rdpSummary.includes("rdp.runtime.example.test"), "runtime.rdp summary omitted RDP host evidence");
  assert(rdpSummary.includes("gateway.runtime.example.test?token=[redacted]"), "runtime.rdp summary omitted gateway URL redaction evidence");
  assert(rdpSummary.includes("username length 12"), "runtime.rdp summary omitted username minimization evidence");
  assert(rdpSummary.includes("redirectdrives=1") && rdpSummary.includes("local resource redirection requires review"), "runtime.rdp summary omitted redirection evidence");
  assert(rdpSummary.includes("password 51 value redacted"), "runtime.rdp summary omitted password blob redaction evidence");
  assert(!rdpSummary.includes("secret-rdp-password-blob") && !rdpSummary.includes("secret-rdp-gateway-token"), "runtime.rdp summary leaked RDP secrets");
  assert(rdpSummary.includes("no mstsc.exe launch, RDP connection, gateway probe"), "runtime.rdp summary omitted no-RDP-runtime safety copy");
  assert(windowsNativeResult.items.find((item) => item.title === "runtime.rdp")?.mime === "application/x-rdp", "runtime.rdp MIME provenance is missing");

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

  const prismaSummary = summaryFor(databaseSchemaDslResult, "schema.prisma");
  assert(prismaSummary.includes("Prisma schema preview"), "schema.prisma did not use database schema DSL preview");
  assert(prismaSummary.includes("datasource db provider=postgresql url env=DATABASE_URL"), "schema.prisma summary omitted datasource/env evidence");
  assert(prismaSummary.includes("RuntimeUser.org: RuntimeOrg @relation"), "schema.prisma summary omitted relation field evidence");
  assert(prismaSummary.includes("RuntimeRole=ADMIN/VIEWER"), "schema.prisma summary omitted enum evidence");
  assert(!prismaSummary.includes("secret-prisma-token"), "schema.prisma summary leaked sensitive default token");
  assert(prismaSummary.includes("no Prisma/dbml-cli/migration command"), "schema.prisma summary omitted no-Prisma-runtime safety copy");

  const dbmlSummary = summaryFor(databaseSchemaDslResult, "runtime.dbml");
  assert(dbmlSummary.includes("DBML schema preview"), "runtime.dbml did not use database schema DSL preview");
  assert(dbmlSummary.includes("runtime_users.org_id: int"), "runtime.dbml summary omitted DBML field evidence");
  assert(dbmlSummary.includes("runtime_users.org_id > runtime_orgs.id"), "runtime.dbml summary omitted DBML relationship evidence");
  assert(dbmlSummary.includes("runtime_role=admin/viewer"), "runtime.dbml summary omitted DBML enum evidence");
  assert(!dbmlSummary.includes("secret-dbml-token"), "runtime.dbml summary leaked sensitive note token");
  assert(dbmlSummary.includes("database connection, credential lookup"), "runtime.dbml summary omitted no-database/no-credential safety copy");

  const jsonSchemaSummary = summaryFor(jsonSchemaResult, "runtime.schema.json");
  assert(jsonSchemaSummary.includes("JSON Schema preview"), "runtime.schema.json did not use JSON Schema preview");
  assert(jsonSchemaSummary.includes("Runtime Import Payload"), "runtime.schema.json summary omitted schema title evidence");
  assert(jsonSchemaSummary.includes("Types: object"), "runtime.schema.json summary omitted type evidence");
  assert(jsonSchemaSummary.includes("Required fields: id, email"), "runtime.schema.json summary omitted required field evidence");
  assert(jsonSchemaSummary.includes("id type=string format=uuid") && jsonSchemaSummary.includes("email type=string format=email"), "runtime.schema.json summary omitted property/format evidence");
  assert(jsonSchemaSummary.includes("#/$defs/profile"), "runtime.schema.json summary omitted local ref evidence");
  assert(jsonSchemaSummary.includes("status default value hidden") && jsonSchemaSummary.includes("displayName examples value hidden"), "runtime.schema.json summary omitted default/example hiding evidence");
  assert(!jsonSchemaSummary.includes("secret-schema-id-token") && !jsonSchemaSummary.includes("secret-schema-default") && !jsonSchemaSummary.includes("secret-schema-example") && !jsonSchemaSummary.includes("secret-schema-pattern"), "runtime.schema.json summary leaked schema secret values");
  assert(jsonSchemaSummary.includes("$ref targets were not fetched or resolved"), "runtime.schema.json summary omitted no-ref-resolution safety copy");
  assert(jsonSchemaSummary.includes("no schema registry lookup, instance validation, code generation"), "runtime.schema.json summary omitted no-registry/no-codegen safety copy");
  assert(jsonSchemaResult.items[0].mime === "application/schema+json", "runtime.schema.json did not preserve JSON Schema MIME provenance");

  const redisRdbSummary = summaryFor(redisPersistenceResult, "dump.rdb");
  assert(redisRdbSummary.includes("Redis RDB snapshot metadata preview"), "dump.rdb did not use Redis RDB preview");
  assert(redisRdbSummary.includes("REDIS RDB version 0009"), "dump.rdb summary omitted RDB version evidence");
  assert(redisRdbSummary.includes("runtime:user:1"), "dump.rdb summary omitted bounded Redis string hint evidence");
  assert(!redisRdbSummary.includes("secret-rdb-token"), "dump.rdb summary leaked Redis RDB secret string");
  assert(redisRdbSummary.includes("no Redis server/client process"), "dump.rdb summary omitted no-Redis-runtime safety copy");

  const redisAofSummary = summaryFor(redisPersistenceResult, "appendonly.aof");
  assert(redisAofSummary.includes("Redis AOF command preview"), "appendonly.aof did not use Redis AOF preview");
  assert(redisAofSummary.includes("SET (1)") && redisAofSummary.includes("HSET (1)"), "appendonly.aof summary omitted command count evidence");
  assert(redisAofSummary.includes("SET runtime:user:1 [values not expanded]"), "appendonly.aof summary omitted key-only SET evidence");
  assert(redisAofSummary.includes("AUTH [arguments redacted]"), "appendonly.aof summary omitted AUTH redaction evidence");
  assert(!redisAofSummary.includes("secret-redis-aof-token"), "appendonly.aof summary leaked Redis AOF value");
  assert(!redisAofSummary.includes("secret-auth-credential"), "appendonly.aof summary leaked Redis AUTH argument");
  assert(redisAofSummary.includes("command replay, key scan"), "appendonly.aof summary omitted no-replay/no-key-scan safety copy");

  const systemdSummary = summaryFor(opsScheduleResult, "runtime.service");
  assert(systemdSummary.includes("systemd unit file preview"), "runtime.service did not use systemd unit preview");
  assert(systemdSummary.includes("Sections (3): Unit, Service, Install"), "runtime.service summary omitted systemd section evidence");
  assert(systemdSummary.includes("Description=Runtime scheduler service"), "runtime.service summary omitted Description evidence");
  assert(systemdSummary.includes("ExecStart=/usr/bin/node /srv/runtime/worker.js --api-key [redacted]"), "runtime.service summary omitted redacted ExecStart evidence");
  assert(!systemdSummary.includes("secret-systemd-token"), "runtime.service summary leaked systemd command secret");
  assert(!systemdSummary.includes("secret-systemd-url-token"), "runtime.service summary leaked systemd URL token");
  assert(systemdSummary.includes("no systemctl command"), "runtime.service summary omitted no-systemctl safety copy");

  const cronSummary = summaryFor(opsScheduleResult, "runtime.crontab");
  assert(cronSummary.includes("Cron schedule file preview"), "runtime.crontab did not use cron schedule preview");
  assert(cronSummary.includes("Environment keys (2): SHELL, MAILTO"), "runtime.crontab summary omitted environment key evidence");
  assert(cronSummary.includes("*/15 * * * * -> /usr/local/bin/runtime-sync --token [redacted]"), "runtime.crontab summary omitted redacted cron schedule evidence");
  assert(cronSummary.includes("@daily -> /usr/local/bin/runtime-cleanup --mode safe"), "runtime.crontab summary omitted special cron schedule evidence");
  assert(!cronSummary.includes("secret-cron-token"), "runtime.crontab summary leaked cron command secret");
  assert(cronSummary.includes("no crontab install, scheduler mutation, shell execution"), "runtime.crontab summary omitted no-crontab/no-shell safety copy");

  const supervisorSummary = summaryFor(opsScheduleResult, "runtime.supervisord.conf");
  assert(supervisorSummary.includes("Supervisor config preview"), "runtime.supervisord.conf did not use Supervisor config preview");
  assert(supervisorSummary.includes("Sections (4): supervisord, program:runtime-worker, group:runtime, include"), "runtime.supervisord.conf summary omitted section evidence");
  assert(supervisorSummary.includes("Program/group hints (2): program:runtime-worker, group:runtime"), "runtime.supervisord.conf summary omitted program/group evidence");
  assert(supervisorSummary.includes("command=/usr/local/bin/runtime-worker --token [redacted] --url https://ops.example.test/run?token=[redacted]"), "runtime.supervisord.conf summary omitted redacted command evidence");
  assert(supervisorSummary.includes("Environment keys (2): RUNTIME_TOKEN, RUNTIME_MODE"), "runtime.supervisord.conf summary omitted environment key evidence");
  assert(supervisorSummary.includes("include.files=/etc/supervisor/conf.d/*.conf"), "runtime.supervisord.conf summary omitted include hint evidence");
  assert(!supervisorSummary.includes("secret-supervisor-token"), "runtime.supervisord.conf summary leaked command secret");
  assert(!supervisorSummary.includes("secret-supervisor-url-token"), "runtime.supervisord.conf summary leaked URL token");
  assert(!supervisorSummary.includes("secret-supervisor-env-token"), "runtime.supervisord.conf summary leaked environment secret");
  assert(supervisorSummary.includes("no supervisord or supervisorctl command"), "runtime.supervisord.conf summary omitted no-supervisor-runtime safety copy");
  const hostsSummary = summaryFor(opsScheduleResult, "runtime.hosts");
  assert(hostsSummary.includes("Hosts file preview"), "runtime.hosts did not use hosts file preview");
  assert(hostsSummary.includes("127.0.0.1 -> localhost") && hostsSummary.includes("127.0.0.1 -> runtime.local"), "runtime.hosts summary omitted loopback mapping evidence");
  assert(hostsSummary.includes("0.0.0.0 -> ads.runtime.example.test"), "runtime.hosts summary omitted null-route mapping evidence");
  assert(hostsSummary.includes("null-route/ad-block style mapping") && hostsSummary.includes("sensitive-looking hostname label was redacted"), "runtime.hosts summary omitted static risk cues");
  assert(hostsSummary.includes("[redacted]") && !hostsSummary.includes("runtime-token-secret.example.test"), "runtime.hosts summary omitted sensitive hostname redaction");
  assert(!hostsSummary.includes("secret-hosts-comment-token"), "runtime.hosts summary leaked comment token");
  assert(hostsSummary.includes("system hosts file was not opened or modified") && hostsSummary.includes("no DNS cache flush"), "runtime.hosts summary omitted no-system/no-DNS safety copy");
  assert(opsScheduleResult.items.find((item) => item.title === "runtime.hosts")?.mime === "text/x-hosts", "runtime.hosts MIME provenance is missing");

  const wireguardSummary = summaryFor(vpnConfigResult, "wg0.conf");
  assert(wireguardSummary.includes("VPN client configuration preview (WireGuard client profile"), "wg0.conf did not use WireGuard VPN config preview");
  assert(wireguardSummary.includes("Sections/directives (2): Interface, Peer"), "wg0.conf summary omitted WireGuard section evidence");
  assert(wireguardSummary.includes("Address=10.44.0.2/32") && wireguardSummary.includes("PersistentKeepalive=25"), "wg0.conf summary omitted interface or peer evidence");
  assert(wireguardSummary.includes("Endpoint=vpn.example.test:51820"), "wg0.conf summary omitted endpoint evidence");
  assert(wireguardSummary.includes("AllowedIPs=0.0.0.0/0, ::/0") && wireguardSummary.includes("DNS=1.1.1.1"), "wg0.conf summary omitted route/DNS evidence");
  assert(wireguardSummary.includes("PrivateKey=[redacted]") && wireguardSummary.includes("PresharedKey=[redacted]"), "wg0.conf summary omitted key redaction evidence");
  assert(wireguardSummary.includes("hook command declared") && wireguardSummary.includes("full-tunnel route declared"), "wg0.conf summary omitted static risk cues");
  assert(!wireguardSummary.includes("secret-wireguard-private-key-material") && !wireguardSummary.includes("secret-wireguard-psk-material") && !wireguardSummary.includes("secret-wg-hook"), "wg0.conf summary leaked WireGuard secrets");
  assert(wireguardSummary.includes("no WireGuard/OpenVPN client, tunnel activation, route/DNS mutation"), "wg0.conf summary omitted no-VPN-runtime safety copy");
  assert(vpnConfigResult.items.find((item) => item.title === "wg0.conf")?.mime === "application/vnd.drsai.vpn-config", "wg0.conf MIME provenance is missing");

  const openVpnSummary = summaryFor(vpnConfigResult, "client.ovpn");
  assert(openVpnSummary.includes("VPN client configuration preview (OpenVPN client profile"), "client.ovpn did not use OpenVPN profile preview");
  assert(openVpnSummary.includes("remote=vpn-runtime.example.test 1194") && openVpnSummary.includes("dev=tun") && openVpnSummary.includes("proto=udp"), "client.ovpn summary omitted remote/interface evidence");
  assert(openVpnSummary.includes("redirect-gateway=def1"), "client.ovpn summary omitted redirect-gateway route evidence");
  assert(openVpnSummary.includes("auth-user-pass=[redacted]") && openVpnSummary.includes("tls-auth=[redacted]") && openVpnSummary.includes("key=[redacted]"), "client.ovpn summary omitted credential redaction evidence");
  assert(openVpnSummary.includes("OpenVPN script hook requires review") && openVpnSummary.includes("credential material redacted"), "client.ovpn summary omitted OpenVPN risk cues");
  assert(!openVpnSummary.includes("secret-openvpn-auth") && !openVpnSummary.includes("secret-openvpn-client") && !openVpnSummary.includes("secret-openvpn-ta") && !openVpnSummary.includes("secret-openvpn-url-token"), "client.ovpn summary leaked OpenVPN secrets");
  assert(openVpnSummary.includes("no WireGuard/OpenVPN client, tunnel activation, route/DNS mutation"), "client.ovpn summary omitted no-VPN-runtime safety copy");
  assert(vpnConfigResult.items.find((item) => item.title === "client.ovpn")?.mime === "application/vnd.drsai.vpn-config", "client.ovpn MIME provenance is missing");

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

  const terminalRecordingSummary = summaryFor(terminalRecordingResult, "runtime.cast");
  assert(terminalRecordingSummary.includes("Terminal recording preview (Asciinema cast"), "runtime.cast did not use terminal recording preview");
  assert(terminalRecordingSummary.includes("version=2") && terminalRecordingSummary.includes("terminal=100x30"), "runtime.cast summary omitted header evidence");
  assert(terminalRecordingSummary.includes("output=3") && terminalRecordingSummary.includes("input=1") && terminalRecordingSummary.includes("resize=1"), "runtime.cast summary omitted event count evidence");
  assert(terminalRecordingSummary.includes("npm run verify") && terminalRecordingSummary.includes("git status"), "runtime.cast summary omitted command/prompt evidence");
  assert(terminalRecordingSummary.includes("warning") && terminalRecordingSummary.includes("fatal") && terminalRecordingSummary.includes("access denied"), "runtime.cast summary omitted risk cues");
  assert(terminalRecordingSummary.includes("token=[redacted]"), "runtime.cast summary omitted token redaction evidence");
  assert(!terminalRecordingSummary.includes("secret-cast-token") && !terminalRecordingSummary.includes("secret-cast-output"), "runtime.cast summary leaked terminal recording secret");
  assert(terminalRecordingSummary.includes("no terminal replay, shell command execution, process spawn"), "runtime.cast summary omitted no-replay/no-execution safety copy");

  const powershellTranscriptSummary = summaryFor(terminalRecordingResult, "runtime.powershell-transcript.txt");
  assert(powershellTranscriptSummary.includes("PowerShell transcript preview"), "PowerShell transcript fixture did not use transcript preview");
  assert(powershellTranscriptSummary.includes("start=1") && powershellTranscriptSummary.includes("end=1"), "PowerShell transcript summary omitted transcript marker evidence");
  assert(powershellTranscriptSummary.includes("Host Application=powershell.exe -NoProfile -ExecutionPolicy Bypass"), "PowerShell transcript summary omitted host application evidence");
  assert(powershellTranscriptSummary.includes("npm run verify:channel-adapters") && powershellTranscriptSummary.includes("git status --short"), "PowerShell transcript summary omitted command evidence");
  assert(powershellTranscriptSummary.includes("warning") && powershellTranscriptSummary.includes("fatal") && powershellTranscriptSummary.includes("access denied"), "PowerShell transcript summary omitted risk cues");
  assert(powershellTranscriptSummary.includes("token=[redacted]"), "PowerShell transcript summary omitted token redaction evidence");
  assert(!powershellTranscriptSummary.includes("secret-transcript-token") && !powershellTranscriptSummary.includes("secret-transcript-output") && !powershellTranscriptSummary.includes("secret-transcript-url"), "PowerShell transcript summary leaked sensitive transcript value");
  assert(powershellTranscriptSummary.includes("no PowerShell/pwsh process, transcript replay, shell command execution"), "PowerShell transcript summary omitted no-runtime/no-replay safety copy");

  const logMonitorSummary = summaryFor(logMonitorResult, "Runtime retention log");
  assert(logMonitorSummary.includes("Log monitor delta"), "log monitor runtime fixture did not use log monitor delta preview");
  assert(logMonitorSummary.includes("Retention policy reviewed: days=14, maxBytes=1048576, maxFiles=8, action=review-only"), "log monitor summary omitted retention policy evidence");
  assert(logMonitorSummary.includes("no log deletion, rotation, truncation, or retention enforcement was performed"), "log monitor summary omitted no-retention-mutation safety copy");
  assert(logMonitorSummary.includes("token=[redacted]"), "log monitor summary omitted secret redaction evidence");
  assert(!logMonitorSummary.includes("secret-log-monitor-token"), "log monitor summary leaked sensitive token value");

  const harSummary = summaryFor(dataNetworkResult, "runtime.har");
  assert(harSummary.includes("HAR network trace preview"), "runtime.har did not use HAR preview");
  assert(harSummary.includes("api.example.test"), "runtime.har summary omitted host evidence");
  assert(!harSummary.includes("secret-har-token"), "runtime.har summary leaked sensitive HAR token value");
  assert(harSummary.includes("no browser profile access, request replay, network call"), "runtime.har summary omitted no-replay safety copy");

  const netlogSummary = summaryFor(netlogResult, "netlog.json");
  assert(netlogSummary.includes("Chrome NetLog network trace preview"), "netlog.json did not use NetLog preview");
  assert(netlogSummary.includes("URL_REQUEST_START_JOB") && netlogSummary.includes("HTTP_TRANSACTION_SEND_REQUEST_HEADERS"), "netlog.json summary omitted event type evidence");
  assert(netlogSummary.includes("URL_REQUEST #7") && netlogSummary.includes("SOCKET #8"), "netlog.json summary omitted source evidence");
  assert(netlogSummary.includes("api.example.test"), "netlog.json summary omitted host evidence");
  assert(!netlogSummary.includes("secret-netlog-token"), "netlog.json summary leaked sensitive NetLog token value");
  assert(netlogSummary.includes("no browser profile access, request replay, network call"), "netlog.json summary omitted no-replay safety copy");

  const otelSummary = summaryFor(otelResult, "runtime.otlp.json");
  assert(otelSummary.includes("OpenTelemetry/OTLP JSON preview"), "runtime.otlp.json did not use OpenTelemetry preview");
  assert(otelSummary.includes("spans=1") && otelSummary.includes("logs=1") && otelSummary.includes("metrics=1"), "runtime.otlp.json summary omitted signal counts");
  assert(otelSummary.includes("service.name=checkout-api"), "runtime.otlp.json summary omitted service resource evidence");
  assert(otelSummary.includes("POST /checkout") && otelSummary.includes("STATUS_CODE_ERROR"), "runtime.otlp.json summary omitted span evidence");
  assert(otelSummary.includes("ERROR") && otelSummary.includes("payment provider failed token=[redacted]"), "runtime.otlp.json summary omitted redacted log evidence");
  assert(otelSummary.includes("checkout.latency") && otelSummary.includes("type=histogram"), "runtime.otlp.json summary omitted metric evidence");
  assert(otelSummary.includes("http.route") && otelSummary.includes("authorization"), "runtime.otlp.json summary omitted attribute-key evidence");
  assert(!otelSummary.includes("secret-otel-token"), "runtime.otlp.json summary leaked sensitive OTLP token value");
  assert(otelSummary.includes("no collector connection, span/log/metric export, trace replay"), "runtime.otlp.json summary omitted no-collector/no-export safety copy");

  const devtoolsTraceSummary = summaryFor(dataNetworkResult, "runtime.trace.json");
  assert(devtoolsTraceSummary.includes("DevTools performance trace preview"), "runtime.trace.json did not use DevTools trace preview");
  assert(devtoolsTraceSummary.includes("Renderer"), "runtime.trace.json summary omitted process evidence");
  assert(devtoolsTraceSummary.includes("CrRendererMain"), "runtime.trace.json summary omitted thread evidence");
  assert(devtoolsTraceSummary.includes("RunTask") && devtoolsTraceSummary.includes("125ms"), "runtime.trace.json summary omitted long task evidence");
  assert(devtoolsTraceSummary.includes("devtools.timeline"), "runtime.trace.json summary omitted category evidence");
  assert(devtoolsTraceSummary.includes("data") && devtoolsTraceSummary.includes("frame"), "runtime.trace.json summary omitted argument-key evidence");
  assert(!devtoolsTraceSummary.includes("secret-trace-token"), "runtime.trace.json summary leaked trace argument token");
  assert(devtoolsTraceSummary.includes("no Chrome/Edge/DevTools/Lighthouse launch, trace replay"), "runtime.trace.json summary omitted no-browser/no-replay safety copy");

  const cpuProfileSummary = summaryFor(devtoolsProfileResult, "runtime.cpuprofile");
  assert(cpuProfileSummary.includes("DevTools/V8 CPU profile preview"), "runtime.cpuprofile did not use DevTools/V8 CPU profile preview");
  assert(cpuProfileSummary.includes("nodes=3") && cpuProfileSummary.includes("samples=3") && cpuProfileSummary.includes("sampledTime=6ms"), "runtime.cpuprofile summary omitted profile count evidence");
  assert(cpuProfileSummary.includes("RuntimeMain") && cpuProfileSummary.includes("renderWidget"), "runtime.cpuprofile summary omitted function hint evidence");
  assert(!cpuProfileSummary.includes("secret-profile-token"), "runtime.cpuprofile summary leaked profile URL token");
  assert(cpuProfileSummary.includes("no Chrome/Edge/DevTools launch, profile replay"), "runtime.cpuprofile summary omitted no-profile-runtime safety copy");

  const heapSnapshotSummary = summaryFor(devtoolsProfileResult, "runtime.heapsnapshot");
  assert(heapSnapshotSummary.includes("DevTools/V8 Heap snapshot preview"), "runtime.heapsnapshot did not use DevTools/V8 heap snapshot preview");
  assert(heapSnapshotSummary.includes("nodes=3") && heapSnapshotSummary.includes("edges=2") && heapSnapshotSummary.includes("traceFunctions=1"), "runtime.heapsnapshot summary omitted heap count evidence");
  assert(heapSnapshotSummary.includes("RuntimeHeapRoot") && heapSnapshotSummary.includes("RuntimeLeakCandidate"), "runtime.heapsnapshot summary omitted heap string hint evidence");
  assert(!heapSnapshotSummary.includes("secret-heap-token"), "runtime.heapsnapshot summary leaked heap string token");
  assert(heapSnapshotSummary.includes("heap objects were not expanded"), "runtime.heapsnapshot summary omitted no-heap-expansion safety copy");

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

  const avroSummary = summaryFor(dataNetworkResult, "runtime.avro");
  assert(avroSummary.includes("Avro object container preview"), "runtime.avro did not use Avro object container preview");
  assert(avroSummary.includes("Avro magic: Obj1 detected"), "runtime.avro summary omitted Avro magic evidence");
  assert(avroSummary.includes("RuntimeEvent") && avroSummary.includes("runtime_id") && avroSummary.includes("metric_value"), "runtime.avro summary omitted schema metadata evidence");
  assert(avroSummary.includes("runtime_avro_schema") && avroSummary.includes("[redacted]"), "runtime.avro summary omitted metadata redaction evidence");
  assert(!avroSummary.includes("secret-avro-token"), "runtime.avro summary leaked secret-like metadata value");
  assert(avroSummary.includes("no Avro runtime") && avroSummary.includes("schema registry lookup"), "runtime.avro summary omitted no-runtime/no-registry safety copy");

  const avroSchemaSummary = summaryFor(dataNetworkResult, "runtime.avsc");
  assert(avroSchemaSummary.includes("Avro schema file preview"), "runtime.avsc did not use Avro schema preview");
  assert(avroSchemaSummary.includes("RuntimeSchemaEvent") && avroSchemaSummary.includes("runtime_id:string") && avroSchemaSummary.includes("metric_value:union(2)"), "runtime.avsc summary omitted schema field evidence");
  assert(avroSchemaSummary.includes("timestamp-millis"), "runtime.avsc summary omitted logical type evidence");
  assert(avroSchemaSummary.includes("Default values hidden: 2"), "runtime.avsc summary omitted default hiding evidence");
  assert(!avroSchemaSummary.includes("secret-avsc-default") && !avroSchemaSummary.includes("secret-avsc-doc"), "runtime.avsc summary leaked secret-like schema values");
  assert(avroSchemaSummary.includes("no Avro runtime") && avroSchemaSummary.includes("compatibility check") && avroSchemaSummary.includes("code generation"), "runtime.avsc summary omitted no-runtime/no-codegen safety copy");
  assert(dataNetworkResult.items.find((item) => item.title === "runtime.avsc")?.mime === "application/vnd.apache.avro.schema+json", "runtime.avsc MIME provenance is missing");

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

  const bookmarksJsonSummary = summaryFor(contentMediaResult, "bookmarks.json");
  assert(bookmarksJsonSummary.includes("Browser bookmark JSON preview"), "bookmarks.json did not use browser bookmark JSON preview");
  assert(bookmarksJsonSummary.includes("Runtime JSON Bar") && bookmarksJsonSummary.includes("Runtime JSON Other"), "bookmarks.json summary omitted folder evidence");
  assert(bookmarksJsonSummary.includes("Runtime JSON Docs") && bookmarksJsonSummary.includes("Runtime JSON API"), "bookmarks.json summary omitted bookmark link evidence");
  assert(bookmarksJsonSummary.includes("token=%5BREDACTED%5D") && bookmarksJsonSummary.includes("api_key=%5BREDACTED%5D"), "bookmarks.json summary omitted URL query redaction evidence");
  assert(!bookmarksJsonSummary.includes("secret-json-bookmark-token") && !bookmarksJsonSummary.includes("secret-json-bookmark-key"), "bookmarks.json summary leaked bookmark URL token");
  assert(bookmarksJsonSummary.includes("bookmark stores were not imported"), "bookmarks.json summary omitted no-store-import safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "bookmarks.json")?.mime === "application/vnd.drsai.browser-bookmarks+json", "bookmarks.json MIME provenance is missing");

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

  const desktopEntrySummary = summaryFor(contentMediaResult, "runtime.desktop");
  assert(desktopEntrySummary.includes("Desktop entry launcher preview"), "runtime.desktop did not use desktop entry preview");
  assert(desktopEntrySummary.includes("Runtime Desktop Launcher") && desktopEntrySummary.includes("Runtime Tool"), "runtime.desktop summary omitted launcher name evidence");
  assert(desktopEntrySummary.includes("shell invocation") && desktopEntrySummary.includes("network download/request"), "runtime.desktop summary omitted static risk cues");
  assert(desktopEntrySummary.includes("Exec commands") && desktopEntrySummary.includes("[redacted]"), "runtime.desktop summary omitted command redaction evidence");
  assert(!desktopEntrySummary.includes("secret-desktop-token") && !desktopEntrySummary.includes("secret-desktop-key"), "runtime.desktop summary leaked launcher secrets");
  assert(desktopEntrySummary.includes("Exec/URL targets were not launched, desktop actions were not invoked"), "runtime.desktop summary omitted no-launch safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "runtime.desktop")?.mime === "application/x-desktop", "runtime.desktop MIME provenance is missing");

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

  const jsonFeedSummary = summaryFor(contentMediaResult, "feed.json");
  assert(jsonFeedSummary.includes("Feed document preview (JSON Feed"), "feed.json did not use JSON Feed preview");
  assert(jsonFeedSummary.includes("Runtime JSON Feed"), "feed.json summary omitted JSON Feed title evidence");
  assert(jsonFeedSummary.includes("Runtime JSON Author"), "feed.json summary omitted JSON Feed author evidence");
  assert(jsonFeedSummary.includes("Runtime JSON Feed Item"), "feed.json summary omitted JSON Feed item evidence");
  assert(jsonFeedSummary.includes("token=REDACTED"), "feed.json summary omitted JSON Feed URL redaction evidence");
  assert(!jsonFeedSummary.includes("secret-jsonfeed-token") && !jsonFeedSummary.includes("secret-jsonfeed-body-token"), "feed.json summary leaked JSON Feed secret content");
  assert(jsonFeedSummary.includes("feed item bodies were not expanded"), "feed.json summary omitted no-body-expansion safety copy");
  assert(jsonFeedSummary.includes("remote JSON feed URLs were not fetched"), "feed.json summary omitted no-feed-fetch safety copy");

  const opmlSummary = summaryFor(opmlSubscriptionResult, "subscriptions.opml");
  assert(opmlSummary.includes("OPML subscription export preview"), "subscriptions.opml did not use OPML subscription preview");
  assert(opmlSummary.includes("Runtime Feed Subscriptions"), "subscriptions.opml summary omitted OPML title evidence");
  assert(opmlSummary.includes("Runtime OPML Feed"), "subscriptions.opml summary omitted outline evidence");
  assert(opmlSummary.includes("token=REDACTED"), "subscriptions.opml summary omitted feed URL redaction evidence");
  assert(!opmlSummary.includes("secret-opml-token"), "subscriptions.opml summary leaked secret OPML token");
  assert(opmlSummary.includes("feed URLs were not fetched"), "subscriptions.opml summary omitted no-feed-fetch safety copy");

  const robotsSummary = summaryFor(contentMediaResult, "robots.txt");
  assert(robotsSummary.includes("Web crawl metadata preview (robots.txt"), "robots.txt did not use web crawl metadata preview");
  assert(robotsSummary.includes("User agents: *"), "robots.txt summary omitted user-agent evidence");
  assert(robotsSummary.includes("Disallow rules") && robotsSummary.includes("/private"), "robots.txt summary omitted disallow evidence");
  assert(robotsSummary.includes("https://example.test/sitemap.xml?token=REDACTED"), "robots.txt summary omitted redacted sitemap URL evidence");
  assert(!robotsSummary.includes("secret-robots-token"), "robots.txt summary leaked sitemap token");
  assert(robotsSummary.includes("remote URLs were not fetched, pages were not crawled, JavaScript was not executed"), "robots.txt summary omitted no-fetch/no-crawl safety copy");

  const securityTxtSummary = summaryFor(contentMediaResult, "security.txt");
  assert(securityTxtSummary.includes("security.txt vulnerability disclosure policy preview"), "security.txt did not use specialized policy preview");
  assert(securityTxtSummary.includes("security@example.test") && securityTxtSummary.includes("https://security.example.test/report?token=[redacted]"), "security.txt summary omitted contact evidence");
  assert(securityTxtSummary.includes("Expires values: 2026-12-31T23:59:59Z"), "security.txt summary omitted Expires evidence");
  assert(securityTxtSummary.includes("Encryption references: https://security.example.test/pgp-key.txt"), "security.txt summary omitted Encryption evidence");
  assert(securityTxtSummary.includes("Preferred languages: en, zh"), "security.txt summary omitted Preferred-Languages evidence");
  assert(securityTxtSummary.includes("Canonical URLs: https://example.test/.well-known/security.txt"), "security.txt summary omitted Canonical evidence");
  assert(securityTxtSummary.includes("Policy URLs: https://example.test/security-policy"), "security.txt summary omitted Policy evidence");
  assert(securityTxtSummary.includes("Invalid/unrecognized lines") && securityTxtSummary.includes("Unrecognized: should-stay-bounded"), "security.txt summary omitted invalid-line evidence");
  assert(!securityTxtSummary.includes("secret-security-token"), "security.txt summary leaked token-like contact URL value");
  assert(securityTxtSummary.includes("contact/policy URLs were not fetched") && securityTxtSummary.includes("PGP signatures were not verified"), "security.txt summary omitted no-fetch/no-signature safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "security.txt")?.mime === "text/vnd.security", "security.txt MIME provenance is missing");

  const assetLinksSummary = summaryFor(contentMediaResult, "assetlinks.json");
  assert(assetLinksSummary.includes("Web app association preview (Android Digital Asset Links"), "assetlinks.json did not use web app association preview");
  assert(assetLinksSummary.includes("android_app package=ai.drsai.runtime"), "assetlinks.json summary omitted package identity evidence");
  assert(assetLinksSummary.includes("delegate_permission/common.handle_all_urls"), "assetlinks.json summary omitted relation evidence");
  assert(assetLinksSummary.includes("SHA-256 certificate fingerprints hidden (1)"), "assetlinks.json summary omitted fingerprint hiding evidence");
  assert(!assetLinksSummary.includes("AA:BB:CC"), "assetlinks.json summary leaked certificate fingerprint");
  assert(assetLinksSummary.includes("association URLs were not fetched") && assetLinksSummary.includes("apps were not installed or launched"), "assetlinks.json summary omitted no-fetch/no-app-runtime safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "assetlinks.json")?.mime === "application/vnd.drsai.web-app-association+json", "assetlinks.json MIME provenance is missing");

  const appleAssociationSummary = summaryFor(contentMediaResult, "apple-app-site-association");
  assert(appleAssociationSummary.includes("Web app association preview (Apple App Site Association"), "apple-app-site-association did not use web app association preview");
  assert(appleAssociationSummary.includes("applinks ABCDE12345.ai.drsai.runtime"), "apple-app-site-association summary omitted applinks identity evidence");
  assert(appleAssociationSummary.includes("webcredentials") && appleAssociationSummary.includes("activitycontinuation"), "apple-app-site-association summary omitted Apple service relation evidence");
  assert(appleAssociationSummary.includes("/chat/*") && appleAssociationSummary.includes("Excluded admin path exclude=true"), "apple-app-site-association summary omitted path/component evidence");
  assert(appleAssociationSummary.includes("/handoff/runtime?token=REDACTED"), "apple-app-site-association summary omitted redacted path token evidence");
  assert(!appleAssociationSummary.includes("secret-aasa-token"), "apple-app-site-association summary leaked path token");
  assert(appleAssociationSummary.includes("domain verification ran") && appleAssociationSummary.includes("no network call or provider send"), "apple-app-site-association summary omitted no-domain/no-provider safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "apple-app-site-association")?.mime === "application/vnd.drsai.web-app-association+json", "apple-app-site-association MIME provenance is missing");

  const llmsSummary = summaryFor(contentMediaResult, "llms.txt");
  assert(llmsSummary.includes("LLM website metadata preview (llms.txt"), "llms.txt did not use LLM metadata preview");
  assert(llmsSummary.includes("Runtime LLM Site Guide"), "llms.txt summary omitted title evidence");
  assert(llmsSummary.includes("Docs") && llmsSummary.includes("Optional") && llmsSummary.includes("Full context"), "llms.txt summary omitted section evidence");
  assert(llmsSummary.includes("Runtime API -> https://llms.example.test/api?token=[redacted]"), "llms.txt summary omitted redacted link evidence");
  assert(!llmsSummary.includes("secret-llms-token"), "llms.txt summary leaked resource URL token");
  assert(llmsSummary.includes("Optional context cues") && llmsSummary.includes("Full-context cues"), "llms.txt summary omitted optional/full-context cues");
  assert(llmsSummary.includes("linked resources were not fetched, websites were not crawled, JavaScript was not executed"), "llms.txt summary omitted no-fetch/no-crawl safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "llms.txt")?.mime === "text/markdown+llms", "llms.txt MIME provenance is missing");

  const browserCookiesSummary = summaryFor(browserCookiesResult, "cookies.txt");
  assert(browserCookiesSummary.includes("Browser cookie export preview"), "cookies.txt did not use browser cookie export preview");
  assert(browserCookiesSummary.includes(".example.test") && browserCookiesSummary.includes("api.example.test"), "cookies.txt summary omitted domain evidence");
  assert(browserCookiesSummary.includes("sessionid") && browserCookiesSummary.includes("auth_token"), "cookies.txt summary omitted cookie name evidence");
  assert(browserCookiesSummary.includes("secure=2") && browserCookiesSummary.includes("httpOnly=1"), "cookies.txt summary omitted cookie flag evidence");
  assert(browserCookiesSummary.includes("session=1") && browserCookiesSummary.includes("expired=1"), "cookies.txt summary omitted cookie expiry evidence");
  assert(browserCookiesSummary.includes("cookie values were always redacted"), "cookies.txt summary omitted cookie value redaction evidence");
  assert(!browserCookiesSummary.includes("secret-cookie-session") && !browserCookiesSummary.includes("secret-cookie-token") && !browserCookiesSummary.includes("secret-cookie-legacy"), "cookies.txt summary leaked cookie values");
  assert(browserCookiesSummary.includes("browser profiles were not opened, cookies were not imported"), "cookies.txt summary omitted no-profile/no-import safety copy");
  assert(browserCookiesResult.items.find((item) => item.title === "cookies.txt")?.mime === "text/x-netscape-cookies", "cookies.txt MIME provenance is missing");
  const hyphenatedBrowserCookiesSummary = summaryFor(browserCookiesResult, "runtime-cookies.txt");
  assert(hyphenatedBrowserCookiesSummary.includes("Browser cookie export preview"), "runtime-cookies.txt did not use browser cookie export preview");
  assert(hyphenatedBrowserCookiesSummary.includes(".hyphen.example.test") && hyphenatedBrowserCookiesSummary.includes("api.hyphen.example.test"), "runtime-cookies.txt summary omitted hyphenated cookie domain evidence");
  assert(hyphenatedBrowserCookiesSummary.includes("hyphen_session") && hyphenatedBrowserCookiesSummary.includes("hyphen_auth"), "runtime-cookies.txt summary omitted hyphenated cookie name evidence");
  assert(hyphenatedBrowserCookiesSummary.includes("secure=2") && hyphenatedBrowserCookiesSummary.includes("httpOnly=1"), "runtime-cookies.txt summary omitted hyphenated cookie flag evidence");
  assert(hyphenatedBrowserCookiesSummary.includes("cookie values were always redacted"), "runtime-cookies.txt summary omitted cookie value redaction evidence");
  assert(!hyphenatedBrowserCookiesSummary.includes("secret-hyphen-cookie-session") && !hyphenatedBrowserCookiesSummary.includes("secret-hyphen-cookie-auth"), "runtime-cookies.txt summary leaked hyphenated cookie values");
  assert(browserCookiesResult.items.find((item) => item.title === "runtime-cookies.txt")?.mime === "text/x-netscape-cookies", "runtime-cookies.txt MIME provenance is missing");
  const browserPasswordsSummary = summaryFor(browserPasswordsResult, "chrome-passwords.csv");
  assert(browserPasswordsSummary.includes("Browser password CSV export preview"), "chrome-passwords.csv did not use browser password CSV preview");
  assert(browserPasswordsSummary.includes("login.passwords.example.test") && browserPasswordsSummary.includes("admin.passwords.example.test"), "chrome-passwords.csv summary omitted origin evidence");
  assert(browserPasswordsSummary.includes("email user [redacted]@example.test") && browserPasswordsSummary.includes("username length 10"), "chrome-passwords.csv summary omitted username minimization evidence");
  assert(browserPasswordsSummary.includes("password length 21"), "chrome-passwords.csv summary omitted password length evidence");
  assert(browserPasswordsSummary.includes("password=<redacted>") && browserPasswordsSummary.includes("password values were never printed"), "chrome-passwords.csv summary omitted password redaction evidence");
  assert(browserPasswordsSummary.includes("browser profiles and Login Data stores were not opened"), "chrome-passwords.csv summary omitted no-profile/no-login-store safety copy");
  assert(!browserPasswordsSummary.includes("secret-password-value") && !browserPasswordsSummary.includes("secret-admin-password") && !browserPasswordsSummary.includes("secret-password-url-token") && !browserPasswordsSummary.includes("secret-password-note-token"), "chrome-passwords.csv summary leaked password export secrets");
  assert(browserPasswordsResult.items.find((item) => item.title === "chrome-passwords.csv")?.mime === "text/csv+browser-passwords", "chrome-passwords.csv MIME provenance is missing");
  const browserAutofillCsvSummary = summaryFor(browserAutofillResult, "autofill.csv");
  assert(browserAutofillCsvSummary.includes("Browser autofill export preview"), "autofill.csv did not use browser autofill preview");
  assert(browserAutofillCsvSummary.includes("checkout.autofill.example.test"), "autofill.csv summary omitted origin evidence");
  assert(browserAutofillCsvSummary.includes("email") && browserAutofillCsvSummary.includes("cc-number"), "autofill.csv summary omitted field name evidence");
  assert(browserAutofillCsvSummary.includes("payment") && browserAutofillCsvSummary.includes("sensitive-looking fields detected: 2"), "autofill.csv summary omitted field type or sensitivity evidence");
  assert(browserAutofillCsvSummary.includes("value=<redacted>") && browserAutofillCsvSummary.includes("string value"), "autofill.csv summary omitted value redaction/kind evidence");
  assert(!browserAutofillCsvSummary.includes("secret-autofill-email") && !browserAutofillCsvSummary.includes("4111111111111111"), "autofill.csv summary leaked field values");
  assert(browserAutofillCsvSummary.includes("browser profiles and autofill stores were not opened"), "autofill.csv summary omitted no-profile/no-store safety copy");
  assert(browserAutofillResult.items.find((item) => item.title === "autofill.csv")?.mime === "text/csv+browser-autofill", "autofill.csv MIME provenance is missing");
  const browserAutofillJsonSummary = summaryFor(browserAutofillResult, "runtime-autofill.json");
  assert(browserAutofillJsonSummary.includes("Browser autofill export preview"), "runtime-autofill.json did not use browser autofill preview");
  assert(browserAutofillJsonSummary.includes("profile.autofill.example.test") && browserAutofillJsonSummary.includes("profile"), "runtime-autofill.json summary omitted origin/form evidence");
  assert(browserAutofillJsonSummary.includes("given-name") && browserAutofillJsonSummary.includes("phone"), "runtime-autofill.json summary omitted field names");
  assert(browserAutofillJsonSummary.includes("tel") && browserAutofillJsonSummary.includes("length=21"), "runtime-autofill.json summary omitted type/length evidence");
  assert(!browserAutofillJsonSummary.includes("secret-autofill-name") && !browserAutofillJsonSummary.includes("secret-autofill-phone"), "runtime-autofill.json summary leaked field values");
  assert(browserAutofillResult.items.find((item) => item.title === "runtime-autofill.json")?.mime === "application/vnd.drsai.browser-autofill+json", "runtime-autofill.json MIME provenance is missing");

  const browserExtensionManifestSummary = summaryFor(browserExtensionManifestResult, "extension-manifest.json");
  assert(browserExtensionManifestSummary.includes("Browser extension manifest preview"), "extension-manifest.json did not use browser extension manifest preview");
  assert(browserExtensionManifestSummary.includes("Runtime Browser Extension"), "extension-manifest.json summary omitted extension identity evidence");
  assert(browserExtensionManifestSummary.includes("manifest_version=3"), "extension-manifest.json summary omitted manifest version evidence");
  assert(browserExtensionManifestSummary.includes("tabs") && browserExtensionManifestSummary.includes("declarativeNetRequest"), "extension-manifest.json summary omitted permission evidence");
  assert(browserExtensionManifestSummary.includes("https://api.extension.example.test/path?token=REDACTED"), "extension-manifest.json summary omitted host permission URL redaction evidence");
  assert(!browserExtensionManifestSummary.includes("secret-extension-token"), "extension-manifest.json summary leaked host permission token");
  assert(browserExtensionManifestSummary.includes("service_worker=background.js"), "extension-manifest.json summary omitted background service worker evidence");
  assert(browserExtensionManifestSummary.includes("content.js") && browserExtensionManifestSummary.includes("content script injection"), "extension-manifest.json summary omitted content script evidence");
  assert(browserExtensionManifestSummary.includes("extension code was not loaded or executed"), "extension-manifest.json summary omitted no-extension-load safety copy");
  assert(browserExtensionManifestResult.items.find((item) => item.title === "extension-manifest.json")?.mime === "application/vnd.drsai.browser-extension-manifest+json", "extension-manifest.json MIME provenance is missing");

  const browserExtensionInventorySummary = summaryFor(browserExtensionInventoryResult, "browser-extensions.json");
  assert(browserExtensionInventorySummary.includes("Browser extension inventory JSON preview"), "browser-extensions.json did not use browser extension inventory preview");
  assert(browserExtensionInventorySummary.includes("Runtime Extension Inventory") && browserExtensionInventorySummary.includes("Disabled Runtime Extension"), "browser-extensions.json summary omitted extension name evidence");
  assert(browserExtensionInventorySummary.includes("enabled=1") && browserExtensionInventorySummary.includes("disabled=1"), "browser-extensions.json summary omitted enabled/disabled counts");
  assert(browserExtensionInventorySummary.includes("tabs") && browserExtensionInventorySummary.includes("cookies") && browserExtensionInventorySummary.includes("declarativeNetRequest"), "browser-extensions.json summary omitted permission evidence");
  assert(browserExtensionInventorySummary.includes("https://inventory.example.test/*?api_key=REDACTED"), "browser-extensions.json summary omitted host permission URL redaction evidence");
  assert(browserExtensionInventorySummary.includes("host access") && browserExtensionInventorySummary.includes("sensitive browser API"), "browser-extensions.json summary omitted review cue evidence");
  assert(!browserExtensionInventorySummary.includes("secret-extension-inventory-token") && !browserExtensionInventorySummary.includes("secret-extension-inventory-key"), "browser-extensions.json summary leaked extension inventory secrets");
  assert(browserExtensionInventorySummary.includes("extension code was not loaded or executed"), "browser-extensions.json summary omitted no-extension-load safety copy");
  assert(browserExtensionInventoryResult.items.find((item) => item.title === "browser-extensions.json")?.mime === "application/vnd.drsai.browser-extension-inventory+json", "browser-extensions.json MIME provenance is missing");

  const vsixSummary = summaryFor(extensionPackageResult, "runtime-extension.vsix");
  assert(vsixSummary.includes("VS Code VSIX extension package metadata preview"), "runtime-extension.vsix did not use extension package preview");
  assert(vsixSummary.includes("extension/package.json") && vsixSummary.includes("extension/out/extension.js"), "runtime-extension.vsix summary omitted manifest/code evidence");
  assert(vsixSummary.includes("extension/_locales/en/messages.json"), "runtime-extension.vsix summary omitted locale evidence");
  assert(vsixSummary.includes("credential-shaped filename redacted"), "runtime-extension.vsix summary omitted credential-shaped filename redaction cue");
  assert(!vsixSummary.includes("secret-vsix-token") && vsixSummary.includes("[redacted]"), "runtime-extension.vsix summary leaked sensitive filename evidence");
  assert(vsixSummary.includes("VS Code/browsers/profiles were not opened") && vsixSummary.includes("extensions were not installed"), "runtime-extension.vsix summary omitted no-install/no-launch safety copy");
  assert(extensionPackageResult.items.find((item) => item.title === "runtime-extension.vsix")?.mime === "application/vsix", "runtime-extension.vsix MIME provenance is missing");
  const crxSummary = summaryFor(extensionPackageResult, "runtime-extension.crx");
  assert(crxSummary.includes("Chrome CRX browser extension package metadata preview"), "runtime-extension.crx did not use CRX extension package preview");
  assert(crxSummary.includes("CRX header: version 3") && crxSummary.includes("ZIP payload offset"), "runtime-extension.crx summary omitted CRX header evidence");
  assert(crxSummary.includes("manifest.json") && crxSummary.includes("background.js") && crxSummary.includes("content-script.js"), "runtime-extension.crx summary omitted manifest/code evidence");
  assert(crxSummary.includes("native or binary runtime payload") && crxSummary.includes("background/content/native integration entry"), "runtime-extension.crx summary omitted static review cues");
  assert(!crxSummary.includes("secret-crx-token") && crxSummary.includes("[redacted]"), "runtime-extension.crx summary leaked sensitive filename evidence");
  assert(crxSummary.includes("extension stores were not queried") && crxSummary.includes("no network call"), "runtime-extension.crx summary omitted no-store/no-network safety copy");
  assert(extensionPackageResult.items.find((item) => item.title === "runtime-extension.crx")?.mime === "application/x-chrome-extension", "runtime-extension.crx MIME provenance is missing");

  const browserHistoryCsvSummary = summaryFor(browserHistoryResult, "history.csv");
  assert(browserHistoryCsvSummary.includes("Browser history export preview"), "history.csv did not use browser history export preview");
  assert(browserHistoryCsvSummary.includes("history.example.test") && browserHistoryCsvSummary.includes("docs.history.example.test"), "history.csv summary omitted history host evidence");
  assert(browserHistoryCsvSummary.includes("Runtime History") && browserHistoryCsvSummary.includes("Docs History"), "history.csv summary omitted history title evidence");
  assert(browserHistoryCsvSummary.includes("visits=6") && browserHistoryCsvSummary.includes("typed=1"), "history.csv summary omitted visit totals");
  assert(browserHistoryCsvSummary.includes("token=%5BREDACTED%5D") && browserHistoryCsvSummary.includes("session=%5BREDACTED%5D"), "history.csv summary omitted URL query redaction evidence");
  assert(!browserHistoryCsvSummary.includes("secret-history-token") && !browserHistoryCsvSummary.includes("secret-history-session"), "history.csv summary leaked URL tokens");
  assert(browserHistoryCsvSummary.includes("browser profiles were not opened, history databases were not imported"), "history.csv summary omitted no-profile/no-import safety copy");
  assert(browserHistoryResult.items.find((item) => item.title === "history.csv")?.mime === "text/csv+browser-history", "history.csv MIME provenance is missing");

  const browserHistoryJsonSummary = summaryFor(browserHistoryResult, "runtime-history.json");
  assert(browserHistoryJsonSummary.includes("Browser history export preview"), "runtime-history.json did not use browser history export preview");
  assert(browserHistoryJsonSummary.includes("json-history.example.test"), "runtime-history.json summary omitted JSON history host evidence");
  assert(browserHistoryJsonSummary.includes("JSON Runtime History"), "runtime-history.json summary omitted JSON history title evidence");
  assert(browserHistoryJsonSummary.includes("api_key=%5BREDACTED%5D"), "runtime-history.json summary omitted JSON URL query redaction evidence");
  assert(!browserHistoryJsonSummary.includes("secret-json-history-key"), "runtime-history.json summary leaked URL token");
  assert(browserHistoryResult.items.find((item) => item.title === "runtime-history.json")?.mime === "application/vnd.drsai.browser-history+json", "runtime-history.json MIME provenance is missing");

  const browserHistorySqliteSummary = summaryFor(browserHistoryResult, "History");
  assert(browserHistorySqliteSummary.includes("Browser history SQLite database preview"), "History did not use browser history SQLite preview");
  assert(browserHistorySqliteSummary.includes("SQLite format 3"), "History summary omitted SQLite header evidence");
  assert(browserHistorySqliteSummary.includes("Local schema tables") && browserHistorySqliteSummary.includes("urls") && browserHistorySqliteSummary.includes("visits"), "History summary omitted browser history table evidence");
  assert(browserHistorySqliteSummary.includes("Browser history table cues: urls, visits, keyword_search_terms"), "History summary omitted browser history table cues");
  assert(browserHistorySqliteSummary.includes("Local index cues: urls_url_index"), "History summary omitted index evidence");
  assert(!browserHistorySqliteSummary.includes("secret-history-sqlite-token"), "History summary leaked SQLite string token");
  assert(browserHistorySqliteSummary.includes("row data was not queried") && browserHistorySqliteSummary.includes("SQLite was not connected"), "History summary omitted no-query/no-SQLite-connection safety copy");
  assert(browserHistoryResult.items.find((item) => item.title === "History")?.mime === "application/vnd.drsai.browser-history+sqlite", "History MIME provenance is missing");

  const browserDownloadsCsvSummary = summaryFor(browserDownloadsResult, "downloads.csv");
  assert(browserDownloadsCsvSummary.includes("Browser downloads export preview"), "downloads.csv did not use browser downloads export preview");
  assert(browserDownloadsCsvSummary.includes("downloads.example.test") && browserDownloadsCsvSummary.includes("cdn.downloads.example.test"), "downloads.csv summary omitted downloads host evidence");
  assert(browserDownloadsCsvSummary.includes("artifact.zip") && browserDownloadsCsvSummary.includes("report.pdf"), "downloads.csv summary omitted filename-only evidence");
  assert(!browserDownloadsCsvSummary.includes("C:\\Users\\tester\\Downloads"), "downloads.csv summary leaked target path");
  assert(browserDownloadsCsvSummary.includes("token=%5BREDACTED%5D") && browserDownloadsCsvSummary.includes("api_key=%5BREDACTED%5D"), "downloads.csv summary omitted URL query redaction evidence");
  assert(!browserDownloadsCsvSummary.includes("secret-download-token") && !browserDownloadsCsvSummary.includes("secret-download-key") && !browserDownloadsCsvSummary.includes("secret-download-session"), "downloads.csv summary leaked download URL tokens");
  assert(browserDownloadsCsvSummary.includes("downloaded files were not opened or executed"), "downloads.csv summary omitted no-open/no-execute safety copy");
  assert(browserDownloadsCsvSummary.includes("browser profiles and downloads databases were not imported"), "downloads.csv summary omitted no-profile/no-database safety copy");
  assert(browserDownloadsResult.items.find((item) => item.title === "downloads.csv")?.mime === "text/csv+browser-downloads", "downloads.csv MIME provenance is missing");

  const browserDownloadsJsonSummary = summaryFor(browserDownloadsResult, "runtime-downloads.json");
  assert(browserDownloadsJsonSummary.includes("Browser downloads export preview"), "runtime-downloads.json did not use browser downloads export preview");
  assert(browserDownloadsJsonSummary.includes("json-downloads.example.test"), "runtime-downloads.json summary omitted JSON downloads host evidence");
  assert(browserDownloadsJsonSummary.includes("runtime.exe"), "runtime-downloads.json summary omitted JSON filename evidence");
  assert(browserDownloadsJsonSummary.includes("token=%5BREDACTED%5D"), "runtime-downloads.json summary omitted JSON URL query redaction evidence");
  assert(!browserDownloadsJsonSummary.includes("secret-json-download-token") && !browserDownloadsJsonSummary.includes("secret-json-download-auth"), "runtime-downloads.json summary leaked JSON download URL tokens");
  assert(browserDownloadsResult.items.find((item) => item.title === "runtime-downloads.json")?.mime === "application/vnd.drsai.browser-downloads+json", "runtime-downloads.json MIME provenance is missing");
  const browserDownloadsSqliteSummary = summaryFor(browserDownloadsResult, "Downloads");
  assert(browserDownloadsSqliteSummary.includes("Browser downloads SQLite database preview"), "Downloads did not use browser downloads SQLite preview");
  assert(browserDownloadsSqliteSummary.includes("SQLite format 3"), "Downloads summary omitted SQLite header evidence");
  assert(browserDownloadsSqliteSummary.includes("Local schema tables") && browserDownloadsSqliteSummary.includes("downloads") && browserDownloadsSqliteSummary.includes("downloads_url_chains"), "Downloads summary omitted downloads table evidence");
  assert(browserDownloadsSqliteSummary.includes("Browser downloads table cues: downloads, downloads_url_chains, downloads_slices"), "Downloads summary omitted browser downloads table cues");
  assert(browserDownloadsSqliteSummary.includes("Local index cues: downloads_url_index"), "Downloads summary omitted downloads index evidence");
  assert(!browserDownloadsSqliteSummary.includes("secret-download-sqlite-token"), "Downloads summary leaked SQLite string token");
  assert(browserDownloadsSqliteSummary.includes("row data was not queried") && browserDownloadsSqliteSummary.includes("SQLite was not connected"), "Downloads summary omitted no-query/no-SQLite-connection safety copy");
  assert(browserDownloadsSqliteSummary.includes("downloaded files were not opened or executed"), "Downloads summary omitted no-open/no-execute safety copy");
  assert(browserDownloadsResult.items.find((item) => item.title === "Downloads")?.mime === "application/vnd.drsai.browser-downloads+sqlite", "Downloads MIME provenance is missing");

  const browserPreferencesSummary = summaryFor(browserPreferencesResult, "Preferences");
  assert(browserPreferencesSummary.includes("Browser preferences JSON preview"), "Preferences did not use browser preferences preview");
  assert(browserPreferencesSummary.includes("Runtime Profile") && browserPreferencesSummary.includes("Runtime Avatar"), "Preferences summary omitted profile evidence");
  assert(browserPreferencesSummary.includes("Runtime Search") && browserPreferencesSummary.includes("runtime"), "Preferences summary omitted search provider evidence");
  assert(browserPreferencesSummary.includes("token=%5BREDACTED%5D") && browserPreferencesSummary.includes("api_key=%5BREDACTED%5D") && browserPreferencesSummary.includes("session=%5BREDACTED%5D"), "Preferences summary omitted URL query redaction evidence");
  assert(browserPreferencesSummary.includes("runtime-preferences"), "Preferences summary omitted minimized download directory label");
  assert(browserPreferencesSummary.includes("Runtime Preferences Extension") && browserPreferencesSummary.includes("runtime-extension-id"), "Preferences summary omitted extension settings evidence");
  assert(browserPreferencesSummary.includes("cookies") && browserPreferencesSummary.includes("geolocation"), "Preferences summary omitted content setting evidence");
  assert(browserPreferencesSummary.includes("preference values were classified or redacted rather than printed"), "Preferences summary omitted no-value-printing safety copy");
  assert(browserPreferencesSummary.includes("browser profiles were not opened, preference stores were not imported"), "Preferences summary omitted no-profile/no-import safety copy");
  assert(!browserPreferencesSummary.includes("secret-preferences-token") && !browserPreferencesSummary.includes("secret-preferences-key") && !browserPreferencesSummary.includes("secret-preferences-session") && !browserPreferencesSummary.includes("secret-preferences-password-token"), "Preferences summary leaked preference secrets");
  assert(browserPreferencesResult.items.find((item) => item.title === "Preferences")?.mime === "application/vnd.drsai.browser-preferences+json", "Preferences MIME provenance is missing");

  const browserLocalStorageSummary = summaryFor(browserStorageResult, "local-storage.json");
  assert(browserLocalStorageSummary.includes("Browser storage export preview"), "local-storage.json did not use browser storage export preview");
  assert(browserLocalStorageSummary.includes("storage.example.test"), "local-storage.json summary omitted origin evidence");
  assert(browserLocalStorageSummary.includes("localStorage"), "local-storage.json summary omitted localStorage area evidence");
  assert(browserLocalStorageSummary.includes("theme") && browserLocalStorageSummary.includes("apiToken"), "local-storage.json summary omitted storage key evidence");
  assert(browserLocalStorageSummary.includes("string value") && browserLocalStorageSummary.includes("sensitive-looking keys detected"), "local-storage.json summary omitted value classification evidence");
  assert(!browserLocalStorageSummary.includes("secret-local-storage-token") && !browserLocalStorageSummary.includes("secret-nested-storage-token"), "local-storage.json summary leaked storage values");
  assert(browserLocalStorageSummary.includes("storage values were classified but not printed"), "local-storage.json summary omitted no-value-printing safety copy");
  assert(browserLocalStorageSummary.includes("browser profiles and LevelDB/IndexedDB stores were not opened"), "local-storage.json summary omitted no-profile/no-LevelDB safety copy");
  assert(browserStorageResult.items.find((item) => item.title === "local-storage.json")?.mime === "application/vnd.drsai.browser-storage+json", "local-storage.json MIME provenance is missing");

  const browserSessionStorageSummary = summaryFor(browserStorageResult, "runtime-session-storage.json");
  assert(browserSessionStorageSummary.includes("Browser storage export preview"), "runtime-session-storage.json did not use browser storage export preview");
  assert(browserSessionStorageSummary.includes("session-storage.example.test"), "runtime-session-storage.json summary omitted session origin evidence");
  assert(browserSessionStorageSummary.includes("sessionStorage"), "runtime-session-storage.json summary omitted sessionStorage area evidence");
  assert(browserSessionStorageSummary.includes("csrfToken") && browserSessionStorageSummary.includes("wizardStep"), "runtime-session-storage.json summary omitted session storage key evidence");
  assert(!browserSessionStorageSummary.includes("secret-session-storage-token"), "runtime-session-storage.json summary leaked storage value");
  assert(browserStorageResult.items.find((item) => item.title === "runtime-session-storage.json")?.mime === "application/vnd.drsai.browser-storage+json", "runtime-session-storage.json MIME provenance is missing");

  const browserSessionTabsSummary = summaryFor(browserSessionTabsResult, "tabs.json");
  assert(browserSessionTabsSummary.includes("Browser session tabs JSON preview"), "tabs.json did not use browser session tabs preview");
  assert(browserSessionTabsSummary.includes("tabs.example.test") && browserSessionTabsSummary.includes("docs.tabs.example.test"), "tabs.json summary omitted tab host evidence");
  assert(browserSessionTabsSummary.includes("Runtime Inbox") && browserSessionTabsSummary.includes("Runtime Docs"), "tabs.json summary omitted tab title evidence");
  assert(browserSessionTabsSummary.includes("Runtime Work") && browserSessionTabsSummary.includes("Runtime Research"), "tabs.json summary omitted tab group evidence");
  assert(browserSessionTabsSummary.includes("active=1") && browserSessionTabsSummary.includes("pinned=1") && browserSessionTabsSummary.includes("audible=1") && browserSessionTabsSummary.includes("discarded=1") && browserSessionTabsSummary.includes("incognito=1"), "tabs.json summary omitted tab flag totals");
  assert(browserSessionTabsSummary.includes("token=%5BREDACTED%5D") && browserSessionTabsSummary.includes("api_key=%5BREDACTED%5D"), "tabs.json summary omitted URL query redaction evidence");
  assert(browserSessionTabsSummary.includes("opener=opener.tabs.example.test") && browserSessionTabsSummary.includes("referrer=referrer.tabs.example.test"), "tabs.json summary omitted opener/referrer host evidence");
  assert(!browserSessionTabsSummary.includes("secret-tab-token") && !browserSessionTabsSummary.includes("secret-tab-key") && !browserSessionTabsSummary.includes("secret-tab-opener") && !browserSessionTabsSummary.includes("secret-tab-referrer"), "tabs.json summary leaked tab URL tokens");
  assert(browserSessionTabsSummary.includes("browser profiles were not opened, tabs were not restored"), "tabs.json summary omitted no-profile/no-restore safety copy");
  assert(browserSessionTabsResult.items.find((item) => item.title === "tabs.json")?.mime === "application/vnd.drsai.browser-session+json", "tabs.json MIME provenance is missing");

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

  const warcSummary = summaryFor(contentMediaResult, "runtime.warc");
  assert(warcSummary.includes("WARC web archive preview (WARC"), "runtime.warc did not use WARC web archive preview");
  assert(warcSummary.includes("warcinfo") && warcSummary.includes("response"), "runtime.warc summary omitted WARC record type evidence");
  assert(warcSummary.includes("https://archive.example.test/page?token=REDACTED"), "runtime.warc summary omitted redacted target URI evidence");
  assert(!warcSummary.includes("secret-warc-token") && !warcSummary.includes("secret-warc-body-token"), "runtime.warc summary leaked WARC secrets");
  assert(warcSummary.includes("archived payload bodies were not expanded"), "runtime.warc summary omitted no-payload-expansion safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "runtime.warc")?.mime === "application/warc", "runtime.warc MIME provenance is missing");

  const warcGzipSummary = summaryFor(contentMediaResult, "runtime.warc.gz");
  assert(warcGzipSummary.includes("WARC web archive preview (gzip-compressed WARC"), "runtime.warc.gz did not use gzipped WARC preview");
  assert(warcGzipSummary.includes("compressed input decompressed locally: yes"), "runtime.warc.gz summary omitted local decompression evidence");
  assert(warcGzipSummary.includes("crawler replay was not started"), "runtime.warc.gz summary omitted no-replay safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "runtime.warc.gz")?.mime === "application/warc+gzip", "runtime.warc.gz MIME provenance is missing");

  const pwaManifestSummary = summaryFor(contentMediaResult, "site.webmanifest");
  assert(pwaManifestSummary.includes("PWA web app manifest preview"), "site.webmanifest did not use PWA manifest preview");
  assert(pwaManifestSummary.includes("Runtime PWA Fixture"), "site.webmanifest summary omitted app name evidence");
  assert(pwaManifestSummary.includes("display=standalone"), "site.webmanifest summary omitted display evidence");
  assert(pwaManifestSummary.includes("Icons (1): /icons/runtime-192.png?token=REDACTED"), "site.webmanifest summary omitted icon redaction evidence");
  assert(pwaManifestSummary.includes("Shortcuts (1): Open Runtime Inbox -> /app/inbox?token=REDACTED"), "site.webmanifest summary omitted shortcut redaction evidence");
  assert(pwaManifestSummary.includes("Share target: /share?token=REDACTED"), "site.webmanifest summary omitted share target redaction evidence");
  assert(pwaManifestSummary.includes("Protocol handlers (1): web+runtime -> /protocol?url=%s&token=REDACTED"), "site.webmanifest summary omitted protocol handler evidence");
  assert(pwaManifestSummary.includes("File handlers (1): /open-file?token=REDACTED accepts text/plain"), "site.webmanifest summary omitted file handler evidence");
  assert(!pwaManifestSummary.includes("secret-pwa"), "site.webmanifest summary leaked secret PWA token");
  assert(pwaManifestSummary.includes("no browser was launched, manifest URLs/icons/screenshots were not fetched"), "site.webmanifest summary omitted no-browser/no-fetch safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "site.webmanifest")?.mime === "application/manifest+json", "site.webmanifest MIME provenance is missing");

  const pwaServiceWorkerSummary = summaryFor(contentMediaResult, "service-worker.js");
  assert(pwaServiceWorkerSummary.includes("PWA service worker script preview"), "service-worker.js did not use PWA service worker preview");
  assert(pwaServiceWorkerSummary.includes("install") && pwaServiceWorkerSummary.includes("activate") && pwaServiceWorkerSummary.includes("fetch") && pwaServiceWorkerSummary.includes("push"), "service-worker.js summary omitted lifecycle event evidence");
  assert(pwaServiceWorkerSummary.includes("caches.open") && pwaServiceWorkerSummary.includes("cache.addAll"), "service-worker.js summary omitted cache evidence");
  assert(pwaServiceWorkerSummary.includes("event.respondWith") && pwaServiceWorkerSummary.includes("Workbox StaleWhileRevalidate"), "service-worker.js summary omitted routing evidence");
  assert(pwaServiceWorkerSummary.includes("/workbox-v7.js?token=REDACTED"), "service-worker.js summary omitted importScripts URL redaction evidence");
  assert(pwaServiceWorkerSummary.includes("notifications") && pwaServiceWorkerSummary.includes("navigation preload") && pwaServiceWorkerSummary.includes("skipWaiting"), "service-worker.js summary omitted PWA capability evidence");
  assert(!pwaServiceWorkerSummary.includes("secret-sw"), "service-worker.js summary leaked service worker secret values");
  assert(pwaServiceWorkerSummary.includes("no browser was launched, no service worker was registered, no cache was opened"), "service-worker.js summary omitted no-registration/no-cache safety copy");
  assert(contentMediaResult.items.find((item) => item.title === "service-worker.js")?.mime === "text/javascript", "service-worker.js MIME provenance is missing");

  const srtSummary = summaryFor(contentMediaResult, "captions.srt");
  assert(srtSummary.includes("Timed transcript preview"), "captions.srt did not use timed transcript preview");
  assert(srtSummary.includes("Runtime SRT caption"), "captions.srt summary omitted SRT cue evidence");
  assert(srtSummary.includes("no microphone capture"), "captions.srt summary omitted no-capture safety copy");

  const vttSummary = summaryFor(contentMediaResult, "captions.vtt");
  assert(vttSummary.includes("Timed transcript preview"), "captions.vtt did not use timed transcript preview");
  assert(vttSummary.includes("Runtime VTT caption"), "captions.vtt summary omitted VTT cue evidence");
  assert(vttSummary.includes("no microphone capture"), "captions.vtt summary omitted no-capture safety copy");

  const devcontainerSummary = summaryFor(devcontainerConfigResult, "devcontainer.json");
  assert(devcontainerSummary.includes("Dev Container config preview"), "devcontainer.json did not use Dev Container config preview");
  assert(devcontainerSummary.includes("Runtime Dev Container"), "devcontainer.json summary omitted name evidence");
  assert(devcontainerSummary.includes("mcr.microsoft.com/devcontainers/typescript-node:22"), "devcontainer.json summary omitted image evidence");
  assert(devcontainerSummary.includes("../docker-compose.yml"), "devcontainer.json summary omitted compose file evidence");
  assert(devcontainerSummary.includes("ghcr.io/devcontainers/features/node:1"), "devcontainer.json summary omitted feature evidence");
  assert(devcontainerSummary.includes("3000") && devcontainerSummary.includes("5173") && devcontainerSummary.includes("9229"), "devcontainer.json summary omitted forwarded port evidence");
  assert(devcontainerSummary.includes("RUNTIME_TOKEN") && devcontainerSummary.includes("OPENAI_API_KEY"), "devcontainer.json summary omitted env key evidence");
  assert(devcontainerSummary.includes("network download/request command") && devcontainerSummary.includes("package install command"), "devcontainer.json summary omitted static risk cues");
  assert(!devcontainerSummary.includes("secret-devcontainer-token") && !devcontainerSummary.includes("secret-devcontainer-api-key"), "devcontainer.json summary leaked secret values");
  assert(devcontainerSummary.includes("no VS Code Dev Containers extension") && devcontainerSummary.includes("docker/devcontainer CLI"), "devcontainer.json summary omitted no-runtime safety copy");
  assert(devcontainerConfigResult.items.find((item) => item.title === "devcontainer.json")?.mime === "application/vnd.devcontainer+json", "devcontainer.json MIME provenance is missing");

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

  const androidStringsSummary = summaryFor(mobileManifestResult, "strings.xml");
  assert(androidStringsSummary.includes("Android resource XML preview"), "strings.xml did not use Android resource XML preview");
  assert(androidStringsSummary.includes("string=app_name"), "strings.xml summary omitted string resource evidence");
  assert(androidStringsSummary.includes("color=brand_primary"), "strings.xml summary omitted color resource evidence");
  assert(androidStringsSummary.includes("bool=feature_chat_enabled"), "strings.xml summary omitted bool resource evidence");
  assert(androidStringsSummary.includes("string-array=quick_actions"), "strings.xml summary omitted array resource evidence");
  assert(!androidStringsSummary.includes("secret-android-resource-token"), "strings.xml summary leaked Android resource value");
  assert(androidStringsSummary.includes("resource values were not expanded"), "strings.xml summary omitted value non-expansion evidence");
  assert(androidStringsSummary.includes("no Gradle/Android Studio/ADB/emulator/aapt/resource merger command"), "strings.xml summary omitted no-resource-runtime safety copy");
  assert(mobileManifestResult.items.find((item) => item.title === "strings.xml")?.mime === "application/vnd.android.resource+xml", "strings.xml MIME provenance is missing");

  const androidNetworkSecuritySummary = summaryFor(mobileManifestResult, "network_security_config.xml");
  assert(androidNetworkSecuritySummary.includes("Android resource XML preview"), "network_security_config.xml did not use Android resource XML preview");
  assert(androidNetworkSecuritySummary.includes("base-config cleartextTrafficPermitted=false"), "network_security_config.xml summary omitted base config evidence");
  assert(androidNetworkSecuritySummary.includes("domain-config cleartextTrafficPermitted=true"), "network_security_config.xml summary omitted domain config evidence");
  assert(androidNetworkSecuritySummary.includes("api.opendrsai.test"), "network_security_config.xml summary omitted domain evidence");
  assert(androidNetworkSecuritySummary.includes("certificates src=@raw/runtime_ca overridePins=true"), "network_security_config.xml summary omitted certificate evidence");
  assert(androidNetworkSecuritySummary.includes("no Gradle/Android Studio/ADB/emulator/aapt/resource merger command"), "network_security_config.xml summary omitted no-resource-runtime safety copy");
  assert(mobileManifestResult.items.find((item) => item.title === "network_security_config.xml")?.mime === "application/vnd.android.resource+xml", "network_security_config.xml MIME provenance is missing");

  const androidLogcatSummary = summaryFor(mobileManifestResult, "runtime.logcat");
  assert(androidLogcatSummary.includes("Android logcat export preview"), "runtime.logcat did not use Android logcat preview");
  assert(androidLogcatSummary.includes("I: 1") && androidLogcatSummary.includes("W: 1") && androidLogcatSummary.includes("E: 1") && androidLogcatSummary.includes("D: 1"), "runtime.logcat summary omitted priority counts");
  assert(androidLogcatSummary.includes("ActivityTaskManager") && androidLogcatSummary.includes("AndroidRuntime") && androidLogcatSummary.includes("DrSaiMobile"), "runtime.logcat summary omitted tag evidence");
  assert(androidLogcatSummary.includes("1234") && androidLogcatSummary.includes("3333"), "runtime.logcat summary omitted process id evidence");
  assert(androidLogcatSummary.includes("token=[redacted]"), "runtime.logcat summary omitted redacted token evidence");
  assert(!androidLogcatSummary.includes("secret-logcat-token") && !androidLogcatSummary.includes("secret-crash-token") && !androidLogcatSummary.includes("secret-brief-token"), "runtime.logcat summary leaked sensitive token values");
  assert(androidLogcatSummary.includes("no adb/logcat command, device/emulator access, live log streaming"), "runtime.logcat summary omitted no-ADB/no-device safety copy");

  const appleUnifiedLogSummary = summaryFor(mobileManifestResult, "system.log");
  assert(appleUnifiedLogSummary.includes("Apple unified/syslog export preview"), "system.log did not use Apple unified/syslog preview");
  assert(appleUnifiedLogSummary.includes("Default: 1") && appleUnifiedLogSummary.includes("Error: 1") && appleUnifiedLogSummary.includes("Fault: 1") && appleUnifiedLogSummary.includes("Info: 1"), "system.log summary omitted Apple log level counts");
  assert(appleUnifiedLogSummary.includes("DrSaiMobile") && appleUnifiedLogSummary.includes("diagnosticd") && appleUnifiedLogSummary.includes("SpringBoard"), "system.log summary omitted process evidence");
  assert(appleUnifiedLogSummary.includes("org.opendrsai.mobile") && appleUnifiedLogSummary.includes("com.apple.diagnostic"), "system.log summary omitted subsystem evidence");
  assert(appleUnifiedLogSummary.includes("token=[redacted]"), "system.log summary omitted redacted token evidence");
  assert(!appleUnifiedLogSummary.includes("secret-oslog-token") && !appleUnifiedLogSummary.includes("secret-network-token") && !appleUnifiedLogSummary.includes("secret-fault-token") && !appleUnifiedLogSummary.includes("secret-syslog-token"), "system.log summary leaked sensitive token values");
  assert(appleUnifiedLogSummary.includes("no Console.app, log command, sysdiagnose collection"), "system.log summary omitted no-Console/no-log-command safety copy");
  assert(mobileManifestResult.items.find((item) => item.title === "system.log")?.mime === "text/x-apple-unified-log", "system.log MIME provenance is missing");

  const infoPlistSummary = summaryFor(mobileManifestResult, "Info.plist");
  assert(infoPlistSummary.includes("Apple Info.plist app manifest preview"), "Info.plist did not use Apple Info.plist preview");
  assert(infoPlistSummary.includes("org.opendrsai.runtime.ios"), "Info.plist summary omitted bundle identifier evidence");
  assert(infoPlistSummary.includes("shortVersion=2.3.4"), "Info.plist summary omitted version evidence");
  assert(infoPlistSummary.includes("platform=iphoneos"), "Info.plist summary omitted platform evidence");
  assert(infoPlistSummary.includes("drsai-runtime"), "Info.plist summary omitted URL scheme evidence");
  assert(infoPlistSummary.includes("NSCameraUsageDescription"), "Info.plist summary omitted privacy usage key evidence");
  assert(!infoPlistSummary.includes("secret-camera-token"), "Info.plist summary leaked privacy usage-description value");
  assert(infoPlistSummary.includes("no plutil/xcodebuild/simulator command"), "Info.plist summary omitted no-Apple-runtime safety copy");

  const appleCrashSummary = summaryFor(mobileManifestResult, "runtime.crash");
  assert(appleCrashSummary.includes("Apple crash report preview"), "runtime.crash did not use Apple crash report preview");
  assert(appleCrashSummary.includes("RuntimeFixture") && appleCrashSummary.includes("org.opendrsai.runtime.ios"), "runtime.crash summary omitted process/bundle evidence");
  assert(appleCrashSummary.includes("EXC_BAD_ACCESS") && appleCrashSummary.includes("KERN_INVALID_ADDRESS"), "runtime.crash summary omitted exception evidence");
  assert(appleCrashSummary.includes("Thread 0") || appleCrashSummary.includes("Crashed thread: 0"), "runtime.crash summary omitted crashed thread evidence");
  assert(appleCrashSummary.includes("RuntimeCrashEntry") && appleCrashSummary.includes("RuntimeKit"), "runtime.crash summary omitted frame/binary evidence");
  assert(!appleCrashSummary.includes("secret-crash-token") && !appleCrashSummary.includes("secret-frame-token") && !appleCrashSummary.includes("secret-path-token"), "runtime.crash summary leaked crash report secrets");
  assert(appleCrashSummary.includes("no Console.app, Xcode, CrashReporter, symbolication, dSYM lookup"), "runtime.crash summary omitted no-symbolication safety copy");
  assert(mobileManifestResult.items.find((item) => item.title === "runtime.crash")?.mime === "text/x-apple-crash-report", "runtime.crash MIME provenance is missing");

  const appleIpsSummary = summaryFor(mobileManifestResult, "runtime.ips");
  assert(appleIpsSummary.includes("Apple crash report preview (Apple IPS JSON"), "runtime.ips did not use Apple IPS preview");
  assert(appleIpsSummary.includes("org.opendrsai.runtime.ips") && appleIpsSummary.includes("macOS 15.5"), "runtime.ips summary omitted bundle/OS evidence");
  assert(appleIpsSummary.includes("EXC_CRASH") && appleIpsSummary.includes("SIGABRT"), "runtime.ips summary omitted exception evidence");
  assert(appleIpsSummary.includes("RuntimeAbortEntry") && appleIpsSummary.includes("RuntimeWorker.run"), "runtime.ips summary omitted frame evidence");
  assert(!appleIpsSummary.includes("secret-ips-token") && !appleIpsSummary.includes("secret-ips-reason-token") && !appleIpsSummary.includes("secret-source-token"), "runtime.ips summary leaked IPS secrets");
  assert(appleIpsSummary.includes("no Console.app, Xcode, CrashReporter, symbolication, dSYM lookup"), "runtime.ips summary omitted no-symbolication safety copy");
  assert(mobileManifestResult.items.find((item) => item.title === "runtime.ips")?.mime === "application/vnd.apple.ips+json", "runtime.ips MIME provenance is missing");

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

  const wavSummary = summaryFor(audioResult, "runtime.wav");
  assert(wavSummary.includes("Audio metadata preview"), "runtime.wav did not use audio metadata preview");
  assert(wavSummary.includes("Format: WAV"), "runtime.wav summary omitted WAV format evidence");
  assert(wavSummary.includes("44100 Hz"), "runtime.wav summary omitted sample-rate evidence");
  assert(wavSummary.includes("stereo"), "runtime.wav summary omitted channel evidence");
  assert(wavSummary.includes("16-bit"), "runtime.wav summary omitted bit-depth evidence");
  assert(wavSummary.includes("no microphone capture"), "runtime.wav summary omitted no-capture safety copy");

  const mp3Summary = summaryFor(audioResult, "runtime.mp3");
  assert(mp3Summary.includes("Audio metadata preview"), "runtime.mp3 did not use audio metadata preview");
  assert(mp3Summary.includes("Format: MP3"), "runtime.mp3 summary omitted MP3 format evidence");
  assert(mp3Summary.includes("44100 Hz"), "runtime.mp3 summary omitted sample-rate evidence");
  assert(mp3Summary.includes("128 kbps"), "runtime.mp3 summary omitted bit-rate evidence");
  assert(mp3Summary.includes("ID3: ID3v2.3"), "runtime.mp3 summary omitted ID3 evidence");
  assert(mp3Summary.includes("no microphone capture"), "runtime.mp3 summary omitted no-capture safety copy");

  const aacSummary = summaryFor(audioResult, "runtime.aac");
  assert(aacSummary.includes("Audio metadata preview"), "runtime.aac did not use audio metadata preview");
  assert(aacSummary.includes("Format: AAC ADTS"), "runtime.aac summary omitted AAC ADTS format evidence");
  assert(aacSummary.includes("44100 Hz"), "runtime.aac summary omitted sample-rate evidence");
  assert(aacSummary.includes("stereo"), "runtime.aac summary omitted channel evidence");
  assert(aacSummary.includes("profile LC"), "runtime.aac summary omitted AAC profile evidence");
  assert(aacSummary.includes("no microphone capture"), "runtime.aac summary omitted no-capture safety copy");

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

  const pngColorSummary = summaryFor(imageColorResult, "runtime-color.png");
  assert(pngColorSummary.includes("Image metadata preview"), "runtime-color.png did not use image metadata preview");
  assert(pngColorSummary.includes("Dimensions: 64 x 32 px"), "runtime-color.png summary omitted dimensions");
  assert(pngColorSummary.includes("Color profile hints"), "runtime-color.png summary omitted color profile hints");
  assert(pngColorSummary.includes("sRGB perceptual") && pngColorSummary.includes("iCCP Runtime RGB compressed"), "runtime-color.png summary omitted PNG color chunk evidence");
  assert(pngColorSummary.includes("no OCR, vision model, network call") && pngColorSummary.includes("No image renderer startup, pixel decode, animation playback, ICC/profile validation"), "runtime-color.png summary omitted no-vision/no-color-validation safety copy");

  const jpegColorSummary = summaryFor(imageColorResult, "runtime-color.jpg");
  assert(jpegColorSummary.includes("Image metadata preview"), "runtime-color.jpg did not use image metadata preview");
  assert(jpegColorSummary.includes("Dimensions: 48 x 32 px"), "runtime-color.jpg summary omitted dimensions");
  assert(jpegColorSummary.includes("ICC_PROFILE APP2 segment 1/1"), "runtime-color.jpg summary omitted ICC APP2 evidence");
  assert(jpegColorSummary.includes("Adobe APP14 transform 1"), "runtime-color.jpg summary omitted Adobe APP14 evidence");
  assert(jpegColorSummary.includes("pixel color conversion was performed"), "runtime-color.jpg summary omitted no-color-conversion safety copy");

  const gifAnimationSummary = summaryFor(imageColorResult, "runtime-animated.gif");
  assert(gifAnimationSummary.includes("Image metadata preview"), "runtime-animated.gif did not use image metadata preview");
  assert(gifAnimationSummary.includes("Format: GIF89a"), "runtime-animated.gif summary omitted GIF89a format evidence");
  assert(gifAnimationSummary.includes("Dimensions: 32 x 16 px"), "runtime-animated.gif summary omitted dimensions");
  assert(gifAnimationSummary.includes("Animation hints: animation frames 2"), "runtime-animated.gif summary omitted animation frame evidence");
  assert(gifAnimationSummary.includes("loop count forever"), "runtime-animated.gif summary omitted animation loop evidence");
  assert(gifAnimationSummary.includes("animation playback") && gifAnimationSummary.includes("pixel decode"), "runtime-animated.gif summary omitted no-animation/no-pixel-decode safety copy");

  const webpAnimationSummary = summaryFor(imageColorResult, "runtime-animated.webp");
  assert(webpAnimationSummary.includes("Image metadata preview"), "runtime-animated.webp did not use image metadata preview");
  assert(webpAnimationSummary.includes("Format: WebP VP8X"), "runtime-animated.webp summary omitted WebP VP8X format evidence");
  assert(webpAnimationSummary.includes("Dimensions: 40 x 24 px"), "runtime-animated.webp summary omitted dimensions");
  assert(webpAnimationSummary.includes("animation") && webpAnimationSummary.includes("alpha"), "runtime-animated.webp summary omitted VP8X feature flags");
  assert(webpAnimationSummary.includes("Animation hints: animation frames 2"), "runtime-animated.webp summary omitted animation frame evidence");
  assert(webpAnimationSummary.includes("loop count forever"), "runtime-animated.webp summary omitted animation loop evidence");
  assert(webpAnimationSummary.includes("animation playback") && webpAnimationSummary.includes("pixel decode"), "runtime-animated.webp summary omitted no-animation/no-pixel-decode safety copy");

  const svgStructureSummary = summaryFor(imageColorResult, "runtime.svg");
  assert(svgStructureSummary.includes("Image metadata preview"), "runtime.svg did not use image metadata preview");
  assert(svgStructureSummary.includes("Format: SVG"), "runtime.svg summary omitted SVG format evidence");
  assert(svgStructureSummary.includes("Dimensions: 120 x 80 px"), "runtime.svg summary omitted SVG dimensions");
  assert(svgStructureSummary.includes("viewBox=0 0 120 80"), "runtime.svg summary omitted viewBox evidence");
  assert(svgStructureSummary.includes("symbol=1") && svgStructureSummary.includes("path=1") && svgStructureSummary.includes("image=1") && svgStructureSummary.includes("script=1") && svgStructureSummary.includes("foreignObject=1"), "runtime.svg summary omitted SVG element counts");
  assert(svgStructureSummary.includes("runtime-icon") && svgStructureSummary.includes("runtime-label"), "runtime.svg summary omitted SVG id samples");
  assert(svgStructureSummary.includes("script element") && svgStructureSummary.includes("foreignObject") && svgStructureSummary.includes("external reference"), "runtime.svg summary omitted SVG static risk cues");
  assert(svgStructureSummary.includes("Runtime SVG Map") && svgStructureSummary.includes("Runtime SVG Label"), "runtime.svg summary omitted SVG text preview");
  assert(!svgStructureSummary.includes("secret-svg-token") && !svgStructureSummary.includes("secret-svg-script-token"), "runtime.svg summary leaked SVG secret-shaped values");
  assert(svgStructureSummary.includes("no OCR, vision model, network call") && svgStructureSummary.includes("No image renderer startup"), "runtime.svg summary omitted no-render/no-provider safety copy");
  assert(imageColorResult.items.find((item) => item.title === "runtime.svg")?.mime === "image/svg+xml", "runtime.svg MIME provenance is missing");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Channel adapter runtime fixture verification passed.");
