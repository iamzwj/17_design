# 小蝶 Cloudflare Worker API

这个 Worker 让 Cloudflare Pages 的静态网页保留生图、生文和瀑布流任务能力。API Key 只存放在 Worker 的 Secret 中，不写入网页文件。

## 部署一次

1. 创建一个 KV namespace，例如 `XIAODIE_TASKS`。本部署方案不使用 R2，因此不需要绑定银行卡。
2. 在 `wrangler.toml` 中填入 KV 的 id。
3. 在这个目录执行：

   ```bash
   npm install
   npx wrangler login
   npx wrangler secret put GRSAI_API_KEY
   npx wrangler secret put SMTP_PASSWORD
   npx wrangler secret put GOOGLE_DRIVE_CLIENT_SECRET
   npx wrangler secret put GOOGLE_DRIVE_SETUP_TOKEN
   npx wrangler secret put TAVILY_API_KEY
   npm run deploy
   ```

4. 获取部署完成后的 Worker 地址，例如 `https://xiaodie-api.<你的账号>.workers.dev`。
5. 打开 Pages 部署目录根部的 `app-config.js`，把 `API_BASE_URL` 改为这个 Worker 地址后重新压缩并通过 Pages Direct Upload 上传。
6. Worker 环境变量 `ALLOWED_ORIGIN` 建议改成你的 Pages 地址；`GRSAI_BASE_URL` 保持默认即可。

> API 已启用登录鉴权。仍建议把 `ALLOWED_ORIGIN` 改成实际 Pages 域名，避免其他网站的浏览器调用接口。

## 功能与存储

- `GRSAI_API_KEY`：Worker Secret，上游 API 密钥。
- `TAVILY_API_KEY`（可选）：Worker Secret。开启「联网搜索」后用于检索网页，模型回答下方会展示来源链接。
- `SMTP_PASSWORD`：Worker Secret，填写 163 邮箱授权码，用于向 `@onewo.com` 邮箱发送注册验证码。
- `SMTP_HOST`、`SMTP_PORT`、`SMTP_USERNAME`：163 邮箱的 SSL SMTP 配置。
- Google Drive（可选）：设置 `GOOGLE_DRIVE_CLIENT_ID`、`GOOGLE_DRIVE_FOLDER_ID`、`GOOGLE_OAUTH_REDIRECT_URI` 环境变量，并将 `GOOGLE_DRIVE_CLIENT_SECRET` 与 `GOOGLE_DRIVE_SETUP_TOKEN` 作为 Secret 保存。访问一次 `/api/google-drive/connect?setup=<设置令牌>` 完成授权后，后续生成图片会自动保存至指定文件夹。
- 保存至 Google Drive 的图片保留 30 天，Worker 每天自动清理到期图片；成功和部分成功的瀑布流任务历史也在 30 天后自动删除。
- KV：用户、登录会话、验证码、瀑布流任务和状态。
- 完全失败、超时或已停止的瀑布流任务会在 10 分钟后自动从 KV 删除；包含成功图片的任务会保留。
- 不使用 R2：参考图会直接提交给生成服务，但不会在瀑布流任务历史中长期保存缩略图。
- 生成结果使用上游返回的图片 URL，无需额外对象存储。

本地开发时，前端的 `API_BASE_URL` 留空即可继续访问本项目的 Express API。
