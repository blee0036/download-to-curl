const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("background lifecycle captures POST download, cancels it, stores record, and reuses result tab", async () => {
  const harness = createBackgroundHarness({
    captureEnabled: true,
    records: [],
    resultTabId: null,
    customRules: []
  });

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-1",
    url: "https://example.com/api/export",
    method: "POST",
    type: "xmlhttprequest",
    tabId: 7,
    initiator: "https://example.com",
    timeStamp: 1000,
    requestBody: { raw: [{ bytes: Buffer.from('{"id":123,"type":"xlsx"}') }] }
  });

  emit(harness.events.webRequest.onBeforeSendHeaders, {
    requestId: "req-1",
    url: "https://example.com/api/export",
    method: "POST",
    requestHeaders: [
      { name: "Cookie", value: "session=old" },
      { name: "User-Agent", value: "TestBrowser/1.0" }
    ]
  });

  emit(harness.events.webRequest.onSendHeaders, {
    requestId: "req-1",
    url: "https://example.com/api/export",
    method: "POST",
    requestHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Cookie", value: "session=abc123" },
      { name: "Authorization", value: "Bearer token" },
      { name: "Referer", value: "https://example.com/app" }
    ]
  });

  const result = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-1",
    url: "https://example.com/api/export",
    method: "POST",
    type: "xmlhttprequest",
    tabId: 7,
    initiator: "https://example.com",
    timeStamp: 1100,
    statusCode: 200,
    responseHeaders: [
      { name: "Content-Type", value: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { name: "Content-Disposition", value: 'attachment; filename="export.xlsx"' }
    ]
  });

  assert.equal(result.cancel, true);
  assert.deepEqual(Object.keys(result), ["cancel"]);
  assert.equal(harness.storage.records.length, 1);
  assert.equal(harness.storage.records[0].filename, "export.xlsx");
  assert.equal(harness.storage.records[0].requestHeaderSource, "onSendHeaders");
  assert.match(harness.storage.records[0].curl, /-X POST/);
  assert.match(harness.storage.records[0].curl, /-H 'authorization: Bearer token'/);
  assert.match(harness.storage.records[0].curl, /--data-raw '\{"id":123,"type":"xlsx"\}'/);
  assert.equal(harness.tabs.created.length, 1);

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-2",
    url: "https://example.com/files/archive.zip",
    method: "GET",
    type: "main_frame",
    tabId: 7,
    timeStamp: 2000
  });

  const secondResult = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-2",
    url: "https://example.com/files/archive.zip",
    method: "GET",
    type: "main_frame",
    tabId: 7,
    timeStamp: 2100,
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }]
  });

  assert.equal(secondResult.cancel, true);
  assert.deepEqual(Object.keys(secondResult), ["cancel"]);
  assert.equal(harness.storage.records.length, 2);
  assert.equal(harness.storage.records[0].filename, "archive.zip");
  assert.equal(harness.tabs.created.length, 1);
  assert.equal(harness.tabs.updated.length, 1);
});

test("background does nothing while capture toggle is off", () => {
  const harness = createBackgroundHarness({
    captureEnabled: false,
    records: [],
    resultTabId: null,
    customRules: []
  });

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-off",
    url: "https://example.com/file.zip",
    method: "GET",
    type: "main_frame",
    timeStamp: 100
  });

  const result = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-off",
    url: "https://example.com/file.zip",
    method: "GET",
    type: "main_frame",
    timeStamp: 110,
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }]
  });

  assert.equal(Object.keys(result).length, 0);
  assert.equal(harness.storage.records.length, 0);
  assert.equal(harness.tabs.created.length, 0);
});

test("background falls back to onBeforeSendHeaders and reopens result tab when stored tab is gone", () => {
  const harness = createBackgroundHarness({
    captureEnabled: true,
    records: [],
    resultTabId: 404,
    customRules: []
  });

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-fallback",
    url: "https://example.com/export/form.csv",
    method: "POST",
    type: "xmlhttprequest",
    tabId: 5,
    timeStamp: 3000,
    requestBody: {
      formData: {
        project_id: ["123"],
        type: ["csv"]
      }
    }
  });

  emit(harness.events.webRequest.onBeforeSendHeaders, {
    requestId: "req-fallback",
    url: "https://example.com/export/form.csv",
    method: "POST",
    requestHeaders: [
      { name: "Content-Type", value: "application/x-www-form-urlencoded" },
      { name: "Cookie", value: "session=form" },
      { name: "Referer", value: "https://example.com/app" }
    ]
  });

  const result = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-fallback",
    url: "https://example.com/export/form.csv",
    method: "POST",
    type: "xmlhttprequest",
    tabId: 5,
    timeStamp: 3100,
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "text/csv" }]
  });

  assert.equal(result.cancel, true);
  assert.equal(harness.storage.records[0].requestHeaderSource, "onBeforeSendHeaders");
  assert.match(harness.storage.records[0].curl, /--data-raw 'project_id=123&type=csv'/);
  assert.equal(harness.tabs.created.length, 1);
});

