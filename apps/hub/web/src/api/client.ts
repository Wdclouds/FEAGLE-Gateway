import axios from 'axios';
import { ElMessage } from 'element-plus';

export function resolveApiBase(): string {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  // 自动兼容 Tauri 原生桌面环境与外部嵌入模式
  const isTauri =
    typeof (window as any).__TAURI_INTERNALS__ !== 'undefined' ||
    window.location.protocol.startsWith('tauri') ||
    window.location.protocol === 'file:';
  if (isTauri || (window.location.port !== '6200' && window.location.port !== '5173')) {
    return 'http://127.0.0.1:6200/api';
  }
  return '/api';
}

export const apiClient = axios.create({
  baseURL: resolveApiBase(),
  timeout: 10000,
});

// 请求拦截器：自动注入 JWT Token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('hub_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：统一处理 401 鉴权失效与业务错误
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('hub_token');
      localStorage.removeItem('hub_user');
      ElMessage.error('登录状态已失效，请重新登录');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else {
      const msg = error.response?.data?.error || error.message || '请求失败';
      ElMessage.error(msg);
    }
    return Promise.reject(error);
  },
);

// 网关管理 API
export const gatewayApi = {
  getConfig: () => apiClient.get('/gateway/config') as Promise<any>,
  saveConfig: (data: any) => apiClient.post('/gateway/config', data) as Promise<any>,
  probe: (data: any) => apiClient.post('/gateway/probe', data) as Promise<any>,
};

// 系统原生终端日志 API
export const systemLogsApi = {
  getLogs: (limit = 150) => apiClient.get(`/system-logs?limit=${limit}`) as Promise<any>,
  clearLogs: () => apiClient.post('/system-logs/clear') as Promise<any>,
};

// 消息收发与对话 API
export const messagesApi = {
  sendMessage: (data: { type: string; targetId: string; text: string; groupName?: string }) =>
    apiClient.post('/messages/send', data) as Promise<any>,
};
