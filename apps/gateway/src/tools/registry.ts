import { getPersona, getSession } from '../control.js';
import type { GatewayTool, ToolContext } from './types.js';
import { webSearchTool } from './web-search.js';
import { factCheckTool } from './fact-check.js';
import { groupRemindTool } from './group-remind.js';
import { palaceMemoTool } from './palace-memo.js';
import { generateImageTool } from './generate-image.js';
import { readWechatArticleTool } from './wechat-article.js';

// 全局工具注册中心与沙箱安全守卫
const toolRegistry = new Map<string, GatewayTool>();

export function registerTool(tool: GatewayTool): void {
  toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): GatewayTool | undefined {
  return toolRegistry.get(name);
}

export function getAllTools(): GatewayTool[] {
  return Array.from(toolRegistry.values());
}

export function getToolsForChat(chatId: string, isOp = false): GatewayTool[] {
  const p = getPersona(getSession(chatId).persona_id, isOp, chatId);
  const allowed = p.allowed_mcp_tools;
  if (allowed.includes('*')) {
    return Array.from(toolRegistry.values());
  }
  return allowed.map((name) => toolRegistry.get(name)).filter(Boolean) as GatewayTool[];
}

export async function executeToolCall(
  name: string,
  rawArgs: string | Record<string, any>,
  ctx: ToolContext,
  allowedToolNames?: string[]
): Promise<string> {
  // 1. 沙箱权限拦截：如果指定了允许工具列表，必须在列表中（或通配 *）
  if (
    allowedToolNames &&
    !allowedToolNames.includes('*') &&
    !allowedToolNames.includes(name)
  ) {
    return `[安全拦截] 当前会话未启用工具 "${name}" 的执行权限。`;
  }

  const tool = toolRegistry.get(name);
  if (!tool) {
    return `[错误] 未找到名称为 "${name}" 的可用工具。`;
  }

  let parsedArgs: any;
  if (typeof rawArgs === 'string') {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      return `[错误] 工具参数格式不正确，解析 JSON 失败。`;
    }
  } else {
    parsedArgs = rawArgs;
  }

  try {
    return await tool.execute(parsedArgs, ctx);
  } catch (err: any) {
    return `[执行异常] 工具 "${name}" 运行出错: ${err?.message || String(err)}`;
  }
}

export function unregisterTool(name: string): boolean {
  if (['web_search', 'group_remind', 'palace_memo', 'generate_image', 'read_wechat_article', 'fact_check'].includes(name)) {
    return false; // 内置核心工具不可删除
  }
  return toolRegistry.delete(name);
}

export function registerCustomTool(def: {
  name: string;
  description: string;
  parameters?: any;
  endpoint?: string;
}): GatewayTool {
  const customTool: GatewayTool = {
    name: def.name,
    description: def.description,
    parameters: def.parameters || {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数或操作内容' },
      },
    },
    execute: async (args: any, ctx: ToolContext) => {
      if (def.endpoint) {
        try {
          const res = await fetch(def.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ args, ctx }),
          });
          const text = await res.text();
          return `[${def.name} 执行结果] ${text}`;
        } catch (err: any) {
          return `[${def.name} 调用失败] ${err?.message || String(err)}`;
        }
      }
      return `[自定义工具 ${def.name}] 已接收调用：${JSON.stringify(args)}`;
    },
  };
  registerTool(customTool);
  return customTool;
}

export function toOpenAiTools(tools: GatewayTool[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// 默认注册六大标准核心工具
registerTool(webSearchTool);
registerTool(factCheckTool);
registerTool(groupRemindTool);
registerTool(palaceMemoTool);
registerTool(generateImageTool);
registerTool(readWechatArticleTool);
