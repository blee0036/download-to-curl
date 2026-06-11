const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("manifest declares the required MV3 permissions and entry points", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
  );

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "background.js");
  for (const permission of ["webRequest", "webRequestBlocking", "storage", "tabs", "clipboardWrite"]) {
    assert.ok(manifest.permissions.includes(permission), `missing ${permission}`);
  }
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});
