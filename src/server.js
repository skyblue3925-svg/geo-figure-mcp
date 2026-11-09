#!/usr/bin/env node
// geo-figure-mcp 로컬 실행(stdio) — Claude 데스크톱 등에서 내 컴퓨터에 설치해 쓴다
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './tools.js';
await createServer().connect(new StdioServerTransport());
