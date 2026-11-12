export interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: Record<string, any>;
  default?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  builtin?: boolean;
  parameters: {
    type: 'object';
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
  };
}
