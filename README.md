# Download to cURL Capture

本项目是一个本地自用 Firefox 扩展，用于在 Firefox 默认下载器接手前拦截匹配到的下载响应，并生成可在 Linux/macOS 终端执行的 `curl` 命令。

扩展只在本地浏览器配置文件中保存捕获记录，不上传数据、不执行远程下载、不修改网页内容、不修改响应内容。

## 浏览器要求

请安装 Firefox Developer Edition：

```text
https://www.mozilla.org/firefox/developer/
```

Firefox Developer Edition 支持扩展开发工具，并可在 `about:config` 把 `xpinstall.signatures.required` 切到 `false` 后安装未签名扩展。未签名安装要求扩展有固定 add-on ID，本项目已经在 `manifest.json` 中声明 `download-to-curl@example.local`。普通 Firefox Release 可以通过 `about:debugging` 临时加载开发中的扩展，但不能安装未签名 XPI，不适合作为本项目最终验收环境。

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
- 模拟 WebExtension API 的后台生命周期集成测试，验证 POST 下载会被捕获、取消、保存，并复用结果页签。

临时加载只用于调试 UI 和基础逻辑，不作为最终验收方式。完整下载拦截和重启保留行为必须通过 Firefox Developer Edition 的安装版扩展验证。

更完整的逐项验收说明见 [ACCEPTANCE.md](ACCEPTANCE.md)。

## 临时加载调试

1. 运行 `npm run stage`。
2. 打开 Firefox Developer Edition。
3. 打开 `about:debugging#/runtime/this-firefox`。
4. 点击 **Load Temporary Add-on...**。
5. 选择 `dist/extension/manifest.json`。

临时加载适合调试 `capture.html`、开关状态、记录渲染和 curl 生成。浏览器重启后临时加载会失效。

## 本地打包 XPI

生成 Firefox 可安装的 XPI：

```sh
npm run package:xpi
```

产物：

```text
dist/download-to-curl.xpi
```

XPI 本质上是一个扩展 ZIP 包，内部包含 `manifest.json`、后台脚本、结果页和核心逻辑文件。扩展 ID 固定在 `manifest.json` 的 `browser_specific_settings.gecko.id`：

```text
download-to-curl@example.local
```

每次需要让 Firefox 识别升级时，都要先提升 `manifest.json` 里的 `version`，再重新打包 XPI。Firefox 企业策略会根据 XPI 内部版本更新或重装扩展。

## GitHub Actions 打包

仓库已经提供工作流：

```text
.github/workflows/package-extension.yml
```

它会执行：

1. 检出代码。
2. 设置 Node.js 22。
3. 运行 `npm test`。
4. 运行 `npm run package:xpi`。
5. 上传 `download-to-curl.xpi` 和 `package-info.txt`。
6. 如果是 `v*` 标签触发，自动把两个文件发布到 GitHub 发布页。

手动触发：

```text
Actions -> 打包 Firefox 扩展 -> Run workflow
```

标签触发：

```sh
git tag v0.1.0
git push origin v0.1.0
```

标签触发后，GitHub 发布页中会包含：

```text
download-to-curl.xpi
package-info.txt
```

如果仓库是私有仓库，GitHub 发布页资产通常不适合作为策略安装源。请把 `download-to-curl.xpi` 发布到 Firefox 可直接访问、无需登录态的 HTTPS 静态文件服务，或在本机策略中使用 `file:///` XPI 地址。

## Firefox 策略安装

最终验收建议使用 Firefox Developer Edition 的 `policies.json` 安装扩展。

如果安装未签名 XPI，请先打开 `about:config`，把 `xpinstall.signatures.required` 设置为 `false`。

Firefox 策略文件位置取决于安装方式。常见路径：

- Windows：在 `firefox.exe` 所在目录旁创建 `distribution/policies.json`。
- macOS：`Firefox Developer Edition.app/Contents/Resources/distribution/policies.json`。
- Linux：Firefox 安装目录下的 `distribution/policies.json`，或系统级 `/etc/firefox/policies/policies.json`。

`policies.json` 示例：

```json
{
  "policies": {
    "ExtensionSettings": {
      "download-to-curl@example.local": {
        "installation_mode": "force_installed",
        "install_url": "file:///D:/git-project/idea_zone/download-to-curl/dist/download-to-curl.xpi"
      }
    }
  }
}
```

如果使用 HTTPS 发布地址：

```json
{
  "policies": {
    "ExtensionSettings": {
      "download-to-curl@example.local": {
        "installation_mode": "force_installed",
        "install_url": "https://example.com/extensions/download-to-curl.xpi"
      }
    }
  }
}
```

安装后重启 Firefox Developer Edition，打开 `about:policies`，确认 `ExtensionSettings` 已生效。再打开 `about:addons`，确认扩展已安装。

## 集成验收

项目内置本地集成 fixture：

```sh
npm run integration:server
```

服务会输出：

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/download-to-curl.xpi
```

在已安装扩展的 Firefox Developer Edition 中验证：

1. 打开扩展页面，把 **Capture Downloads** 打开。
2. 打开本地 fixture 页面。
3. 点击 GET 下载链接。
4. 确认 Firefox 没有保留本地下载文件，并且 `capture.html` 出现 `integration-get.zip`。
5. 提交 POST 下载表单。
6. 确认最新记录是 `integration-post.xlsx`。
7. 点击 **POST JSON 附件下载（带 Authorization）**。
8. 确认最新记录是 `integration-post-json.xlsx`。
9. 确认 curl 中包含 `-X POST`、`--data-raw`、Cookie、User-Agent、Referer，以及 Firefox 暴露出来的 Authorization。
10. 点击 **Copy curl**，把命令复制到 Linux/macOS shell 中执行。

## Firefox 权限说明

- `webRequest`：监听请求生命周期。
- `webRequestBlocking`：在 `onHeadersReceived` 中取消匹配到的下载响应。
- `storage`：保存捕获开关、最近记录、结果页签 ID、自定义规则。
- `tabs`：打开或聚焦 `capture.html`。
- `clipboardWrite`：复制生成的 curl 命令。
- `<all_urls>`：允许扩展观察用户本地触发的任意站点下载。

## 使用说明

1. 打开扩展 action 或 `capture.html`。
2. 打开 **Capture Downloads**。
3. 在 Firefox 中触发下载。
4. 如果响应匹配下载规则，原始 Firefox 下载会被取消。
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

默认不拦截浏览器报告为 image、script、stylesheet、font、media、websocket、ping、csp_report 的资源类型。

## 已知限制

- Firefox 只会向扩展暴露部分网络请求头，未暴露的重要请求头会显示为 `Not exposed by browser`。
- 请求体捕获依赖 `webRequest.onBeforeRequest` 暴露的数据，流式或超大 body 可能不可用。
- 文件名推断顺序是 `Content-Disposition`、URL path、可选 metadata、`download.bin`。
- 完整阻断、重启保留和升级行为必须通过 Firefox Developer Edition 的安装版扩展验证；临时加载不能作为最终验收。
- curl 输出只支持 Linux/macOS shell 格式，不生成 PowerShell curl。
