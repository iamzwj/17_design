# 蝶发 AI 创作工作台

一个可持续扩展的 AI 工具合集，目前包含：

- AI 生图：`gpt-image-2` 对话式生图、参考图、画幅比例、结果下载
- AI 策略：`gpt-5.5` 多轮策略对话
- 合规审核：`gpt-5.5` 内容风险预检与修改建议
- 对话记录：自动保存在当前浏览器，可随时打开并继续对话

## 本地启动

需要 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env.local
```

在 `.env.local` 中填写服务端配置：

```env
GRSAI_API_KEY=你的密钥
GRSAI_BASE_URL=https://grsaiapi.com
PORT=8787
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USERNAME=你的163邮箱
SMTP_PASSWORD=你的163邮箱授权码
```

开发模式：

```bash
npm run dev
```

访问 `http://localhost:5173`。

生产模式：

```bash
npm run build
npm start
```

访问 `http://localhost:8787`。

## 安全说明

API 密钥仅由 Node 服务端读取，浏览器只请求本项目的 `/api/text` 和 `/api/image` 代理接口。`.env` 与 `.env.local` 已加入 `.gitignore`，不要把密钥提交到版本库或写入前端代码。

注册验证码通过 SSL SMTP 发送。`SMTP_PASSWORD` 应填写邮箱授权码而非网页登录密码；生产部署请使用平台 Secret，不要把授权码写进版本库。

## 扩展新工具

前端模块入口集中在 `src/App.jsx` 的 `MODULES` 配置中。新增模块时，为配置增加一项，并创建对应工作区组件即可。服务端外部模型调用统一放在 `server/index.js`，便于后续接入知识库、Skills、鉴权、额度与审计日志。
