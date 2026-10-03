import axios from 'axios';
import { ElMessage } from 'element-plus';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
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