test("background keeps only the newest twenty records", () => {
  const existingRecords = Array.from({ length: 20 }, (_, index) => ({
    id: `old-${index}`,
    filename: `old-${index}.zip`
  }));
  const harness = createBackgroundHarness({
    captureEnabled: true,
    records: existingRecords,
    resultTabId: null,
    customRules: []
  });

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-newest",
    url: "https://example.com/newest.zip",
    method: "GET",
    type: "main_frame",
    tabId: 1,
    timeStamp: 4000
  });

  const result = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-newest",
    url: "https://example.com/newest.zip",
    method: "GET",
    type: "main_frame",
    tabId: 1,
    timeStamp: 4100,
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/octet-stream" }]
  });

  assert.equal(result.cancel, true);
  assert.equal(harness.storage.records.length, 20);
  assert.equal(harness.storage.records[0].filename, "newest.zip");
  assert.equal(harness.storage.records.some((record) => record.id === "old-19"), false);
});

test("background finds an existing capture page tab before creating a new one", () => {
  const harness = createBackgroundHarness({
    captureEnabled: true,
    records: [],
    resultTabId: null,
    customRules: []
  });
  harness.tabs.queryResults = [
    { id: 55, windowId: 88, url: "moz-extension://test/capture.html#latest" }
  ];

  emit(harness.events.webRequest.onBeforeRequest, {
    requestId: "req-existing-tab",
    url: "https://example.com/existing.pdf",
    method: "GET",
    type: "main_frame",
    tabId: 2,
    timeStamp: 5000
  });

  const result = emit(harness.events.webRequest.onHeadersReceived, {
    requestId: "req-existing-tab",
    url: "https://example.com/existing.pdf",
    method: "GET",
    type: "main_frame",
    tabId: 2,
    timeStamp: 5100,
    statusCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/pdf" }]
  });

  assert.equal(result.cancel, true);
  assert.equal(Object.keys(harness.tabs.queried[0]).length, 0);
  assert.equal(harness.tabs.created.length, 0);
  assert.equal(harness.tabs.updated[0].id, 55);
  assert.equal(harness.tabs.updated[0].updateInfo.active, true);
  assert.equal(harness.storage.resultTabId, 55);
});

function createBackgroundHarness(initialStorage) {
  const events = {
    action: { onClicked: createEvent() },
    runtime: { onMessage: createEvent() },
    storage: { onChanged: createEvent() },
    webRequest: {
      onBeforeRequest: createEvent(),
      onBeforeSendHeaders: createEvent(),
      onSendHeaders: createEvent(),
      onHeadersReceived: createEvent(),
      onErrorOccurred: createEvent()
    }
  };

  const storage = { ...initialStorage };
  const tabs = {
    created: [],
    queryResults: [],
    updated: [],
    queried: []
  };

  const chrome = {
    action: events.action,
    runtime: {
      onMessage: events.runtime.onMessage,
      getURL(resource) {
        return `moz-extension://test/${resource}`;
      },
      lastError: null
    },
    storage: {
      onChanged: events.storage.onChanged,
      local: {
        get(defaults, callback) {
          callback({ ...defaults, ...storage });
        },
        set(items, callback) {
          const changes = {};
          Object.keys(items).forEach((key) => {
            changes[key] = { oldValue: storage[key], newValue: items[key] };
            storage[key] = items[key];
          });
          events.storage.onChanged.listeners.forEach((listener) => listener(changes, "local"));
          if (callback) callback();
        }
      }
    },
    tabs: {
      get(id, callback) {
        const tab = tabs.created.find((item) => item.id === id) || null;
        callback(tab);
      },
      query(queryInfo, callback) {
        tabs.queried.push(queryInfo);
        callback(tabs.queryResults);
      },
      create(createInfo, callback) {
        const tab = { id: 100 + tabs.created.length, windowId: 200, ...createInfo };
        tabs.created.push(tab);
        callback(tab);
      },
      update(id, updateInfo, callback) {
        tabs.updated.push({ id, updateInfo });
        const tab = tabs.created.find((item) => item.id === id) || { id, windowId: 200 };
        if (callback) callback(tab);
      }
    },
    windows: {
      update() {}
    },
    webRequest: events.webRequest
  };

  const context = {
    chrome,
    self: {},
    setTimeout() {},
    URL,
    TextDecoder,
    ArrayBuffer,
    Uint8Array,
    Buffer,
    console,
    importScripts(...scripts) {
      scripts.forEach((script) => {
        const scriptPath = path.join(__dirname, "..", script);
        vm.runInContext(fs.readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
      });
    }
  };
  context.globalThis = context;
  vm.createContext(context);

  const backgroundPath = path.join(__dirname, "..", "background.js");
  vm.runInContext(fs.readFileSync(backgroundPath, "utf8"), context, { filename: backgroundPath });

  return { events, storage, tabs };
}

function createEvent() {
  return {
    listeners: [],
    addListener(listener) {
      this.listeners.push(listener);
    }
  };
}

function emit(event, details) {
  assert.equal(event.listeners.length, 1);
  return event.listeners[0](details);
}
