import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import './assets/main.css';
import { useThemeStore } from './stores/themeStore';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// 初始化主题（纯黑夜间 / 明亮白昼）
const themeStore = useThemeStore();
themeStore.applyTheme();

app.mount('#app');
