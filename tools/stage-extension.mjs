import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const out = resolve(root, "dist", "extension");
const files = [
  "manifest.json",
  "background.js",
  "capture.html",
  "capture.js",
  "capture.css"
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const file of files) {
  copyFileSync(resolve(root, file), resolve(out, file));
}

cpSync(resolve(root, "lib"), resolve(out, "lib"), { recursive: true });
console.log(out);
