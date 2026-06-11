(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DownloadToCurlCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var BLOCKED_TYPES = new Set([
    "image",
    "script",
    "stylesheet",
    "font",
    "media",
    "websocket",
    "ping",
    "csp_report"
  ]);

  var DOWNLOAD_CONTENT_TYPES = [
    "application/octet-stream",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/pdf",
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/x-msdownload",
    "application/x-apple-diskimage",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar"
  ];

  var DOWNLOAD_EXTENSIONS = [
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".pdf",
    ".csv",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".dmg",
    ".pkg",
    ".exe",
    ".msi",
    ".bin",
    ".iso"
  ];

  var IMPORTANT_HEADERS = [
    "cookie",
    "authorization",
    "proxy-authorization",
    "referer",
    "user-agent",
    "accept",
    "accept-language",
    "accept-encoding",
    "content-type",
    "origin",
    "range"
  ];

  function normalizeHeaders(headers) {
    if (!Array.isArray(headers)) {
      return [];
    }

    return headers
      .filter(function (header) {
        return header && typeof header.name === "string";
      })
      .map(function (header) {
        return {
          name: header.name,
          value: header.value == null ? "" : String(header.value)
        };
      });
  }

  function headerMap(headers) {
    return normalizeHeaders(headers).reduce(function (acc, header) {
      var key = header.name.toLowerCase();
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(header.value);
      return acc;
    }, {});
  }

  function getHeader(headers, name) {
    var values = headerMap(headers)[String(name).toLowerCase()];
    return values && values.length ? values[0] : "";
  }

  function hasHeader(headers, name) {
    return Object.prototype.hasOwnProperty.call(headerMap(headers), String(name).toLowerCase());
  }

  function contentTypeBase(value) {
    return String(value || "").split(";")[0].trim().toLowerCase();
  }

  function parseContentDispositionFilename(value) {
    if (!value) {
      return "";
    }

    var parts = splitHeaderParameters(value);
    var filenameStar = "";
    var filename = "";

    for (var i = 1; i < parts.length; i += 1) {
      var eqIndex = parts[i].indexOf("=");
      if (eqIndex === -1) {
        continue;
      }
      var key = parts[i].slice(0, eqIndex).trim().toLowerCase();
      var rawValue = parts[i].slice(eqIndex + 1).trim();
      var unquoted = stripQuotes(rawValue);
      if (key === "filename*") {
        filenameStar = decodeRfc5987Value(unquoted);
      } else if (key === "filename") {
        filename = unquoted;
      }
    }

    return sanitizeFilename(filenameStar || filename);
  }

  function splitHeaderParameters(value) {
    var result = [];
    var current = "";
    var quote = false;
    var escape = false;

    for (var i = 0; i < value.length; i += 1) {
      var char = value[i];
      if (escape) {
        current += char;
        escape = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escape = true;
        continue;
      }
      if (char === '"') {
        quote = !quote;
        current += char;
        continue;
      }
      if (char === ";" && !quote) {
        result.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    if (current) {
      result.push(current.trim());
    }

    return result;
  }

  function stripQuotes(value) {
    var output = String(value || "").trim();
    if (output.length >= 2 && output[0] === '"' && output[output.length - 1] === '"') {
      output = output.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return output;
  }

  function decodeRfc5987Value(value) {
    var match = String(value || "").match(/^([^']*)'[^']*'(.*)$/);
    if (!match) {
      return safeDecodeURIComponent(value);
    }

    var charset = match[1].toLowerCase();
    var encoded = match[2];
    if (charset && charset !== "utf-8" && charset !== "iso-8859-1") {
      return safeDecodeURIComponent(encoded);
    }
    return safeDecodeURIComponent(encoded);
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (error) {
      return String(value || "");
    }
  }

  function inferFilename(url, responseHeaders, downloadMetadata) {
    var dispositionName = parseContentDispositionFilename(getHeader(responseHeaders, "content-disposition"));
    if (dispositionName) {
      return dispositionName;
    }

    var urlName = filenameFromUrl(url);
    if (urlName) {
      return urlName;
    }

    if (downloadMetadata && downloadMetadata.filename) {
      var metadataName = sanitizeFilename(downloadMetadata.filename);
      if (metadataName) {
        return metadataName;
      }
    }

    return "download.bin";
  }

  function filenameFromUrl(url) {
    try {
      var parsed = new URL(url);
      var path = parsed.pathname || "";
      var lastSegment = path.split("/").filter(Boolean).pop() || "";
      return sanitizeFilename(safeDecodeURIComponent(lastSegment));
    } catch (error) {
      var fallback = String(url || "").split("?")[0].split("#")[0].split("/").pop();
      return sanitizeFilename(safeDecodeURIComponent(fallback));
    }
  }

  function sanitizeFilename(value) {
    var output = String(value || "")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .replace(/[\x00-\x1f\x7f]/g, "")
      .trim();

    if (output === "." || output === "..") {
      return "";
    }
    return output;
  }

  function isDownloadResponse(input) {
    var details = input || {};
    var type = details.type || "";
    if (BLOCKED_TYPES.has(type)) {
      return { matched: false, reason: "blocked-resource-type" };
    }

    var responseHeaders = normalizeHeaders(details.responseHeaders);
    var disposition = getHeader(responseHeaders, "content-disposition").toLowerCase();
    if (disposition.indexOf("attachment") !== -1) {
      return { matched: true, reason: "content-disposition-attachment" };
    }
    if (disposition.indexOf("filename") !== -1) {
      return { matched: true, reason: "content-disposition-filename" };
    }

    var contentType = contentTypeBase(getHeader(responseHeaders, "content-type"));
    if (DOWNLOAD_CONTENT_TYPES.indexOf(contentType) !== -1) {
      return { matched: true, reason: "content-type-" + contentType };
    }

    if (matchesDownloadExtension(details.url)) {
      return { matched: true, reason: "url-extension" };
    }

    if (matchesCustomRules(details.url, responseHeaders, details.customRules || [])) {
      return { matched: true, reason: "custom-rule" };
    }

    return { matched: false, reason: "no-rule" };
  }

  function matchesDownloadExtension(url) {
    var pathname = "";
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch (error) {
      pathname = String(url || "").split("?")[0].split("#")[0].toLowerCase();
    }

    return DOWNLOAD_EXTENSIONS.some(function (extension) {
      return pathname.endsWith(extension);
    });
  }

  function matchesCustomRules(url, responseHeaders, rules) {
    if (!Array.isArray(rules) || !rules.length) {
      return false;
    }

    var target = [
      String(url || ""),
      normalizeHeaders(responseHeaders)
        .map(function (header) {
          return header.name + ": " + header.value;
        })
        .join("\n")
    ].join("\n");

    return rules.some(function (rule) {
      var text = typeof rule === "string" ? rule : rule && rule.pattern;
      if (!text) {
        return false;
      }
      text = String(text).trim();
      if (!text || text[0] === "#") {
        return false;
      }

      var regexMatch = text.match(/^\/(.+)\/([gimsuy]*)$/);
      if (regexMatch) {
        try {
          return new RegExp(regexMatch[1], regexMatch[2]).test(target);
        } catch (error) {
          return false;
        }
      }

      if (text.indexOf("*") !== -1) {
        var escaped = text.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
        return new RegExp(escaped, "i").test(target);
      }

      return target.toLowerCase().indexOf(text.toLowerCase()) !== -1;
    });
  }

  function decodeRequestBody(requestBody) {
    if (!requestBody) {
      return { body: "", type: "none", truncated: false };
    }

    if (requestBody.formData && typeof requestBody.formData === "object") {
      var params = [];
      Object.keys(requestBody.formData).forEach(function (key) {
        var values = Array.isArray(requestBody.formData[key])
          ? requestBody.formData[key]
          : [requestBody.formData[key]];
        values.forEach(function (value) {
          params.push(encodeURIComponent(key) + "=" + encodeURIComponent(value == null ? "" : String(value)));
        });
      });
      return { body: params.join("&"), type: "formData", truncated: false };
    }

    if (Array.isArray(requestBody.raw)) {
      var body = requestBody.raw
        .map(function (entry) {
          return decodeBytes(entry && entry.bytes);
        })
        .join("");
      return { body: body, type: "raw", truncated: false };
    }

    if (requestBody.error) {
      return { body: "", type: "error", error: requestBody.error, truncated: true };
    }

    return { body: "", type: "unknown", truncated: false };
  }

  function decodeBytes(bytes) {
    if (!bytes) {
      return "";
    }

    var view;
    if (bytes instanceof ArrayBuffer) {
      view = new Uint8Array(bytes);
    } else if (ArrayBuffer.isView(bytes)) {
      view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } else if (Array.isArray(bytes)) {
      view = new Uint8Array(bytes);
    } else if (bytes && typeof bytes === "object" && Array.isArray(bytes.data)) {
      view = new Uint8Array(bytes.data);
    } else {
      return String(bytes);
    }

    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(view);
    }

    var output = "";
    for (var i = 0; i < view.length; i += 1) {
      output += String.fromCharCode(view[i]);
    }
    try {
      return decodeURIComponent(escape(output));
    } catch (error) {
      return output;
    }
  }

  function buildCurlCommand(record) {
    var lines = ["curl " + shellQuote(record.url || "")];
    var method = String(record.method || "GET").toUpperCase();
    if (method && method !== "GET") {
      lines.push("  -X " + method);
    }

    normalizeHeaders(record.requestHeaders).forEach(function (header) {
      lines.push("  -H " + shellQuote(header.name.toLowerCase() + ": " + header.value));
    });

    var body = record.requestBody && typeof record.requestBody.body === "string"
      ? record.requestBody.body
      : "";
    if (body) {
      lines.push("  --data-raw " + shellQuote(body));
    }

    lines.push("  -o " + shellQuote(record.filename || "download.bin"));
    return lines.join(" \\\n");
  }

  function shellQuote(value) {
    var text = String(value == null ? "" : value);
    if (text === "") {
      return "''";
    }
    return "'" + text.replace(/'/g, "'\\''") + "'";
  }

  function buildHeaderExposure(headers) {
    var normalized = normalizeHeaders(headers);
    return IMPORTANT_HEADERS.map(function (name) {
      return {
        name: name,
        value: hasHeader(normalized, name) ? getHeader(normalized, name) : "Not exposed by Chrome",
        exposed: hasHeader(normalized, name)
      };
    });
  }

  function classifyHeaderStatus(headers) {
    var normalized = normalizeHeaders(headers);
    if (!normalized.length) {
      return "Not exposed by Chrome";
    }

    var hasAnyImportant = IMPORTANT_HEADERS.some(function (name) {
      return hasHeader(normalized, name);
    });
    return hasAnyImportant ? "Headers captured" : "Partial headers";
  }

  function createCaptureRecord(input) {
    var details = input || {};
    var requestHeaders = normalizeHeaders(details.requestHeaders);
    var responseHeaders = normalizeHeaders(details.responseHeaders);
    var filename = inferFilename(details.url, responseHeaders, details.downloadMetadata);
    var requestBody = details.requestBody || { body: "", type: "none", truncated: false };
    var record = {
      id: details.id || makeRecordId(details.timeStamp),
      url: details.url || "",
      method: String(details.method || "GET").toUpperCase(),
      requestHeaders: requestHeaders,
      responseHeaders: responseHeaders,
      requestBody: requestBody,
      tabId: typeof details.tabId === "number" ? details.tabId : -1,
      initiator: details.initiator || details.originUrl || "",
      type: details.type || "",
      timeStamp: details.timeStamp || Date.now(),
      capturedAt: new Date(details.timeStamp || Date.now()).toISOString(),
      filename: filename,
      statusCode: details.statusCode || 0,
      interceptStatus: details.interceptStatus || "Intercepted",
      matchReason: details.matchReason || "",
      requestHeaderSource: details.requestHeaderSource || "none",
      headerStatus: classifyHeaderStatus(requestHeaders),
      importantHeaders: buildHeaderExposure(requestHeaders)
    };
    record.curl = buildCurlCommand(record);
    return record;
  }

  function makeRecordId(timeStamp) {
    var random = Math.random().toString(36).slice(2, 10);
    return String(Math.floor(timeStamp || Date.now())) + "-" + random;
  }

  function parseCustomRules(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line && line[0] !== "#";
      });
  }

  return {
    IMPORTANT_HEADERS: IMPORTANT_HEADERS.slice(),
    buildCurlCommand: buildCurlCommand,
    buildHeaderExposure: buildHeaderExposure,
    classifyHeaderStatus: classifyHeaderStatus,
    createCaptureRecord: createCaptureRecord,
    decodeRequestBody: decodeRequestBody,
    inferFilename: inferFilename,
    isDownloadResponse: isDownloadResponse,
    matchesCustomRules: matchesCustomRules,
    parseContentDispositionFilename: parseContentDispositionFilename,
    parseCustomRules: parseCustomRules,
    shellQuote: shellQuote
  };
});
