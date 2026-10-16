import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const FILE_NAMES = new Set([
  'stop.js',
  'mcp.js',
  'pi-deliver.js',
  'followup.js',
  'install.js',
  'watch.js',
  'claude-mod.js',
]);

function agentDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '../../../agent'),
    path.resolve(process.cwd(), 'agent'),
    path.resolve(process.cwd(), '../agent'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'install.js'))) return candidate;
  }
  return candidates[0];
}

const SHELL = [
  '#!/bin/sh',
  'set -eu',
  'TOKEN=""',
  'SERVER=""',
  'HOME_DIR="${HOME}"',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    --token)',
  '      TOKEN="$2"',
  '      shift 2',
  '      ;;',
  '    --server)',
  '      SERVER="$2"',
  '      shift 2',
  '      ;;',
  '    --home)',
  '      HOME_DIR="$2"',
  '      shift 2',
  '      ;;',
  '    *)',
  '      echo "unknown argument: $1" >&2',
  '      exit 1',
  '      ;;',
  '  esac',
  'done',
  'if [ -z "$TOKEN" ] || [ -z "$SERVER" ]; then',
  '  echo "usage: install --token TOKEN --server SERVER" >&2',
  '  exit 1',
  'fi',
  'SERVER="${SERVER%/}"',
  'TMP="$(mktemp -d)"',
  'trap \'rm -rf "$TMP"\' EXIT',
  'for name in stop.js mcp.js pi-deliver.js followup.js install.js watch.js claude-mod.js; do',
  '  curl -fsSL "$SERVER/install/files/$name" -o "$TMP/$name"',
  'done',
  'PI_ON_PATH=false',
  'if command -v pi >/dev/null 2>&1; then',
  '  PI_ON_PATH=true',
  'fi',
  'export HOME_DIR TOKEN SERVER PI_ON_PATH TMP',
  'node -e \'const { install } = require(process.env.TMP + "/install.js"); install({ home: process.env.HOME_DIR, token: process.env.TOKEN, server: process.env.SERVER, piOnPath: process.env.PI_ON_PATH === "true" });\'',
  'echo "agent-link 已安装"',
  'echo "令牌已写入 $HOME_DIR/.agent-link/config.json，不用再单独配置。"',
  'echo "服务地址：$SERVER"',
  'echo "已配置 Cursor、Claude Code、Codex 的 MCP 和 hook。"',
  'if [ "$PI_ON_PATH" = true ]; then',
  '  echo "已配置 Pi。"',
  'else',
  '  echo "未发现 pi 命令，这次没有配置 Pi。"',
  'fi',
  'echo "请重新打开这些客户端，让它们读到新配置。"',
  '',
].join('\n');

@Controller()
export class InstallController {
  @Get('install')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  shell(): string {
    return SHELL;
  }

  @Get('install/files/:name')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  file(@Param('name') name: string): string {
    if (!FILE_NAMES.has(name) || name.includes('/') || name.includes('..')) {
      throw new NotFoundException({ error: 'not_found' });
    }
    const filePath = path.join(agentDirectory(), name);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException({ error: 'not_found' });
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}
