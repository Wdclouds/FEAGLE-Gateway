import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiClient } from '../api/client';

export interface User {
  id: number;
  username: string;
  role: string;
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string>(localStorage.getItem('hub_token') || '');
  const user = ref<User | null>(
    JSON.parse(localStorage.getItem('hub_user') || 'null'),
  );

  const isAuthenticated = () => Boolean(token.value);

  async function login(username: string, password: string) {
    const res: any = await apiClient.post('/auth/login', { username, password });
    token.value = res.token;
    user.value = res.user;
    localStorage.setItem('hub_token', res.token);
    localStorage.setItem('hub_user', JSON.stringify(res.user));
    return res;
  }

  function logout() {
    token.value = '';
    user.value = null;
    localStorage.removeItem('hub_token');
    localStorage.removeItem('hub_user');
    window.location.href = '/login';
  }

  return {
    token,
    user,
    isAuthenticated,
    login,
    logout,
  };
});
