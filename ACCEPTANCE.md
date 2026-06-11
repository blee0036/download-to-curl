# 验收清单

本文用于对照 `REQUIREMENT.md` 做最终验收。自动化能证明的项目已经列出对应命令；必须依赖 Chrome 策略安装环境的项目单独列出。

## 已由自动化覆盖

运行：

```sh
npm test
```

覆盖内容：

- 默认关闭时不拦截下载。
- 命中下载规则时在 `onHeadersReceived` 返回 `{ cancel: true }`。
- `onBeforeRequest` 捕获 URL、method、requestBody。
- `onBeforeSendHeaders` 捕获初始请求头。
- `onSendHeaders` 捕获最终可见请求头，并优先用于 curl。
- Cookie、Authorization、Referer、User-Agent 等已暴露请求头会写入 curl。
- 未暴露的重要请求头在详情数据中标记为 `Not exposed by Chrome`。
- GET 下载生成 URL、headers、filename。
- POST raw body 生成 `--data-raw`。
- POST formData 转为 URL encoded body 并生成 `--data-raw`。
- 文件名优先级为 `Content-Disposition`、URL path、Chrome download metadata、`download.bin`。
- curl 单引号、反斜杠、JSON body、form body 转义。
- 第一次捕获会创建结果页签。
- 已有结果页签会聚焦，不重复打开。
- 存储的旧结果页签失效时会重新打开。
- 多次捕获时最新记录在最上方。
- 最近记录最多保留 20 条。
- manifest 声明必需权限和入口。

运行：

```sh
npm run stage
```

覆盖内容：

- 生成 `dist/extension` 暂存运行时目录。
- 暂存目录只包含扩展运行所需文件，不包含测试、工具脚本和文档。

运行：

```sh
npm run make:update -- --id <extension_id> --crx-url <crx_url> --out dist/update.xml
```

覆盖内容：

- 生成 Chrome 更新清单 `update.xml`。
- `update.xml` 中的 app id 和 CRX 下载地址来自传入参数。

运行：

```sh
python -c "import yaml; yaml.safe_load(open('../.github/workflows/package-extension.yml', encoding='utf-8')); print('yaml ok')"
```

覆盖内容：

- GitHub Actions 工作流 YAML 语法可解析。

## 本地 fixture 覆盖

运行：

```sh
npm run integration:server
```

fixture 提供：

- `GET /download/get.zip`：附件响应，文件名 `integration-get.zip`。
- `POST /download/post.xlsx`：form 表单附件响应，文件名 `integration-post.xlsx`。
- `POST /download/post-json.xlsx`：JSON body 附件响应，带 Authorization 请求头，文件名 `integration-post-json.xlsx`。
- `GET /update.xml`：本地更新清单端点。

可用命令检查端点：

```powershell
$p = Start-Process -FilePath node -ArgumentList 'tools/integration-server.mjs' -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 1
  Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/download/get.zip'
  Invoke-WebRequest -UseBasicParsing -Method Post -Body 'project_id=123&type=xlsx' -ContentType 'application/x-www-form-urlencoded' 'http://127.0.0.1:8765/download/post.xlsx'
  Invoke-WebRequest -UseBasicParsing -Method Post -Body '{"project_id":123,"type":"xlsx"}' -ContentType 'application/json' -Headers @{ Authorization = 'Bearer integration-token' } 'http://127.0.0.1:8765/download/post-json.xlsx'
} finally {
  Stop-Process -Id $p.Id -Force
}
```

## 必须在策略安装 Chrome 中验收

以下项目不能仅靠 Node.js 测试证明，必须用 policy-installed extension 的 Chrome 实例验证：

- Chrome 显示扩展由策略安装。
- `webRequestBlocking` 在策略安装下可稳定取消下载响应。
- Capture Downloads 为 OFF 时，Chrome 原生下载完整保留。
- Capture Downloads 为 ON 时，GET 附件不进入 Chrome 默认下载流程。
- Capture Downloads 为 ON 时，POST form 附件不进入 Chrome 默认下载流程。
- Capture Downloads 为 ON 时，POST JSON + Authorization 文件流被捕获。
- `capture.html` 自动打开或聚焦。
- 页面展示最新记录、请求头状态和详情。
- Copy curl 写入系统剪贴板。
- 复制出的 curl 可在 Linux/macOS shell 中执行。
- Chrome 重启后开关状态保留。

## GitHub Actions 验收

首次配置：

- 仓库密钥 `CHROME_EXTENSION_PRIVATE_KEY_B64` 已配置。
- 如不使用 GitHub 发布页稳定地址，仓库变量 `DOWNLOAD_TO_CURL_CRX_URL` 已配置。

触发工作流后确认：

- `运行自动化测试` 步骤通过。
- `打包 CRX` 步骤生成 `download-to-curl.crx`。
- `生成扩展 ID 和 update.xml` 步骤生成 `update.xml`。
- artifact 中包含 `download-to-curl.crx`、`update.xml`、`package-info.txt`。
- 标签触发时，GitHub 发布页包含同样三个文件。

## 策略安装值

最终策略值格式：

```text
<extension_id>;<update_xml_url>
```

例如：

```text
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;https://github.com/<owner>/<repo>/releases/latest/download/update.xml
```

如果仓库是私有仓库，建议把 `download-to-curl.crx` 和 `update.xml` 发布到无需登录即可访问的 HTTPS 静态文件服务。
