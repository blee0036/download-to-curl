(function () {
  "use strict";

  var Core = window.DownloadToCurlCore;
  var recordsNode = document.getElementById("records");
  var emptyState = document.getElementById("emptyState");
  var recordCount = document.getElementById("recordCount");
  var captureToggle = document.getElementById("captureToggle");
  var clearRecords = document.getElementById("clearRecords");
  var customRules = document.getElementById("customRules");
  var saveRules = document.getElementById("saveRules");
  var rulesStatus = document.getElementById("rulesStatus");
  var recordTemplate = document.getElementById("recordTemplate");
  var state = {
    captureEnabled: false,
    records: [],
    customRules: []
  };

  chrome.runtime.sendMessage({ type: "getState" }, function (response) {
    if (chrome.runtime.lastError) {
      render();
      return;
    }
    state.captureEnabled = Boolean(response && response.captureEnabled);
    state.records = Array.isArray(response && response.records) ? response.records : [];
    state.customRules = Array.isArray(response && response.customRules) ? response.customRules : [];
    render();
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== "local") {
      return;
    }
    if (changes.captureEnabled) {
      state.captureEnabled = Boolean(changes.captureEnabled.newValue);
    }
    if (changes.records) {
      state.records = Array.isArray(changes.records.newValue) ? changes.records.newValue : [];
    }
    if (changes.customRules) {
      state.customRules = Array.isArray(changes.customRules.newValue) ? changes.customRules.newValue : [];
    }
    render();
  });

  captureToggle.addEventListener("change", function () {
    chrome.runtime.sendMessage({
      type: "setCaptureEnabled",
      captureEnabled: captureToggle.checked
    });
  });

  clearRecords.addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "clearRecords" });
  });

  saveRules.addEventListener("click", function () {
    var parsedRules = Core.parseCustomRules(customRules.value);
    chrome.runtime.sendMessage(
      { type: "saveCustomRules", customRules: parsedRules },
      function () {
        rulesStatus.textContent = "Saved";
        setTimeout(function () {
          rulesStatus.textContent = "";
        }, 1500);
      }
    );
  });

  function render() {
    captureToggle.checked = state.captureEnabled;
    customRules.value = (state.customRules || []).join("\n");
    recordCount.textContent = String((state.records || []).length);
    emptyState.hidden = Boolean(state.records && state.records.length);
    recordsNode.textContent = "";

    (state.records || []).forEach(function (record) {
      recordsNode.appendChild(renderRecord(record));
    });
  }

  function renderRecord(record) {
    var node = recordTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".recordTitle").textContent = record.filename || "download.bin";
    node.querySelector(".recordUrl").textContent = (record.method || "GET") + " " + (record.url || "");
    node.querySelector(".metaLine").textContent = [
      formatDate(record.capturedAt || record.timeStamp),
      "status " + (record.statusCode || "unknown"),
      "source " + (record.requestHeaderSource || "none")
    ].join(" | ");

    var badges = node.querySelector(".badges");
    [
      record.interceptStatus || "Intercepted",
      record.headerStatus || "Not exposed by Chrome",
      record.matchReason || "matched"
    ].forEach(function (label) {
      var badge = document.createElement("span");
      badge.textContent = label;
      badges.appendChild(badge);
    });

    var details = node.querySelector(".details");
    var toggleDetails = node.querySelector(".toggleDetails");
    toggleDetails.addEventListener("click", function () {
      details.hidden = !details.hidden;
      toggleDetails.textContent = details.hidden ? "Show details" : "Hide details";
    });

    var copyButton = node.querySelector(".copyCurl");
    copyButton.addEventListener("click", function () {
      copyText(record.curl || "").then(function () {
        copyButton.textContent = "Copied";
        setTimeout(function () {
          copyButton.textContent = "Copy curl";
        }, 1400);
      });
    });

    node.querySelector(".curlOutput").value = record.curl || "";
    node.querySelector(".requestBody").textContent = formatRequestBody(record.requestBody);
    node.querySelector(".requestHeaders").textContent = formatHeaders(record.requestHeaders);
    node.querySelector(".responseHeaders").textContent = formatHeaders(record.responseHeaders);
    node.querySelector(".metadata").textContent = JSON.stringify(
      {
        id: record.id,
        tabId: record.tabId,
        initiator: record.initiator,
        type: record.type,
        timeStamp: record.timeStamp,
        matchReason: record.matchReason,
        interceptStatus: record.interceptStatus
      },
      null,
      2
    );
    renderImportantHeaders(node.querySelector(".importantHeaders"), record.importantHeaders || []);

    return node;
  }

  function renderImportantHeaders(table, headers) {
    table.textContent = "";
    headers.forEach(function (header) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      var value = document.createElement("td");
      name.textContent = header.name;
      value.textContent = header.value;
      if (!header.exposed) {
        value.className = "missing";
      }
      row.appendChild(name);
      row.appendChild(value);
      table.appendChild(row);
    });
  }

  function formatHeaders(headers) {
    if (!Array.isArray(headers) || !headers.length) {
      return "Not exposed by Chrome";
    }
    return headers
      .map(function (header) {
        return header.name + ": " + (header.value == null ? "" : header.value);
      })
      .join("\n");
  }

  function formatRequestBody(requestBody) {
    if (!requestBody || !requestBody.body) {
      return "No request body captured";
    }
    return requestBody.body;
  }

  function formatDate(value) {
    var date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopyText(text);
      });
    }

    return fallbackCopyText(text);
  }

  function fallbackCopyText(text) {
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        textarea.remove();
      }
    });
  }
})();
