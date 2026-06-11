importScripts("lib/capture-core.js");

var Core = self.DownloadToCurlCore;

var STORAGE_KEYS = {
  captureEnabled: "captureEnabled",
  records: "records",
  resultTabId: "resultTabId",
  customRules: "customRules"
};

var DEFAULT_STATE = {
  captureEnabled: false,
  records: [],
  resultTabId: null,
  customRules: []
};

var state = Object.assign({}, DEFAULT_STATE);
var requestStore = new Map();
var capturePageUrl = chrome.runtime.getURL("capture.html");

chrome.storage.local.get(DEFAULT_STATE, function (items) {
  state.captureEnabled = Boolean(items.captureEnabled);
  state.records = Array.isArray(items.records) ? items.records : [];
  state.resultTabId = typeof items.resultTabId === "number" ? items.resultTabId : null;
  state.customRules = Array.isArray(items.customRules) ? items.customRules : [];
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  Object.keys(STORAGE_KEYS).forEach(function (key) {
    if (changes[key]) {
      state[key] = changes[key].newValue;
    }
  });
});

chrome.action.onClicked.addListener(function () {
  focusOrOpenCapturePage();
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "getState") {
    sendResponse({
      captureEnabled: state.captureEnabled,
      records: state.records,
      customRules: state.customRules
    });
    return false;
  }

  if (message.type === "setCaptureEnabled") {
    state.captureEnabled = Boolean(message.captureEnabled);
    chrome.storage.local.set({ captureEnabled: state.captureEnabled }, function () {
      sendResponse({ ok: true, captureEnabled: state.captureEnabled });
    });
    return true;
  }

  if (message.type === "clearRecords") {
    state.records = [];
    chrome.storage.local.set({ records: [] }, function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "saveCustomRules") {
    state.customRules = Array.isArray(message.customRules) ? message.customRules : [];
    chrome.storage.local.set({ customRules: state.customRules }, function () {
      sendResponse({ ok: true, customRules: state.customRules });
    });
    return true;
  }

  return false;
});

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (!state.captureEnabled) {
      return;
    }

    var entry = getOrCreateRequest(details.requestId);
    mergeDetails(entry, details);
    entry.requestBody = Core.decodeRequestBody(details.requestBody);
    scheduleCleanup(details.requestId);
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    if (!state.captureEnabled) {
      return;
    }

    var entry = getOrCreateRequest(details.requestId);
    mergeDetails(entry, details);
    entry.beforeSendHeaders = details.requestHeaders || [];
    scheduleCleanup(details.requestId);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onSendHeaders.addListener(
  function (details) {
    if (!state.captureEnabled) {
      return;
    }

    var entry = getOrCreateRequest(details.requestId);
    mergeDetails(entry, details);
    entry.sendHeaders = details.requestHeaders || [];
    scheduleCleanup(details.requestId);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (!state.captureEnabled) {
      return {};
    }

    var entry = getOrCreateRequest(details.requestId);
    mergeDetails(entry, details);
    entry.responseHeaders = details.responseHeaders || [];
    entry.statusCode = details.statusCode || 0;

    var match = Core.isDownloadResponse({
      url: entry.url,
      type: entry.type,
      responseHeaders: entry.responseHeaders,
      customRules: state.customRules
    });

    if (!match.matched) {
      scheduleCleanup(details.requestId);
      return {};
    }

    var headers = entry.sendHeaders || entry.beforeSendHeaders || [];
    var headerSource = entry.sendHeaders
      ? "onSendHeaders"
      : entry.beforeSendHeaders
        ? "onBeforeSendHeaders"
        : "none";

    var record = Core.createCaptureRecord({
      id: details.requestId + "-" + Date.now(),
      url: entry.url,
      method: entry.method,
      requestHeaders: headers,
      responseHeaders: entry.responseHeaders,
      requestBody: entry.requestBody || { body: "", type: "none", truncated: false },
      tabId: entry.tabId,
      initiator: entry.initiator,
      type: entry.type,
      timeStamp: details.timeStamp || Date.now(),
      statusCode: entry.statusCode,
      interceptStatus: "Intercepted",
      matchReason: match.reason,
      requestHeaderSource: headerSource
    });

    saveCaptureRecord(record);
    requestStore.delete(details.requestId);
    return { cancel: true };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders", "extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  function (details) {
    if (details && details.requestId) {
      requestStore.delete(details.requestId);
    }
  },
  { urls: ["<all_urls>"] }
);

function getOrCreateRequest(requestId) {
  if (!requestStore.has(requestId)) {
    requestStore.set(requestId, {});
  }
  return requestStore.get(requestId);
}

function mergeDetails(entry, details) {
  [
    "url",
    "method",
    "tabId",
    "initiator",
    "originUrl",
    "type",
    "timeStamp",
    "requestId"
  ].forEach(function (key) {
    if (details[key] !== undefined) {
      entry[key] = details[key];
    }
  });
}

function scheduleCleanup(requestId) {
  setTimeout(function () {
    requestStore.delete(requestId);
  }, 120000);
}

function saveCaptureRecord(record) {
  state.records = [record].concat(Array.isArray(state.records) ? state.records : []).slice(0, 20);
  chrome.storage.local.set({ records: state.records }, function () {
    focusOrOpenCapturePage();
  });
}

function focusOrOpenCapturePage() {
  if (typeof state.resultTabId === "number") {
    chrome.tabs.get(state.resultTabId, function (tab) {
      if (chrome.runtime.lastError || !tab) {
        findOrCreateCapturePage();
        return;
      }
      focusTab(tab);
    });
    return;
  }

  findOrCreateCapturePage();
}

function findOrCreateCapturePage() {
  chrome.tabs.query({}, function (tabs) {
    if (chrome.runtime.lastError) {
      createCapturePage();
      return;
    }

    var existingTab = (tabs || []).find(isCapturePageTab);
    if (existingTab) {
      state.resultTabId = existingTab.id;
      chrome.storage.local.set({ resultTabId: state.resultTabId });
      focusTab(existingTab);
      return;
    }

    createCapturePage();
  });
}

function createCapturePage() {
  chrome.tabs.create({ url: capturePageUrl, active: true }, function (tab) {
    if (tab && typeof tab.id === "number") {
      state.resultTabId = tab.id;
      chrome.storage.local.set({ resultTabId: tab.id });
    }
  });
}

function isCapturePageTab(tab) {
  if (!tab || typeof tab.url !== "string") {
    return false;
  }

  return tab.url.split("#")[0].split("?")[0] === capturePageUrl;
}

function focusTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    findOrCreateCapturePage();
    return;
  }

  chrome.tabs.update(tab.id, { active: true }, function () {
    if (tab.windowId !== undefined && chrome.windows && chrome.windows.update) {
      chrome.windows.update(tab.windowId, { focused: true });
    }
  });
}
