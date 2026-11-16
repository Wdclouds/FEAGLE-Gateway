import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { GatewayTool, ToolContext } from './types.js';

export const generateImageTool: GatewayTool = {
  name: 'generate_image',
  description: '使用大模型出图引擎（LLM_IMAGE_MODEL）根据文本描述生成高质量图片，并直接自动发送至当前微信会话中。',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '生图提示词。详细描述画面的主体、风格、构图、光影、色彩或质感（例如："一只可爱的赛博朋克风格猫咪，霓虹光影，高清细节"）',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '3:4', '4:3', '9:16', '16:9'],
        description: '画面宽高比例，默认 1:1',
      },
    },
    required: ['prompt'],
  },
  execute: async (args: { prompt: string; aspect_ratio?: string }, ctx: ToolContext) => {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return '生图提示词不能为空。';

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);

    try {
      const apiUrl = `${config.llm.baseUrl}/images/generations`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        signal: ctl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: config.llm.imageModel,
          prompt,
          n: 1,
          response_format: 'b64_json',
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return `生图服务请求失败 (HTTP ${res.status}): ${errText.slice(0, 300) || '未知上游错误'}`;
      }

      const data = (await res.json()) as any;
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        return '生图服务未返回有效图片数据。';
      }

      // 暂存至本地持久化目录
      const imgDir = join(config.channelsDir, '..', 'generated-images');
      if (!existsSync(imgDir)) {
        mkdirSync(imgDir, { recursive: true });
      }
      const filename = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
      const localFilePath = join(imgDir, filename);
      writeFileSync(localFilePath, Buffer.from(b64, 'base64'));

      // 通过网关出站批次推送到微信
      const batchPayload = {
        c: ctx.chatId,
        seq: [
          {
            img: localFilePath,
            d: 300,
          },
        ],
      };

      const pushRes = await fetch(config.bridgeOutUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!pushRes.ok) {
        return `图片已生成并保存本地（${filename}），但推送到微信出口失败 (HTTP ${pushRes.status})。`;
      }

      return `图片生成成功并已发送至微信当前会话中！提示词：“${prompt}”。本地存档路径：${filename}`;
    } catch (err: any) {
      return `生图执行异常: ${err?.message || String(err)}`;
    } finally {
      clearTimeout(timer);
    }
  },
};
