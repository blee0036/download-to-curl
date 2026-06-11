const assert = require("node:assert/strict");
const test = require("node:test");
const Core = require("../lib/capture-core");

test("detects downloads by content-disposition and ignores blocked resource types", () => {
  assert.equal(
    Core.isDownloadResponse({
      url: "https://example.com/report",
      type: "xmlhttprequest",
      responseHeaders: [{ name: "Content-Disposition", value: 'attachment; filename="report.csv"' }]
    }).matched,
    true
  );

  assert.deepEqual(
    Core.isDownloadResponse({
      url: "https://example.com/image.png",
      type: "image",
      responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }]
    }),
    { matched: false, reason: "blocked-resource-type" }
  );
});

test("detects downloads by content type, extension, and custom rule", () => {
  assert.equal(
    Core.isDownloadResponse({
      url: "https://example.com/no-extension",
      type: "xmlhttprequest",
      responseHeaders: [{ name: "Content-Type", value: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8" }]
    }).matched,
    true
  );

  assert.equal(
    Core.isDownloadResponse({
      url: "https://example.com/releases/app.pkg?token=1",
      type: "main_frame",
      responseHeaders: []
    }).matched,
    true
  );

  assert.equal(
    Core.isDownloadResponse({
      url: "https://example.com/api/export",
      type: "xmlhttprequest",
      responseHeaders: [{ name: "X-Export", value: "yes" }],
      customRules: ["/x-export: yes/i"]
    }).reason,
    "custom-rule"
  );
});

test("infers filename using RFC5987 content-disposition before URL fallback", () => {
  assert.equal(
    Core.inferFilename("https://example.com/fallback.bin", [
      { name: "Content-Disposition", value: "attachment; filename*=UTF-8''sales%20report.xlsx" }
    ]),
    "sales report.xlsx"
  );

  assert.equal(
    Core.inferFilename("https://example.com/files/archive.zip?download=1", []),
    "archive.zip"
  );

  assert.equal(Core.inferFilename("not a url", []), "not a url");
});

test("infers filename from URL before optional browser download metadata", () => {
  assert.equal(
    Core.inferFilename(
      "https://example.com/files/url-name.zip",
      [],
      { filename: "metadata-name.zip" }
    ),
    "url-name.zip"
  );

  assert.equal(
    Core.inferFilename(
      "https://example.com/",
      [],
      { filename: "metadata-name.zip" }
    ),
    "metadata-name.zip"
  );
});

test("decodes form and raw request bodies", () => {
  assert.deepEqual(
    Core.decodeRequestBody({
      formData: {
        project_id: ["123"],
        type: ["zip"]
      }
    }),
    { body: "project_id=123&type=zip", type: "formData", truncated: false }
  );

  const raw = Buffer.from(JSON.stringify({ id: 123, type: "xlsx" }));
  assert.deepEqual(
    Core.decodeRequestBody({
      raw: [{ bytes: raw }]
    }),
    { body: '{"id":123,"type":"xlsx"}', type: "raw", truncated: false }
  );
});

test("builds Linux/macOS curl with headers, body, filename, and shell quoting", () => {
  const record = Core.createCaptureRecord({
    url: "https://example.com/export?name=Bob's",
    method: "POST",
    requestHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Cookie", value: "session=abc'123" },
      { name: "User-Agent", value: "Mozilla/5.0" }
    ],
    responseHeaders: [{ name: "Content-Disposition", value: 'attachment; filename="export report.xlsx"' }],
    requestBody: { body: '{"name":"Bob\'s file","path":"C:\\\\tmp"}', type: "raw", truncated: false },
    statusCode: 200
  });

  assert.match(record.curl, /^curl 'https:\/\/example\.com\/export\?name=Bob'\\''s'/);
  assert.match(record.curl, /-X POST/);
  assert.match(record.curl, /-H 'cookie: session=abc'\\''123'/);
  assert.match(record.curl, /--data-raw '\{"name":"Bob'\\''s file","path":"C:\\\\tmp"\}'/);
  assert.match(record.curl, /-o 'export report\.xlsx'$/);
});

test("reports important headers that the browser did not expose", () => {
  const exposure = Core.buildHeaderExposure([{ name: "Cookie", value: "session=abc" }]);
  const cookie = exposure.find((header) => header.name === "cookie");
  const authorization = exposure.find((header) => header.name === "authorization");

  assert.deepEqual(cookie, { name: "cookie", value: "session=abc", exposed: true });
  assert.deepEqual(authorization, {
    name: "authorization",
    value: "Not exposed by browser",
    exposed: false
  });
});
