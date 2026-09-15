# Vibbit Seedance 视频生成 API

本文件保留视频生成的 API 约定，供后续功能迭代使用。

## 服务地址与认证

- OpenAPI 地址：`https://openapi.vibbit.cn/openapi/v1`
- 环境变量：`VIBBIT_OPENAPI_KEY`
- 请求头：`Authorization: Bearer <VIBBIT_OPENAPI_KEY>`
- 上传后的参考图必须使用公网可访问的 HTTPS 地址；本站通过 `VIBBIT_PUBLIC_BASE_URL` 提供该地址。

## 创建任务

`POST /tasks`

```json
{
  "task_type": "SEEDANCE_VIDEO_GENERATION",
  "input_info": {
    "input": "{\"model\":\"doubao-seedance-2-0-260128\",\"prompt\":\"一只蝴蝶穿过雨夜城市\",\"duration_seconds\":4,\"resolution\":\"720p\",\"aspect_ratio\":\"16:9\"}"
  }
}
```

`input_info.input` 是序列化后的 JSON。成功响应从 `data.task_id` 读取任务编号。

## 查询任务

`GET /tasks/{task_id}`

任务结果位于 `data.task_result.result`，该字段也是 JSON 字符串；成功视频地址为 `video_url`，失败信息为 `error_message`。

## 支持模型

| 模型 ID | 分辨率 | 时长 |
| --- | --- | --- |
| `doubao-seedance-2-0-fast-260128` | 480p、720p | 自动或 4–15 秒 |
| `doubao-seedance-2-0-260128` | 480p、720p、1080p、4k | 自动或 4–15 秒 |
| `doubao-seedance-2-0-mini-260615` | 480p、720p | 自动或 4–15 秒 |
| `doubao-seedance-2-5-260628` | 480p、720p、1080p | 自动或 4–30 秒 |

可用画幅：`16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`；部分全模态场景可使用 `adaptive`。

## 参考图字段

- 单图：`image_url`
- 首尾帧：`first_frame_image_url`、`last_frame_image_url`
- 多图：`reference_image_urls`

Seedance 2.0 最多 9 张参考图，Seedance 2.5 最多 30 张。Seedance 2.5 还支持 `omni_reference_task_type`：`auto`、`reference`、`edit`、`extend`。
