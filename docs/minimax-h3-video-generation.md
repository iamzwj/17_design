# MiniMax H3 视频生成 API

- 接口：`POST {GRSAI_BASE_URL}/v1/api/generate`
- 认证：`Authorization: Bearer <GRSAI_API_KEY>`
- 模型：`minimax-h3`

请求字段：

```json
{
  "model": "minimax-h3",
  "prompt": "专业的视频提示词",
  "aspectRatio": "landscape",
  "images": ["https://example.com/reference.png"],
  "audios": [],
  "seed": -1,
  "resolution": "768p",
  "duration": 8,
  "replyType": "async"
}
```

参数限制：

- 比例：`portrait`、`landscape`、`square`
- 参考图：最多 9 张
- 音频：最多 3 个
- 分辨率：480p、768p、1080p
- 时长：1–15 秒；1080p 最长 10 秒
- 返回状态：`running`、`succeeded`、`violation`、`failed`
- 结果视频地址：`results[0].url`

异步任务：提交后保存返回的 `id`，使用 `GET /v1/api/result?id=<id>` 持续查询。`running` 仅表示已提交；只有 `succeeded` 且存在视频 URL 才视为完成。刷新或切换模块后继续查询已保存的任务，不重复提交。
