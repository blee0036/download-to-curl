import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "dist");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8765);

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "curl_capture_session=integration-cookie; Path=/; SameSite=Lax"
    });
    response.end(renderIndex());
    return;
  }

  if (url.pathname === "/download/get.zip") {
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="integration-get.zip"',
      "x-integration-download": "get"
    });
    response.end("PK\u0003\u0004 fake zip payload\n");
    return;
  }

  if (url.pathname === "/download/post.xlsx" && request.method === "POST") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="integration-post.xlsx"',
        "x-integration-download": "post",
        "x-request-body-size": String(Buffer.byteLength(body))
      });
      response.end("fake xlsx payload\n");
    });
    return;
  }

  if (url.pathname === "/download/post-json.xlsx" && request.method === "POST") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="integration-post-json.xlsx"',
        "x-integration-download": "post-json",
        "x-request-authorization": request.headers.authorization || "",
        "x-request-body-size": String(Buffer.byteLength(body))
      });
      response.end("fake authenticated xlsx payload\n");
    });
    return;
  }

  if (url.pathname === "/update.xml") {
    serveFile(join(distDir, "update.xml"), "application/xml; charset=utf-8", response);
    return;
  }

  if (url.pathname.endsWith(".crx")) {
    serveFile(join(distDir, basename(url.pathname)), "application/x-chrome-extension", response);
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found\n");
});

server.listen(port, host, () => {
  console.log(`Integration server: http://${host}:${port}/`);
  console.log(`Update manifest:    http://${host}:${port}/update.xml`);
  console.log(`CRX directory:      ${distDir}`);
});

function serveFile(filePath, contentType, response) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Missing ${filePath}\n`);
    return;
  }

  response.writeHead(200, {
    "content-type": contentType || guessContentType(filePath),
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

function guessContentType(filePath) {
  if (extname(filePath) === ".xml") {
    return "application/xml; charset=utf-8";
  }
  if (extname(filePath) === ".crx") {
    return "application/x-chrome-extension";
  }
  return "application/octet-stream";
}

function renderIndex() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Download to cURL Integration Fixture</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 40px; max-width: 760px; }
      button, a { display: inline-flex; align-items: center; min-height: 36px; margin: 8px 8px 8px 0; }
      form { margin-top: 18px; }
      textarea { width: 100%; min-height: 80px; }
    </style>
  </head>
  <body>
    <h1>Download to cURL Integration Fixture</h1>
    <p>This page sets a cookie, exposes one GET download, and exposes one POST download.</p>
    <a href="/download/get.zip">GET attachment download</a>
    <form method="post" action="/download/post.xlsx">
      <input name="project_id" value="123">
      <input name="type" value="xlsx">
      <textarea name="note">integration test</textarea>
      <button type="submit">POST attachment download</button>
    </form>
    <button id="post-json" type="button">POST JSON 附件下载（带 Authorization）</button>
    <pre id="result"></pre>
    <script>
      document.getElementById("post-json").addEventListener("click", async () => {
        const result = document.getElementById("result");
        result.textContent = "requesting";
        try {
          const response = await fetch("/download/post-json.xlsx", {
            method: "POST",
            headers: {
              "authorization": "Bearer integration-token",
              "content-type": "application/json"
            },
            body: JSON.stringify({ project_id: 123, type: "xlsx" })
          });
          result.textContent = "unexpected response " + response.status;
        } catch (error) {
          result.textContent = "request canceled or intercepted";
        }
      });
    </script>
  </body>
</html>`;
}
