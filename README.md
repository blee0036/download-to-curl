# Download to cURL Capture

本项目是一个本地自用 Chrome 扩展，用于在 Chrome 默认下载器接手前拦截匹配到的下载响应，并生成可在 Linux/macOS 终端执行的 `curl` 命令。

扩展只在本地浏览器配置文件中保存捕获记录，不上传数据、不执行远程下载、不修改网页内容、不修改响应内容。

## 本地构建与测试

扩展本身不需要构建，直接加载运行时文件即可。

```sh
cd download-to-curl
npm test
```

`npm test` 会运行以下检查：

- 下载识别规则。
- POST body 解码。
- 文件名推断。
- shell 单引号转义。
- curl 命令生成。
- 模拟 Chrome API 的 service worker 生命周期集成测试，验证 POST 下载会被捕获、取消、保存，并复用结果页签。

开发者模式只用于调试 UI 和基础逻辑，不作为最终验收方式。完整下载拦截必须通过 Chrome 策略安装验证。

更完整的逐项验收说明见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## GitHub Actions 打包

仓库已经提供工作流：

```text
.github/workflows/package-extension.yml
```

它会执行：

1. 检出代码。
2. 设置 Node.js 22。
3. 运行 `npm test`。
4. 运行 `npm run stage`，只把扩展运行时文件复制到 `dist/extension`。
5. 使用固定私钥打包 `download-to-curl.crx`。
6. 生成固定扩展 ID。
7. 生成 Chrome 更新清单：`update.xml`。
8. 上传 GitHub Actions 产物。
9. 如果是 `v*` 标签触发，自动把 `download-to-curl.crx`、`update.xml`、`package-info.txt` 发布到 GitHub 发布页。

### 必需仓库密钥

必须配置仓库密钥：

```text
CHROME_EXTENSION_PRIVATE_KEY_B64
```

这是扩展打包私钥的 Base64 内容。它必须长期保持不变，否则扩展 ID 会变化，Chrome 策略安装的扩展无法按原 ID 更新。

配置位置：

```text
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> Secrets
```

首次生成私钥可以使用：

```sh
openssl genrsa -out download-to-curl.pem 2048
```

把私钥转成 Base64 后写入 GitHub 仓库密钥。

Linux/macOS：

```sh
base64 -w0 download-to-curl.pem
```

Windows PowerShell：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("download-to-curl.pem"))
```

### 可选仓库变量

可以配置仓库变量：

```text
DOWNLOAD_TO_CURL_CRX_URL
```

它表示 `download-to-curl.crx` 最终对 Chrome 可访问的 HTTPS 下载地址，例如：

```text
https://example.com/extensions/download-to-curl.crx
```

配置位置：

```text
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> Variables
```

如果不配置这个变量，也可以在手动触发工作流时填写 `crx_url`。

如果用 `v*` 标签触发，并且没有填写 `crx_url`、也没有配置 `DOWNLOAD_TO_CURL_CRX_URL`，工作流会默认使用 GitHub 发布页资产地址：

```text
https://github.com/<owner>/<repo>/releases/latest/download/download-to-curl.crx
```

这会让 Chrome 策略使用稳定地址，不需要每次发布新标签后都修改策略。对应的 `update.xml` 地址是：

```text
https://github.com/<owner>/<repo>/releases/latest/download/update.xml
```

注意：Chrome 策略访问 `update.xml` 和 `.crx` 时不能带登录态。私有仓库的发布页资产通常不适合作为策略安装源，建议发布到公司内网或公开 HTTPS 静态文件服务。

### 手动触发

在 GitHub 页面进入：

```text
Actions -> 打包 Chrome 扩展 -> Run workflow
```

如果没有配置 `DOWNLOAD_TO_CURL_CRX_URL`，手动触发时需要填写 `crx_url`。

### 标签触发

推送 `v*` 标签会自动打包并发布到 GitHub 发布页：

```sh
git tag v0.1.0
git push origin v0.1.0
```

标签触发后，GitHub 发布页中会包含：

```text
download-to-curl.crx
update.xml
package-info.txt
```

`package-info.txt` 会记录扩展 ID 和 CRX URL。

每次需要让 Chrome 自动更新时，都要先提升 `manifest.json` 里的 `version`，再创建新的 `v*` 标签。Chrome 会根据 `update.xml` 中的版本号判断是否更新。

## 本地打包

如果需要在本机打包，先生成运行时目录：

```sh
npm run stage
```

然后使用 Chrome 打包：

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --pack-extension="$PWD\dist\extension"
```

Chrome 会在暂存运行时目录旁边生成 `.crx` 和 `.pem`。请保存 `.pem`，后续打包必须复用同一个私钥。

