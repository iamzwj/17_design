# 一键成片升级交付与运行说明

## 实现与文件

审查基线与分阶段计划见 FILM_UPGRADE_AUDIT.md。

- `server/films.js`：既有鉴权和影片API；新增命令、文件上传和项目上下文快照。
- `server/filmState.js`：兼容迁移、持久化命令、安全点应用、锁定、历史、依赖失效、版本回退。
- `server/filmAgents.js`：LangChain结构化步骤；导演、编剧、角色、场景、分镜、连续性审核与定向修改。
- `server/filmWorker.js`：原LangGraph Worker扩展，保持单一执行器；10路生图/视频、任务ID、结果隔离、质检、有限恢复。
- `server/filmEditing.js`：复用FFmpeg，抽取原生音轨、实际音频字幕、音轨混音、时间线裁切/排序/淡入淡出、MP4与文件校验。
- `server/index.js`：注入既有知识库和Skill解析服务。
- `shared/filmWorkflow.js`、`shared/filmProgress.js`：真实阶段状态、事件和名称。
- `src/FilmStudio.jsx`：保留入口、任务列表、持久化恢复和新建项目；加入风格、品牌和Skill可选上下文。
- `src/FilmWorkbench.jsx`、`FilmEditor.jsx`、`FilmTimeline.jsx`、`FilmMedia.jsx`、`filmUpload.js`、`filmWorkbench.css`：三栏工作台、真实事件聊天、编辑与版本操作、折叠时间线、媒体预览。
- `src/ComposerSelect.jsx`：新增可选portal，只有工作台启用，避免下拉被滚动容器裁切；旧模块行为保持默认。
- package.json / lock：将原已传递安装的LangChain Core显式列为直接依赖。

## 存储及兼容迁移

没有新增数据库或第二套队列。继续使用 `data/films/<UUID>/project.json` 和独立Worker。
旧项目第一次读取时以排他创建方式保存 `project-schema1-backup.json`；旧文件与付费生成结果保留，不强制重做。
新项目schemaVersion=2，新增script、characters、scenes、resources、tasks、timeline、settings、appliedCommands、版本历史等字段。
人工操作存 `commands/<时间>-<UUID>.json`，Worker安全点读取；API不与运行中Worker竞争写同一个快照。
旧异步任务保留providerId；新版本用独立任务ID。旧版本返回只进入历史，不覆盖新成果。
原始参考图上传后锁定保存，面部三视图作为派生资源生成；修改面部会影响相应服装和引用镜头。
锁定的下游遇到上游改变会显示“过期/需人工决定”，不会自动覆盖。
所有音轨、原始镜头、字幕、剪辑工程、历次MP4均保留。模型输入快照和完整任务事件可回溯。

## 关键接口

沿用：GET/POST `/api/films`、GET `/api/films/:id`、旧resume/revise/assets/cancel兼容路由、鉴权文件下载。
新增：POST `/api/films/:id/commands`，body=`{type,body}`。
支持pause/resume、stage-pause、task-pause、edit、regenerate、lock、keep、restore、script/script-lock、add-outfit、revise、settings、timeline。
新增：POST `/api/films/:id/upload`，body=`{kind,name,data}`，kind为image/video/audio；25MB上限，校验实际媒体格式，单项目最多80次上传。
文件下载支持PNG/JPG、MP4、音轨、SRT、JSON，仍须项目所有者鉴权。供模型读取的图片继续使用30分钟HMAC链接。

## 使用

1. 视频生成 → 一键成片。输入故事，设置时长、比例、风格和模型，可选择品牌规范与视频Skill。
2. 默认自动到成片，不需要逐阶段确认。主动选择“仅生成分镜”才停下来。
3. 顶部控制项目；左侧选择阶段，中间筛选真实Agent记录或下达修改，右侧编辑成果。
4. 锁定成果后不会自动替换；历史回退创建新版本。运行中编辑会在安全点应用并自动续跑。
5. 展开时间线调整片段顺序、入点、长度、字幕和音轨；只重新导出，不重新制作无关视频。
6. 图片和视频各最多10个并行任务；依赖参考图未完成的任务按依赖等待。

## 验证

自动化：filmState / filmProgress / filmPool 单元测试；films 旧项目重启、局部重做与10路并发；filmWorkflow 双角色双场景昼夜全流程，实际FFmpeg导出、音轨上传混音、锁定、恢复、局部更新、运行中编辑后重启。
浏览器：深浅色×1440/390；九阶段导航、Agent筛选、编辑、锁定、时间线排序、刷新恢复；真实渲染截图检查；统一下拉13px箭头、右侧14px间距。
构建及所修改文件ESLint检查。模拟模型集成验证不能证明真实供应商图像/视频质量，真实模型运行另行记录。

## 明确边界

- 暂停是停止新任务调度，不代表取消供应商已提交请求；没有接入可靠取消接口时继续回收原任务结果，不重复提交。
- 继续使用视频原生声音，不擅自增加独立TTS模型。可以上传配音/音乐/环境音；有对白但无音轨时要求人工处理，除非用户明确允许静音。
- 字幕优先来自实际音轨的模型转录；失败时明确标注按镜头估时，可手动校正，不保证自动口型或字级时码绝对准确。
- 当前两个视频接入按已验证的每段≤10秒执行，满足≤15秒要求；不虚构15秒原生能力。模型未按约束拆镜时使用高质量备用模型或明确报错。
- 审核属于辅助观察；设定图和视频有证据记录，修复有上限，无法恢复时进入人工处理，不伪装成功。
