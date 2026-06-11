import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const pemPath = process.argv[2];

if (!pemPath) {
  console.error("Usage: node tools/extension-id-from-pem.mjs <private-or-public-key.pem>");
  process.exit(1);
}

const pem = readFileSync(pemPath, "utf8");
const publicKeyDer = createPublicKey(pem).export({
  type: "spki",
  format: "der"
});
const digest = createHash("sha256").update(publicKeyDer).digest();
const alphabet = "abcdefghijklmnop";
let id = "";

for (const byte of digest.subarray(0, 16)) {
  id += alphabet[byte >> 4];
  id += alphabet[byte & 0x0f];
}

console.log(id);
