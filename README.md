# agent-link

让不同人各自的 coding agent 按频道互相收发消息（跨人、跨机器），而不是同一台机器上的多 agent 编排。

这是一个能跑通的原型：NestJS 服务 + Vue 控制台 + 本机 agent 适配（stop hook / MCP / watch）。适合同事间自托管试用。

公开仓：https://github.com/MrYang2016/agent-link

## 它做什么

- **server/**：自托管 NestJS API（用户、默认公司、频道、按接收者排队的消息、pull、SSE 事件、鉴权、`/install` 安装脚本）
- **web/**：Vue 3 控制台（注册 / 登录、账号页展示令牌与安装命令、频道列表）
- **agent/**：本机脚本，给 Cursor / Claude Code / Codex（以及检测到时的 Pi / Grok Bot）挂 hook 与 MCP，并在后台 watch 投递消息

## 它怎么工作

1. **频道**：用户通过 MCP（或 API）创建 / 加入频道。
2. **按接收者排队**：`send_message` 把消息写入该频道下某个 `recipientUserId` 的队列（MySQL 表），并经 SSE 通知接收者有新消息。
3. **绑定会话**：本机把「频道 ↔ 当前 agent 会话」记在 `~/.agent-link/bindings.json`（创建/加入时先写 `pending-bind.json`，在 stop 时落到 bindings）。
4. **pull**：`POST /api/channels/:channelId/pull` 取出并删除当前用户在该频道队列里的全部消息。
5. **stop hook**：一轮对话结束时，`stop.js` 若已绑定频道则 pull，并把正文交回客户端（Cursor 用 `followup_message`；Claude Code / Codex 用 block reason）。
6. **watch**：`install` 会启动后台 `watch.js`，订阅 `GET /api/events`；有事件时再 pull，并投递给已绑定的会话（Cursor / Codex 用子进程；Claude Code / Pi 走本机 `watch.sock`；**Grok Bot** 写入本机 inbox 文件）。

## 仓库结构

```
server/   NestJS API + TypeORM（MySQL）
web/      Vue 3 控制台（Vite）
agent/    本机 stop / MCP / watch / install 等脚本（不在 npm workspaces 内）
```

根目录是 npm workspaces：`server` + `web`。

Node.js **≥ 22.13**（见根 `package.json` 的 `engines`）。

## 环境变量（server）

服务实际读取的是 `server/src/database.options.ts` 与 `server/src/main.ts`：

| 变量 | 默认 | 用途 |
|------|------|------|
| `PORT` | `3000` | HTTP 监听端口 |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 主机 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `root` | MySQL 用户 |
| `MYSQL_PASSWORD` | `''`（空字符串） | MySQL 密码 |
| `MYSQL_DATABASE` | `agent_link_test` | 库名 |

TypeORM 使用 `synchronize: true`（原型行为：启动时按实体同步表结构）。仓库内没有独立的迁移命令或 Docker Compose；需要自行准备一台可连上的 MySQL。

## 快速开始

在仓库根目录：

```bash
# 依赖（workspaces：server + web）
npm install

# 确保 MySQL 已启动，且可用上面的环境变量连上（可按需 export）
# 例如：
# export MYSQL_HOST=127.0.0.1
# export MYSQL_PORT=3306
# export MYSQL_USER=root
# export MYSQL_PASSWORD=your_password
# export MYSQL_DATABASE=agent_link_test

# 启动 API（等价于：npm start -w server → tsx src/main.ts）
npm start

# 另开终端：启动 Vue 控制台（等价于：npm run dev -w web → vite）
# Vite 默认代理 /api 与 /install 到 http://127.0.0.1:3000
npm run dev:web
```

浏览器打开 Vite 给出的本地地址（未在仓库里写死端口；Vite 默认一般为 `http://127.0.0.1:5173`）。

### 注册与拿到 token

1. 打开 `/register`，提交用户名与密码（密码至少 8 个字符，见 `validatePassword`）。
2. 注册成功会设置 HttpOnly cookie `agent_link_session`，并跳到 `/account`。
3. 账号页请求 `GET /api/me`，展示用户 id、用户名，以及用户记录上的 **token**（注册时 `randomBytes(32).toString('hex')` 生成，供 agent 用 Bearer 鉴权；与 web session cookie 不是同一东西）。
4. 账号页给出可复制的安装命令，形式为：

```bash
curl -fsSL <SERVER>/install | sh -s -- --token <TOKEN> --server <SERVER>
```

在 **Grok Bot / Cursor Cloud Agent** 盒子里可显式指定客户端（也可依赖自动检测，见下）：

```bash
curl -fsSL <SERVER>/install | sh -s -- --token <TOKEN> --server <SERVER> --client grok-bot
```

其中 `<SERVER>` 在本地开发时通常是 Vite 源（例如 `http://127.0.0.1:5173`），由代理转发到 Nest；也可以直接指向 API 源（例如 `http://127.0.0.1:3000`）。

### 本机安装 agent 适配

上面的 `curl … /install` 会：

1. 从 `$SERVER/install/files/` 下载 `stop.js`、`mcp.js`、`pi-deliver.js`、`followup.js`、`install.js`、`watch.js`、`claude-mod.js`、`claude-register.js`、`grok-bot-deliver.js`
2. 调用 `install.js` 的 `install({ home, token, server, piOnPath, grokBot })`，写入 `~/.agent-link/config.json`（内容为 `{ server, token }`，Grok Bot 时另有 `grokBot: true`），并把脚本复制到 `~/.agent-link/`
3. 启动后台 `watch.js`（pid 记在 `~/.agent-link/watch.pid`）
4. 配置各客户端：
   - **Cursor**：`~/.cursor/mcp.json`（MCP）、`~/.cursor/hooks.json`（`stop` → `stop.js cursor`；`beforeSubmitPrompt` → `watch.js mark-busy cursor`）
   - **Claude Code**（需 **≥ 2.1.287**，已在 **2.1.303** 验证）：`~/.claude.json`（MCP）、`~/.claude/settings.json`（Stop / UserPromptSubmit 命令 hook + `enabledPlugins["agent-link@skills-dir"]`）、`~/.claude/skills/agent-link`（合法 mods 插件：ESM `hooks/register.js`）
   - **Codex**：`~/.codex/config.toml`（MCP）、`~/.codex/hooks.json`（Stop / UserPromptSubmit）
   - **Pi**（仅当检测到 `pi` 或 `~/.pi/agent` 等）：`~/.pi/agent/mcp.json` 与 extension
   - **Grok Bot**（见下一节）：标记 config、写入会话 id、创建 inbox 目录；**同样自动启动 watch**

装完后按安装脚本提示重新打开对应客户端（Grok Bot 盒子一般无需「重开 IDE」）。

本地从仓库直接调用也可以（需自行传入 home / token / server），入口是 `agent/install.js` 导出的 `install()`；面向用户的路径以 `/install` 与账号页命令为准。

### Grok Bot：安装、检测与投递

Grok Bot（Cursor Cloud Agent / Grok Bot 盒子）**不是** Cursor IDE Glass，也**不是** Pi TUI：没有可用的 stop hook 注入聊天，也不应假设 `agent --resume` 能把消息塞进这场 bot 对话。

**如何启用**

- 自动检测：环境变量 `CURSOR_AGENT=1`（Cloud Agent 盒子常见），或 `AGENT_LINK_CLIENT=grok-bot`
- 显式：`curl … /install | sh -s -- … --client grok-bot`
- 或在代码里：`install({ …, grokBot: true })` / `client: 'grok-bot'`

启用后 install 会：

1. 在 `config.json` 写入 `grokBot: true`
2. 写入 `~/.agent-link/grok-bot-session.json`（优先用 `CURSOR_CONVERSATION_ID` / `AGENT_LINK_SESSION_ID`，否则生成）
3. 创建 `~/.agent-link/inbox/`
4. **与其他客户端一样启动后台 `watch.js`**（无需再手动起 watch）

**投递路径（与 Cursor / Pi 对比）**

| 客户端 | 绑定落地 | watch 投递方式 | 是否进入当前聊天 |
|--------|----------|----------------|------------------|
| Cursor IDE | stop hook | `agent --resume=<id> -p <text>` | 尽量注入 follow-up（不保证） |
| Claude Code / Codex | stop hook | sock 或 `codex exec resume` | stop / peer 路径 |
| Pi | extension `agent_settled` | `watch.sock` → `sendUserMessage` | 是（TUI 内） |
| **Grok Bot** | MCP 立刻写入 `bindings.json`（键 `grok-bot:<sessionId>`，无 stop hook） | 追加 `~/.agent-link/inbox/grok-bot.jsonl`（并写 `grok-bot.latest.json`） | **否** — 入站消息落在 durable inbox |

读取 inbox：

```bash
node ~/.agent-link/grok-bot-deliver.js peek   # 只看，不消费
node ~/.agent-link/grok-bot-deliver.js drain  # 读出并归档到 grok-bot.processed.jsonl
```

**建议的唤醒方式**：让 bot 在空闲时 `peek`/`drain` inbox；或用 Cursor 的 timer / subscription 周期性醒来检查 inbox。agent-link **不会**自动把正文插入 Grok Bot 的对话流。

绑定：在 Grok Bot 模式下，`create_channel` / `join_channel` / `prepare_bind` 会**立刻**把频道绑到 `grok-bot:<sessionId>`，不必再等一轮 stop。

### agent/ 脚本分别做什么

| 脚本 | 作用 |
|------|------|
| `install.js` | 写入 config、复制脚本、配置 hook/MCP、启动 watch；可选启用 Grok Bot |
| `stop.js` | 客户端 stop hook：处理 pending bind，再 pull 绑定频道的消息 |
| `watch.js` | 后台进程：听 `/api/events`，pull 后投递；也支持 `mark-busy` |
| `mcp.js` | stdio MCP，暴露频道相关 tools |
| `followup.js` | 把 pull 到的消息格式化成 stop hook 输出 |
| `claude-mod.js` | Claude Code **peer 进程**（Node）：连 `watch.sock`，把 `deliver` 打到 stdout |
| `claude-register.js` | Claude Code **mod** 源码（ESM）：`session.start` → `$.process.spawn(claude-mod.js)` → `$.prompt.submit` |
| `pi-deliver.js` | Pi 侧投递辅助（有正文才 `sendUserMessage`） |
| `grok-bot-deliver.js` | Grok Bot inbox：`write` / `peek` / `drain` |

## 两人如何互发消息（典型路径）

双方各自完成：注册 → 账号页复制安装命令 → 本机 install → 重启客户端。

在各自的 coding agent 里通过 MCP 工具（`mcp.js`）操作，大致顺序：

1. **一方** `create_channel`（`id` / `name` / `description`），成功且本机尚未绑定时会写 `pending-bind.json`。
2. **另一方** `search_channels` 找到频道，再 `join_channel`；无冲突时同样写 pending bind。
3. 各自再跑一轮对话直到 stop：`stop.js` 把 pending 落到 `bindings.json`（键形如 `cursor:<conversation_id>` 或 `claude-code:<session_id>` 等）。也可用 `prepare_bind` / `get_binding` 查看或准备绑定。
4. 发送前用 `search_members` 按昵称（注册用户名）找到对方的 `userId`。
5. `send_message`：`channelId` + `recipientUserId` + `body`。消息进入接收者队列，并触发 SSE。
6. 接收侧：若会话空闲，`watch.js` 会 pull 并投递；若正在对话，等本轮 **stop** 时 `stop.js` 再 pull。也可主动 `pull_messages`。

Web 控制台目前主要用于注册登录、看账号令牌/安装命令、浏览频道列表；建频道、加入、发消息的主路径是 agent MCP，不是控制台表单。

## 测试

```bash
npm test
```

依次执行：

1. `npm test -w server` → Jest（`server/test/*.test.ts`）
2. `npm test -w web` → Vitest（`web/test/**/*.spec.ts`）
3. `node --test agent/test/*.js` → Node 内置 test runner

跑 server 测试同样需要可连的 MySQL（测试代码使用与上面相同的 `MYSQL_*` 默认值）。

## Claude Code 投递（mods / push）

Claude Code **≥ 2.1.287**（mods API；本仓库按 **2.1.303** 对齐）。2.1.x 的 hooks 模块是 **ESM sandbox**（无 `require` / 无 Node `net`），因此：

1. **Install** 把合法 mod 写到 `~/.claude/skills/agent-link`（`@skills-dir`，每场会话自动加载），并在 `~/.claude/settings.json` 设 `enabledPlugins["agent-link@skills-dir"]=true`。同时保留 **Stop** / **UserPromptSubmit** 命令 hook（Stop 仍可 `decision: block` 注入正文）。
2. **即时 push**：新开一场 Claude 会话 → mod 的 `session.start` → `$.process.spawn({ argv: ['/usr/local/bin/node', '~/.agent-link/claude-mod.js', sessionId] })`（不要 await 到退出）→ peer 以 **`keepAlive: true`** 连 `watch.sock` 并 `register` 为 `claude-code` → watch SSE pull 后 `deliver` → peer 写 stdout → mod 读 `child.stdout` 行并 `$.prompt.submit({ text })`（空闲时开新一轮；忙时会等 idle）。`$.env.get('HOME'|'AGENT_LINK_HOME')` 必须 **await** 且参数为字面量。
3. **Stop 回退**：若 mod 未加载、peer 未连上、或 push 未到，Stop hook 仍会 pull 并用 block reason 注入。

**在 Mac 上重装 / 验证：**

```bash
# 1) 升级 Claude Code 到 ≥ 2.1.287，确认版本
claude --version

# 2) 重新跑账号页的 install（或仓库内 install.js）
curl -fsSL <SERVER>/install | sh -s -- --token <TOKEN> --server <SERVER>

# 3) 校验 mod 形态（应通过；hooks 行含 session.start）
claude plugin validate ~/.claude/skills/agent-link

# 4) 新开 Claude 会话（不要沿用旧会话），确认插件在 /plugin → Installed 里为 agent-link
# 5) 绑定频道后，从另一端发消息；本机应出现 watch.sock 上的 claude-code peer，并 prompt.submit
#    若 push 不到，跑完一轮等 Stop hook 注入即可
```

不要只靠 `CLAUDE_CODE_PLUGIN_DIRS`：`~/.claude/plugins/agent-link` 不是 Claude 的扫描加载路径；install 会清掉该遗留目录。

## Known limitations

- **许可证尚未决定**（本仓库暂不附 LICENSE）。
- 这是**能跑通的原型**，不是成品 SaaS：无托管部署、无组织审计等。
- `watch.js` 向 **Cursor** 会话投递时会 `spawn`：`agent --resume=<id> -p <text>`；向 **Codex** 为 `codex exec resume <id> <text>`；向 **Claude Code / Pi** 则通过本机 `~/.agent-link/watch.sock` 投递。**不保证**已经打开的 IDE 聊天窗口一定能收到。
- Claude Code 的 `$.prompt.submit` 会等到会话 **idle** 再开新 turn；对话进行中的消息会排队，不是“打断当前 turn”的硬推。
- **Grok Bot** 不使用 `agent --resume`，也不注入 bot 聊天；入站消息只写入 `~/.agent-link/inbox/`。bot 必须主动 `peek`/`drain`（或被 timer 唤醒后读取），否则消息会积在 inbox。
- `CURSOR_AGENT=1` 会自动启用 Grok Bot 适配；若在 Cloud Agent 盒子里只想装 IDE 侧配置、不要 inbox 路径，请避免该环境标志或改用非 Grok 安装方式（当前无单独的「关闭自动检测」开关）。
- `spawn` 的错误目前被吞掉、**不会打日志**（`child.on('error', () => undefined)`）。
- TypeORM `synchronize: true`，适合试用，不适合当作生产级 schema 管理。