如果命令退出但没有生成 `.crx` 或 `.pem`，可以打开 `chrome://extensions`，使用 **Pack extension** 按钮，目标目录选择 `dist/extension`。

计算扩展 ID：

```sh
npm run extension:id -- path/to/download-to-curl.pem
```

生成更新清单：

```sh
npm run make:update -- --id <extension_id> --crx-url https://example.com/extensions/download-to-curl.crx --out dist/update.xml
```

## Chrome 策略安装

最终验收安装方式是策略安装扩展。

Windows 当前用户策略示例：

```powershell
reg add HKCU\Software\Policies\Google\Chrome\ExtensionInstallForcelist /v 1 /t REG_SZ /d "<extension_id>;https://example.com/extensions/update.xml" /f
```

Linux managed policy 示例：

```json
{
  "ExtensionInstallForcelist": [
    "<extension_id>;https://example.com/extensions/update.xml"
  ]
}
```

保存到：

```text
/etc/opt/chrome/policies/managed/download-to-curl.json
```

安装后重启 Chrome，打开 `chrome://policy`，点击重新加载策略，确认 `ExtensionInstallForcelist` 已生效。再打开 `chrome://extensions`，确认扩展显示为由策略安装。

## 集成验收

项目内置本地集成 fixture：

```sh
npm run integration:server
```

服务会输出：

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/update.xml
```

在策略安装扩展已安装的 Chrome 中验证：

1. 打开扩展页面，把 **Capture Downloads** 打开。
2. 打开本地 fixture 页面。
3. 点击 GET 下载链接。
4. 确认 Chrome 没有保留本地下载文件，并且 `capture.html` 出现 `integration-get.zip`。
5. 提交 POST 下载表单。
6. 确认最新记录是 `integration-post.xlsx`。
7. 点击 **POST JSON 附件下载（带 Authorization）**。
8. 确认最新记录是 `integration-post-json.xlsx`。
9. 确认 curl 中包含 `-X POST`、`--data-raw`、Cookie、User-Agent、Referer，以及 Chrome 暴露出来的 Authorization。
10. 点击 **Copy curl**，把命令复制到 Linux/macOS shell 中执行。

## Chrome 权限说明

- `webRequest`：监听请求生命周期。
- `webRequestBlocking`：在 `onHeadersReceived` 中取消匹配到的下载响应。
- `storage`：保存捕获开关、最近记录、结果页签 ID、自定义规则。
- `tabs`：打开或聚焦 `capture.html`。
- `clipboardWrite`：复制生成的 curl 命令。
- `<all_urls>`：允许扩展观察用户本地触发的任意站点下载。

## 使用说明

1. 打开扩展 action 或 `capture.html`。
2. 打开 **Capture Downloads**。
3. 在 Chrome 中触发下载。
4. 如果响应匹配下载规则，原始 Chrome 下载会被取消。
5. 扩展打开或聚焦结果页签，最新记录显示在最上方。
6. 点击 **Copy curl**，复制命令到 Linux/macOS shell 使用。

生成的 curl 可能包含 Cookie、Authorization、Proxy-Authorization 等登录态信息，请按敏感凭证处理。

## 下载识别规则

满足任意一项即判定为下载：

- `Content-Disposition` 包含 `attachment`。
- `Content-Disposition` 包含 `filename`。
- `Content-Type` 是常见压缩包、文档、表格、安装包或二进制类型。
- URL path 以 `.zip`、`.rar`、`.7z`、`.tar`、`.gz`、`.pdf`、`.csv`、`.xls`、`.xlsx`、`.dmg`、`.pkg`、`.exe`、`.bin` 等后缀结尾。
- 用户自定义规则命中 URL 或响应头。

自定义规则支持：

- 普通子串：`example.com/export`
- 通配符：`*.custom-download`
- JavaScript 风格正则：`/content-type: application\/x-custom/i`

默认不拦截 Chrome 报告为 image、script、stylesheet、font、media、websocket、ping、csp_report 的资源类型。

## 已知限制

- Chrome 只会向扩展暴露部分网络请求头，未暴露的重要请求头会显示为 `Not exposed by Chrome`。
- 请求体捕获依赖 `chrome.webRequest.onBeforeRequest` 暴露的数据，流式或超大 body 可能不可用。
- 文件名推断顺序是 `Content-Disposition`、URL path、可选 metadata、`download.bin`。
- 完整阻断行为必须通过 Chrome 策略安装验证；开发者模式不能作为最终验收。
- curl 输出只支持 Linux/macOS shell 格式，不生成 PowerShell curl。
