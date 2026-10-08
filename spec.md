# 数据架构与交互规范

唯一有效数据包版本：`schema_version: 3`。不读取旧 manifest/set/composite 格式，不提供 `/api/v2/*`、`/api/v3/*` 路由。

## Collection 声明

```json
{
  "schema_version": 3,
  "id": "sft-e6.0-r30",
  "title": "sft-e6.0-r30",
  "tasks": [{
    "id": "refseg", "title": "Refseg",
    "datasets": [{
      "id": "sior-t", "title": "SIOR_T", "data_origin": "native",
      "exps": [{ "id": "baseline" }]
    }]
  }]
}
```

实验目录为 `tasks/refseg/datasets/sior-t/exps/baseline/`。其中 `experiment.json`：

```json
{
  "schema_version": 3, "id": "baseline", "title": "Baseline",
  "record_count": 1,
  "metadata": { "checkpoint": "step50", "role": "prediction" }
}
```

`metadata` 为普通 JSON 对象，保存训练配置、执行状态、证据等，不参与任务卡片显示。collection 的 `exps` 只引用 ID，不复制实验配置。

## 完整样本

`samples.jsonl` 每行一个对象，不允许空白行、重复 sample_id 或 index。每个实验独立包含 input/pred/GT 和自己的全部 panels，可使用任意正整数 index，不要求连续或固定 30 条。

```json
{"sample_id":"request-A","index":1,"input_text":"Segment airplane","pred_text":"","gt_text":null,"panels":[{"id":"original","title":"Original","asset":"assets/request-A/original.png"},{"id":"pred","title":"Pred overlay","asset":null,"unavailable_reason":"Prediction was not produced"}],"extra_texts":[{"title":"Source annotation text","text":"airplane"}],"metadata":{"seed":42}}
```

sample_id 是逻辑样本身份，在同任务、来源的所有实验中稳定复用。index 仅定义实验内顺序，不代替跨实验身份。不得按同名原图或相同 index 推断身份。输入、预测、GT 均必填，可以为 null，空字符串保持独立含义。额外文本不替换这三项；不从来源标注或参考输出猜测 GT 或预测。

panel 顺序完全由数组决定，支持 1–32 个独立面板。每个 panel ID 在样本内唯一；asset 是该实验内 `assets/` 下的相对路径，不允许绝对路径、`..`、符号链接或未声明资源。缺少资源必须使用显式 null 和非空原因；声明有资源但找不到、格式错误的包拒绝发布。

ID 匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`。JSON 单文件配置和单行样本各不超过 1 MiB，samples.jsonl 不超过 100 MiB，单实验最多 100000 样本，单样本 JSON 最多 50000 节点、嵌套深度 100；单图最多 50 MiB，校验后缀、签名、尺寸。Schema：[collection](schemas/collection.schema.json)、[experiment](schemas/experiment.schema.json)、[sample](schemas/sample.schema.json)。

## 接口

| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/health` | 服务状态 |
| GET | `/api/catalog` | collections、组装后的实验元数据、snapshot_id、diagnostics |
| GET | `/api/collections/:collection/tasks/:task/datasets/:dataset/exps/:exp/records` | 完整实验样本，panel 含 status/url/thumbnail_url，不含 asset 文件路径；mime/尺寸可省略 |
| GET | `/api/media/:collection/:task/:dataset/:exp/:sample/:panel` | 已声明的原始图片；`?variant=thumbnail` 返回最长边 512px、质量 80 的 WebP |
| POST | `/api/reload` | 刷新后的 catalog；同源校验、频率限制 |

metadata 中原始证据按普通 JSON 原样保留，服务端不解释其文件路径。catalog 中结构化元数据无效的包隔离并给出诊断；启动和刷新不遍历或读取 assets。CLI 继续严格验证所有图片。运行时 `available` 表示有已声明的资源，其是否可用在单图请求时确认，坏图不移除整个 collection。

catalog/records 使用元数据快照 ETag；自动刷新在后台检查元数据，期间请求使用当前快照。手动 Reload 等待元数据刷新，并重置前端图片请求。图片每次请求确认安全路径和文件版本，原图与缩略图使用独立 ETag 和 `private, no-cache`，不能通过未知 sample/panel 访问 assets。源文件替换后原图和缩略图缓存均失效。

缩略图按需生成：不裁剪、不放大小图，保留透明度；原图字节保持不变。转换并发最多 2 个，每次转换最多 10 秒；待转换队列最多 64 个，排队超时或队列满返回 503，处理超时返回 504。已生成图片使用 64 MiB 内存 LRU 缓存，相同版本的并发转换合并；不写入数据包。

## 浏览和比较

首页数据集卡片只有 collection title。应用标题靠左，无数据集副标题；右侧为 Reload data、Copy link、侧栏按钮。任务名称首字母大写，GCG/VGD 全大写、Relative Height 分词。任务卡片只显示名称和展开按钮，无进度或执行状态。来源图标按声明的原生/衍生分类显示。

侧栏从上到下为 Dataset、View by（Task/Exp）、Search examples。Task 模式选择顺序 task → dataset → exp；Exp 模式 exp → task → dataset，只列实际存在的实验。切换模式保留列和浏览状态。同一实验允许多个独立列实例，列可排序、删除，卡片下拉在选择、点击外部和 Escape 时关闭。

同一 collection/task/dataset 的多个实验按 sample_id 联合对齐。优先用已选 Baseline 的 index 排序；无 Baseline 时，以已选实验在 collection 中的声明顺序为锚点。缺失样本显式留空，新增样本在锚点样本后追加。不同 cohort 按各自排好后的行序并排，不跨来源对齐身份。过滤、分页、确定性 shuffle 在对齐之后执行；拖动列不改变行顺序，不显示单独 index 列。

每个样本的 panels 保持一行、等宽、全部可见，缺图占据自己的位置，长文本在列内折行。点击任意缩略图打开整组，不跳到单图。弹窗显示全组和完整文本/JSON，只有浮动 Close；点击背景、Close 和 Escape 关闭并恢复焦点，内部点击和拖动到外部不关闭。手机上 panels 仍然横排，详情可向下滚动。

列表在面板接近可见区域 300px 时请求缩略图，最多 4 张并发，完成一张立即显示并补位；弹窗使用独立的 2 个原图请求名额，可先显示已有缩略图。缩略图单次请求超时 15 秒，原图 60 秒；网络错误、超时、429、5xx 最多自动重试 2 次，默认退避 0.5/1.5 秒并尊重 Retry-After。退避不占请求名额；404、解码失败不自动重试。失败图提供独立 Retry 按钮，显式缺图保持原因占位。无人使用的请求被取消，Blob URL 在最后一个使用者离开时释放。

实验 GET 请求最多 4 列并发、单次超时 20 秒，使用相同有限重试策略；失败列可独立 Retry，不重载正常列。Reload POST 不自动重试。

Input/Pred/GT 均显示。合法 `<p>airplane-3<color>(254, 91, 109)</color></p>` 整个 token 按指定颜色显示，保留标签和空白、提供对比背景，禁止执行 HTML。GT、额外文本参与搜索。原始 metadata 可展开、复制查看。

## URL

collection 导航保持 `?dataset=sft-e6.0-r30`。列为 `cols=task:dataset:exp:instance,...`；active 为 `task:dataset:exp:instance:sample_id`。不接受三段旧列格式，不将旧 active 中的数字序号转换为 sample_id。可持久化 mode、q、order、seed、page、pageSize，页面刷新和浏览器历史还原状态。无效或未发布的列移除，不转换为默认实验。
