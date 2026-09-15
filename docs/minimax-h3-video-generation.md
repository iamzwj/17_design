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
  "replyType": "json"
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
