import { createRouter, createWebHistory } from 'vue-router';
import Layout from '../views/Layout.vue';
import LoginView from '../views/LoginView.vue';
import DashboardView from '../views/DashboardView.vue';
import GroupPolicyView from '../views/GroupPolicyView.vue';
import MessageStreamView from '../views/MessageStreamView.vue';
import AuditLogView from '../views/AuditLogView.vue';
import GatewayConnectView from '../views/GatewayConnectView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: LoginView,
      meta: { public: true },
    },
    {
      path: '/',
      component: Layout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: DashboardView,
          meta: { title: '网关遥测大盘' },
        },
        {
          path: 'connection',
          name: 'GatewayConnect',
          component: GatewayConnectView,
          meta: { title: '网关节点连接' },
        },
        {
          path: 'groups',
          name: 'GroupPolicy',
          component: GroupPolicyView,
          meta: { title: '多群策略编排' },
        },
        {
          path: 'messages',
          name: 'MessageStream',
          component: MessageStreamView,
          meta: { title: '实时对话流' },
        },
        {
          path: 'audit',
          name: 'AuditLog',
          component: AuditLogView,
          meta: { title: '终端与审计控制台' },
        },
      ],
    },
  ],
});

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('hub_token');
  if (!to.meta.public && !token) {
    next('/login');
  } else if (to.path === '/login' && token) {
    next('/dashboard');
  } else {
    next();
  }
});

export default router;
