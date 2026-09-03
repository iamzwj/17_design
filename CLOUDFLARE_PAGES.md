# Cloudflare Pages Direct Upload

## 上传包

使用项目根目录生成的 `xiaodie-cloudflare-pages.zip`。在 Cloudflare Pages 创建项目时选择 **Direct Upload**，上传此 ZIP 中的内容。

也可以解压后上传 `cloudflare-pages/` 目录内的全部文件；其中必须包含 `index.html` 和 `assets/`。

## 生图、生文接口配置

Cloudflare Pages 的静态托管不会运行本项目的 Express 服务，也不应该在浏览器中公开 API Key。

请在上传前或上传后编辑部署根目录中的 `app-config.js`：

```js
window.XIAODIE_CONFIG = {
  API_BASE_URL: 'https://你的已部署 API 服务地址',
}
```

本项目已包含可搭配使用的 `cloudflare-worker/`。部署该 Worker 后，将它的地址填入这里即可。Worker 包的说明见 `cloudflare-worker/README.md`。

此地址必须提供以下接口：

- `POST /api/auth/register/code`
- `POST /api/auth/register/verify`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/password`
- `POST /api/auth/logout`
- `POST /api/image`
- `POST /api/text`
- `GET /api/waterfall/tasks`
- `POST /api/waterfall/tasks`
- `DELETE /api/waterfall/tasks/:id`

留空时，网站界面可正常打开，但 AI 请求会请求当前 Pages 域名下的 `/api`，无法完成生成。

不要将 API Key 写进 `app-config.js`、前端代码或 ZIP；这些内容部署后对所有访客可见。

验证码邮件由 Worker 通过 `smtp.163.com:465` 发送。部署前执行 `npx wrangler secret put SMTP_PASSWORD` 注入 163 邮箱授权码；不要把授权码放进 `wrangler.toml`。

当前 Worker 仅使用 KV，不使用 R2，因此无需为 Cloudflare 绑定银行卡。瀑布流参考图只用于当次生成，不会在任务历史中长期保存缩略图。
