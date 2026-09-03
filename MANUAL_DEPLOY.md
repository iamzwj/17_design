# 手动部署：朴里节头像下载次数统计

此压缩包包含两部分：

- `cloudflare-worker/`：全站头像下载次数 API（含 Durable Object 计数器）。
- `dist/`：已经构建好的网页静态文件。

## 1. 发布 Worker（必须先做）

1. 在 Cloudflare Dashboard 登录拥有 `xiaodie-api` Worker 的账号。
2. 在本机终端进入 `cloudflare-worker` 目录。
3. 使用已登录的 Wrangler 或设置具有 Workers 编辑权限的 `CLOUDFLARE_API_TOKEN`。
4. 执行：

   ```bash
   npx wrangler deploy
   ```

Worker 首次发布会自动创建 `AvatarDownloadCounter` Durable Object。现有的 KV、Google Drive 和其他 Worker 密钥保持不变；不要删除它们。

## 2. 发布 Pages

1. 打开 Cloudflare Pages 项目 `xiaodie`。
2. 选择上传资产（Direct Upload）。
3. 上传 `dist` **目录内的全部文件**，不要上传外层目录。

也可以在项目根目录执行：

```bash
npx --prefix cloudflare-worker wrangler pages deploy dist --project-name=xiaodie
```

## 验证

打开“更多工具 → 朴里节头像框”。右侧应显示“朴里节头像已生成”的大号数字；每点击一次“下载头像”，次数会立即增加，其他人刷新页面也会看到最新总数。
