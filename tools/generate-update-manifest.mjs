import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const id = args.id || args.extensionId;
const crxUrl = args.crxUrl;
const version = args.version || manifest.version;
const out = resolve(args.out || "dist/update.xml");

if (!id || !/^[a-p]{32}$/.test(id)) {
  fail("Missing or invalid --id. Chrome extension IDs are 32 chars using a-p.");
}

if (!crxUrl || !/^https?:\/\//i.test(crxUrl)) {
  fail("Missing or invalid --crx-url. Use an http(s) URL that Chrome can reach.");
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${escapeXml(id)}">
    <updatecheck codebase="${escapeXml(crxUrl)}" version="${escapeXml(version)}" />
  </app>
</gupdate>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml, "utf8");
console.log(out);

function parseArgs(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    const item = values[i];
    if (!item.startsWith("--")) {
      continue;
    }
    const eqIndex = item.indexOf("=");
    if (eqIndex !== -1) {
      result[toCamel(item.slice(2, eqIndex))] = item.slice(eqIndex + 1);
    } else {
      result[toCamel(item.slice(2))] = values[i + 1];
      i += 1;
    }
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
