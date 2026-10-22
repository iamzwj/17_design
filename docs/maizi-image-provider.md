# MaiziAI 图片接入

`server/maiziImages.js` 是独立的 Node.js 服务端适配模块，不依赖 D-Gen 的数据库、账号或积分代码。其他 Node.js 项目可复用该模块，自行持久化返回的任务 ID。

## 配置

- `MAIZI_API_KEY`：仅服务器读取。D-Gen 从 GitHub Actions Secret 注入；不要放在前端或提交到 Git。
- `MAIZI_BASE_URL`：默认 `https://api.maizitech.ai`，也接受带 `/v1` 的配置。

## 当前型号契约

准确型号为 `gpt-image-2.5-flare-t`、`gpt-image-2.5-sunburst-t`，与已移除的无 `-t` 型号不同。

- `size` 使用官方允许的比例；`resolution` 使用 `1K`、`2K`、`4K`。
- 质量固定为 `low`，不提供 high/xhigh/max。
- 普通二维图片数量整数 1–10；D-Gen 沿用每个结果槽独立请求 `n=1`，聚合成功与失败，失败槽单独退还应用积分。
- 异步生成：POST `/v1/images/generations`；编辑：POST `/v1/images/edits`。
- 查询：GET `/v1/tasks/{task_id}`，正常每 5 秒查询；短暂网络/服务错误只重试查询，不重复提交计费任务。
- 实际渠道可能将异步句柄包装在 `data[0].task_id`，必须保持 pending 而非误判为完成。
- 同步兼容接口使用 `/v2`，处理全部 `data[].url` / `b64_json`；如果渠道仍返回排队任务则跟随原任务查询。
- `result_urls` 的所有项目及部分成功计数均在适配模块中保留。
- 内联品牌素材使用 multipart 直接交给编辑接口，不为参考图兼容性而公开原稿；HTTP(S) 参考图采用 JSON `images`。
- 生成与编辑都不跨服务商替换型号；提交超时不自动重发，避免重复扣费。

## 在其他服务端复用

```js
import { createMaiziImageClient } from './maiziImages.js'
const client = createMaiziImageClient({ apiKey: process.env.MAIZI_API_KEY })
const task = await client.generate({
  model: 'gpt-image-2.5-flare-t', prompt: '白色背景上的红色球体',
  ratio: '1:1', resolution: '1k', n: 1,
})
// 先持久化 task.id，再由后台任务周期查询。所有结果在 results 中。
const state = await client.poll(task.id)
```

官方文档入口：https://www.maizitech.ai/docs/image-overview
型号页：https://www.maizitech.ai/docs/image-gpt-image-25-t
