---
name: start-t2i-explorer
description: Use when the user asks to start, restart, or restore access to T2I Explorer, including 启动实验浏览器 or 恢复代理访问. Defaults to the existing Cloudflare Tunnel and dive.ouruizhe.top.
---

# 启动 T2I Explorer

构建当前代码，使用 systemd 用户服务常驻运行，并通过已有 Cloudflare Tunnel 提供访问。默认地址 **https://dive.ouruizhe.top**；用户指定的域名、端口、数据根目录优先。

## 本机约定

| 项目 | 默认值 |
| --- | --- |
| 仓库 | 当前 T2I-Explorer checkout；否则取本 skill 目录真实路径的 `../../..`；最后检查 `$HOME/T2I-Explorer` |
| Origin | `http://127.0.0.1:4173` |
| 数据 | `<repo>/data/datasets`，或用户指定的 `T2I_DATA_ROOT` |
| Node | `.node-version`；本机安装在 `$HOME/.local/opt/node-v24.21.0-linux-x64/bin` |
| Tunnel 配置 | `$HOME/.cloudflared/t2i-explorer.yml` |
| 用户服务 | `t2i-explorer.service`、`t2i-explorer-tunnel.service` |
| 日志 | `journalctl --user -u t2i-explorer -u t2i-explorer-tunnel` |

仓库 `package.json` 名称应为 `t2i-explorer`。本机默认 Node 可能来自 Anaconda；先把正确 Node 的 bin 目录加入 PATH，确认 `node --version`、`pnpm --version` 与 `package.json` 一致。以下变量由实际检查结果赋值，不把占位符写进配置。

## 启动流程

1. 用 `systemctl --user status`、`systemctl --user cat` 和 `ss -ltnp` 确认服务、端口和 checkout。读取 tunnel 配置的 `tunnel`、`credentials-file`、ingress，确认凭据文件存在，不输出凭据内容。保留既有数据目录和认证配置。端口若被其他项目占用，报告冲突，不按端口批量杀进程。
2. 在选定仓库执行 `pnpm install --frozen-lockfile && pnpm build`，成功后再重启。生产入口为 `dist-server/server/index.js`，不用 Vite 开发服务器代理公网。
3. 检查或创建 `$HOME/.config/systemd/user/t2i-explorer.service`，使用实际绝对路径并保留已有兼容设置。将仍指向本应用的旧 ingress 域名一并保留在 Host 白名单中。即使绑定 loopback，也需 `T2I_ALLOW_NETWORK=true` 才能启用自定义白名单。

   ```ini
   [Unit]
   Description=T2I Explorer web service
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=<absolute-repo>
   Environment="HOST=127.0.0.1"
   Environment="PORT=4173"
   Environment="T2I_DATA_ROOT=<absolute-data-root>"
   Environment="T2I_ALLOW_NETWORK=true"
   Environment="T2I_ALLOWED_HOSTS=dive.ouruizhe.top,127.0.0.1,localhost"
   ExecStart=<absolute-node> <absolute-repo>/dist-server/server/index.js
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

4. 在原位置备份 tunnel 配置，保留 tunnel ID、凭据路径、原 ingress 和 originRequest 设置。在末尾 catch-all **之前**添加或更新目标 hostname，避免重复规则。默认新增：

   ```yaml
   - hostname: dive.ouruizhe.top
     service: http://127.0.0.1:4173
   ```

   保留末尾的原 catch-all（通常为 `- service: http_status:404`）。自定义端口时同步修改 origin、服务 PORT，以及所有仍代理本应用的旧域名规则的 service；其他应用的规则保持原值。配置和凭据留在 `$HOME/.cloudflared`，不提交到 Git。验证规则命中目标 origin：

   ```bash
   cloudflared --config "$tunnel_config" tunnel ingress validate
   cloudflared --config "$tunnel_config" tunnel ingress rule "https://$domain/"
   ```

   使用配置中的真实 tunnel ID 建立或确认 DNS 路由：

   ```bash
   env -u TUNNEL_FORCE_PROVISIONING_DNS cloudflared tunnel route dns "$tunnel_id" "$domain"
   ```

   相同路由可重复执行；域名已指向其他目标时报告冲突，不加 `--overwrite-dns`。缺少配置、凭据或 DNS 管理授权时明确报告缺项，不改用随机 trycloudflare 域名。
5. 复用 `t2i-explorer-tunnel.service`。不存在时创建用户 unit，设置 `After=network-online.target t2i-explorer.service`、`Requires=t2i-explorer.service`、`Restart=on-failure`、`RestartSec=5`、`WantedBy=default.target`，并填写实际路径：

   ```ini
   ExecStart=<absolute-cloudflared> --no-autoupdate --config <absolute-tunnel-config> tunnel run
   ```

   执行 `systemctl --user daemon-reload`，启用这两个 unit，重启应用并通过下述本地检查后，再重启 tunnel。已有同一 tunnel 的进程应复用其服务管理器，不另启携带旧 ingress 的重复 connector。没有用户 systemd 会话时，报告环境限制和具体启动命令。

## 验收与排错

等待应用健康最多 60 秒，每次 curl 超时 10 秒；失败时查看日志，不无限重启。检查：

```bash
curl --fail --silent --show-error --max-time 10 "$origin/api/health"
curl --fail --silent --show-error --max-time 10 -H "Host: $domain" "$origin/api/health"
curl --fail --silent --show-error --max-time 10 -H "Host: $domain" "$origin/api/catalog"
curl --silent --show-error --max-time 15 -D - "https://$domain/api/health"
```

前两个响应应为 `{"status":"ok"}`；catalog 应返回 JSON。公网检查状态码、Content-Type 和正文，不能把 Cloudflare 错误页或 Access 登录页当作应用健康。已有 Access 认证时保留策略并说明需要登录；分别报告本地健康与公网验证结果。502 先核对 origin 端口和服务，403 先区分 Host 拒绝与 Access，域名不匹配先检查 ingress 命中和 DNS 路由。

最后给出公网地址、本地地址、服务状态和日志命令。仅编写或离线验证本 skill 时，不修改 DNS 或重启真实服务；可用临时配置检查 ingress，用独立测试端口验证 Host 白名单。
