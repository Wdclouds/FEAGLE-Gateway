<template>
  <div class="login-wrapper">
    <div class="login-card">
      <div class="card-header">
        <div class="logo">🦅</div>
        <h2 class="title">FEAGLE Hub</h2>
        <p class="subtitle">AI Agent 智能体多群治理与控制中台</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" class="login-form">
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="管理员账号 (默认: admin)"
            size="large"
            :prefix-icon="User"
          />
        </el-form-item>

        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="访问密码 (默认: admin123)"
            size="large"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-button
          type="primary"
          size="large"
          class="login-btn"
          :loading="loading"
          @click="handleLogin"
        >
          准入验证与登录
        </el-button>
      </el-form>

      <div class="login-footer">
        <span>默认凭据：admin / admin123</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: 'admin',
  password: '',
});

const rules = {
  username: [{ required: true, message: '请输入管理员账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入访问密码', trigger: 'blur' }],
};

async function handleLogin() {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    loading.value = true;
    try {
      await authStore.login(form.username, form.password);
      ElMessage.success('身份验证通过，进入控制大盘');
      router.push('/dashboard');
    } catch {
      // 错误由 Axios 拦截器统一处理并展示
    } finally {
      loading.value = false;
    }
  });
}
</script>

<style scoped>
.login-wrapper {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 20%, #1e293b 0%, #0b0f19 80%);
}
.login-card {
  width: 420px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid #334155;
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}
.card-header {
  text-align: center;
  margin-bottom: 32px;
}
.logo {
  font-size: 42px;
  margin-bottom: 8px;
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 6px 0;
  letter-spacing: 0.5px;
}
.subtitle {
  font-size: 13px;
  color: #94a3b8;
  margin: 0;
}
.login-form :deep(.el-input__wrapper) {
  background-color: #0f172a;
  border: 1px solid #334155;
  box-shadow: none;
  border-radius: 8px;
  color: #f8fafc;
}
.login-form :deep(.el-input__wrapper.is-focus) {
  border-color: #38bdf8;
  box-shadow: 0 0 0 1px #38bdf8;
}
.login-btn {
  width: 100%;
  border-radius: 8px;
  font-weight: 600;
  margin-top: 8px;
  background-color: #0284c7;
  border-color: #0284c7;
}
.login-btn:hover {
  background-color: #0369a1;
  border-color: #0369a1;
}
.login-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: #64748b;
}
</style>
