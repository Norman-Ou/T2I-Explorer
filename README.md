# T2I Explorer

本地实验对比浏览器。数据按 collection → task → dataset → exp 组织，每个实验独立保存完整样本和图片资源。支持 Task / Exp 两种浏览顺序，同一任务、数据来源的实验按稳定 `sample_id` 对齐；不同来源按各组排序后的行序比较。

需要 Node.js 24.21.0、pnpm 12.4.2。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 http://localhost:4173/ 。默认数据根目录 `data/datasets`，可用 `T2I_DATA_ROOT` 设置。演示数据：`T2I_DATA_ROOT=fixtures/datasets pnpm start`。

需要后台运行并通过域名访问时，使用仓库内的 [start-t2i-explorer skill](.agents/skills/start-t2i-explorer/SKILL.md)：`使用 $start-t2i-explorer 启动项目`。默认通过已有 Cloudflare Tunnel 代理到 **https://dive.ouruizhe.top**，包括构建、systemd 用户服务、域名路由和健康检查；可显式指定其他域名、端口或数据目录。需要本机已有命名 tunnel 及凭据。

数据包仅接受新格式，没有旧格式或旧 API 的兼容层：

```text
<collection>/collection.json
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/experiment.json
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/samples.jsonl
<collection>/tasks/<task>/datasets/<source>/exps/<exp>/assets/...
```

`collection.json` 声明任务、数据来源及实验 ID；实验名称、配置和样本数由各自的 `experiment.json` 定义。每个来源必填 `data_origin: "native" | "derived"`，分别显示蓝色和紫色图标，前端不推断分类。

CLI 接入：

```bash
pnpm data validate /path/to/collection
pnpm data import-collection --from /path/to/collection --root data/datasets
pnpm data import-exp --from /path/to/experiment --root data/datasets --collection sft-e6.0-r30 --task refseg --dataset sior-t
```

实验包包含 `experiment.json`、`samples.jsonl` 和 `assets/`，所属任务和数据来源需已声明。默认拒绝重复发布；显式加 `--replace` 可替换。CLI 校验格式、样本身份、数量和图片；复制后校验内容摘要，在同一数据根目录暂存后发布，替换前保留 `.backups/` 原目录。导入期间用 `.import-lock` 阻止并发写入；意外中断后需先确认导入进程已退出再移除残留锁。页面 Reload data 可立即刷新，后台也检测数据文件变化。

每条样本包含 `sample_id`、`index`、`input_text`、`pred_text`、`gt_text`、`panels`、`metadata`，可加 `extra_texts`。`null` 表示不可用，`""` 表示原始空字符串。图片按 `panels` 数组顺序等宽横排；点击任意图片打开整组及文本、JSON 详情。缺图必须显式写 `asset: null` 并提供 `unavailable_reason`。图片格式 PNG/JPEG/WebP，路径只能在该实验的 `assets/` 下。精确示例、JSON Schema 和接口见 [数据规范](spec.md)。

列表按可见区域渐进加载 512px WebP 缩略图（最多 4 张并发），详情独立加载原图（最多 2 张并发）。单图失败不阻塞其余图片；临时错误自动重试最多 2 次，最终失败可点该图的 Retry。原始图片不修改。缩略图按需生成，服务端转换最多 2 个并发、10 秒处理超时，内存缓存最多 64 MiB，重启后重新按需生成。

启动、目录刷新只读取元数据，后台变更检查跳过图片目录；图片在各自请求时检查路径、文件版本和格式。运行中出现损坏或丢失图片只影响该面板，CLI 校验和导入仍拒绝不完整数据包。Reload data 同时重新请求图片，替换源文件后会失效旧缓存。

一次性旧数据转换工具独立于应用和 CLI 数据接入。它只处理本次已审计的两份 v2 目录，不是运行时适配器：

```bash
pnpm data:convert --source /path/to/old-data-root --output /path/to/new-staging-root
```

转换逐张核对 SHA-256，保留所有原文本和证据，输出 `conversion-report.json`。SFT 归入 Baseline，来源参考归入 Reference；参考输出保留为额外文本，不伪装为预测或 GT。转换结果再用新 CLI 导入，原目录进入备份。后续实验应沿用相同逻辑样本的 `sample_id`；转换后的 ID 是原 `source_sample_id` 的完整 SHA-256。

验证：

```bash
pnpm check
T2I_E2E_PORT=4182 pnpm test:e2e
```

默认服务仅绑定本机。网络绑定需设置 `T2I_ALLOW_NETWORK=true` 和 `T2I_ALLOWED_HOSTS`。数据服务只通过声明的 collection/task/dataset/exp/sample/panel 身份返回图片，不接受任意文件路径。
