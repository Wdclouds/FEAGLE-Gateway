export interface ToolContext {
  chatId: string;
  senderWxid: string;
  senderName: string;
  isGroup: boolean;
  isAdmin: boolean;
}

export interface GatewayTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}

export interface ChannelMemo {
  content: string;
  category: string;
  sender?: string;
  ts: number;
}
