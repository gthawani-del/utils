import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { unzipSync } from "fflate";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const models = [
  ["vosk-model-small-en-us-0.15", "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"],
  ["vosk-model-small-hi-0.22", "7c50a10866889f0ac21d912c20537a055a597ed09fc1d3e5bcd798f9f0017e48"],
];

// Build-time repackaging only. Official Vosk downloads are ZIPs, whereas the
// browser worker reads tar.gz. No decompression/conversion burden on the phone.
function modelTar(zip, name) {
  const files = unzipSync(zip);
  const parts = [];
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith(name + "/") || path.includes("..") || path.includes("\\"))
      throw new Error("Unexpected model archive path");
    const directory = path.endsWith("/");
    const data = Buffer.from(files[path]);
    const entry = "model/" + path.slice(name.length + 1);
    if (Buffer.byteLength(entry) >= 100) throw new Error("Model archive path too long");
    const header = Buffer.alloc(512);
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
    header.write(entry, 0, 100);
    octal(directory ? 0o755 : 0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(data.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write(directory ? "5" : "0", 156); header.write("ustar\0", 257); header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    parts.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

export async function buildLyricalVosk(root, dist) {
  const library = await readFile(resolve(root, "node_modules/vosk-browser/dist/vosk.js"), "utf8");
  const encoded = library.match(/createBase64WorkerFactory\(['"]([A-Za-z0-9+/=]+)['"]/);
  if (!encoded) throw new Error("Pinned Vosk worker missing");
  let worker = Buffer.from(encoded[1], "base64").toString("utf8");
  if (sha256(worker) !== "7ba6b482f49ff3d49290b85f4ca13d5c6a5787b237cac1c6d15129668d36f529")
    throw new Error("Vosk worker changed: review the adapter and CSP patch before upgrading");
  // Emscripten's name-only wrapper uses new Function. An ordinary function has
  // the same call/this semantics without weakening the site's script CSP.
  const start = worker.indexOf("function createNamedFunction(name,body){");
  const end = worker.indexOf("var emval_free_list=", start);
  if (start < 0 || end < 0) throw new Error("Vosk function wrapper not found");
  worker = worker.slice(0, start) +
    'function createNamedFunction(name,body){var fn=function(){return body.apply(this,arguments)};Object.defineProperty(fn,"name",{value:makeLegalFunctionName(name),configurable:true});return fn}' +
    worker.slice(end);
  if (/\bnew\s+Function\b|\beval\s*\(/.test(worker)) throw new Error("Vosk runtime violates script CSP");
  await writeFile(resolve(dist, "assets/lyrical-vosk-engine.js"),
    "/*! Vosk Browser 0.0.8 / Vosk (Apache-2.0). Modified function naming for CSP; see /assets/vendor/lyrical-vosk-NOTICE.txt */\n" + worker);

  const cache = resolve(root, "node_modules/.cache/lyrical-vosk");
  const output = resolve(dist, "assets/models");
  await mkdir(cache, { recursive: true });
  await mkdir(output, { recursive: true });
  for (const [name, expected] of models) {
    const cached = resolve(cache, name + ".zip");
    let zip = await readFile(cached).catch(() => null);
    if (!zip || sha256(zip) !== expected) {
      console.log("Preparing Lyrical model:", name);
      const response = await fetch("https://alphacephei.com/vosk/models/" + name + ".zip", { signal: AbortSignal.timeout(180_000) });
      if (!response.ok) throw new Error("Model download failed: " + response.status);
      zip = Buffer.from(await response.arrayBuffer());
      if (sha256(zip) !== expected) throw new Error("Model checksum mismatch: " + name);
      await writeFile(cached, zip);
    }
    await writeFile(resolve(output, name + ".tar.gz"), modelTar(zip, name));
  }
  console.log("Lyrical Vosk runtime and verified English/Hindi models prepared.");
}
