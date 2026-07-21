import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pathToFileURL } from "node:url";

export const KNOWN_LIBPNG_WARNING = "libpng warning: iCCP: known incorrect sRGB profile";

export class DevStderrFilter extends Transform {
  #pending = Buffer.alloc(0);
  #showLibPngWarnings;

  constructor({ showLibPngWarnings = false } = {}) {
    super();
    this.#showLibPngWarnings = showLibPngWarnings;
  }

  _transform(chunk, _encoding, callback) {
    this.#pending = Buffer.concat([this.#pending, Buffer.from(chunk)]);
    let newline;
    while ((newline = this.#pending.indexOf(0x0a)) >= 0) {
      const line = this.#pending.subarray(0, newline + 1);
      this.#pending = this.#pending.subarray(newline + 1);
      this.#writeLine(line);
    }
    callback();
  }

  _flush(callback) {
    if (this.#pending.length) this.#writeLine(this.#pending);
    callback();
  }

  #writeLine(line) {
    const text = line.toString("utf8").replace(/[\r\n]+$/, "");
    if (this.#showLibPngWarnings || text !== KNOWN_LIBPNG_WARNING) this.push(line);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let showLibPngWarnings = false;
  let probe = false;
  while (args[0]?.startsWith("--")) {
    const option = args.shift();
    if (option === "--show-libpng-warnings") showLibPngWarnings = true;
    else if (option === "--probe") probe = true;
    else {
      console.error(`Unknown option: ${option}`);
      process.exitCode = 2;
      return;
    }
  }
  const npmCommand = args.shift();
  if (!npmCommand || args.length) {
    console.error("Usage: node run-dev-with-filter.mjs [--show-libpng-warnings] [--probe] <npm-command>");
    process.exitCode = 2;
    return;
  }

  const npmArgs = probe ? ["--version"] : ["run", "dev"];
  const child = spawnNpm(npmCommand, npmArgs, {
    windowsHide: false,
    stdio: ["inherit", "inherit", "pipe"],
  });
  child.stderr
    .pipe(new DevStderrFilter({ showLibPngWarnings }))
    .pipe(process.stderr, { end: false });

  const exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      console.error(`Could not start Electron dev server: ${error.message}`);
      resolve(1);
    });
    child.once("exit", (code, signal) => {
      if (signal) console.error(`Electron dev server exited after signal ${signal}.`);
      resolve(code ?? 1);
    });
  });
  process.exitCode = exitCode;
}

function spawnNpm(npmCommand, npmArgs, options) {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(npmCommand)) {
    return spawn(npmCommand, npmArgs, { ...options, shell: false });
  }
  const npmDir = dirname(npmCommand);
  const npmCli = join(npmDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) {
    throw new Error(`Could not locate npm-cli.js beside ${npmCommand}.`);
  }
  const adjacentNode = join(npmDir, "node.exe");
  const nodeCommand = existsSync(adjacentNode) ? adjacentNode : process.execPath;
  return spawn(nodeCommand, [npmCli, ...npmArgs], { ...options, shell: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
