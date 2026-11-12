import { createRouter, createWebHashHistory } from 'vue-router';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/overview',
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('../components/overview/OverviewView.vue'),
    },
    {
      path: '/channels',
      name: 'channels',
      component: () => import('../components/channels/ChannelsView.vue'),
    },
    {
      path: '/tools',
      name: 'tools',
      component: () => import('../components/tools/ToolsView.vue'),
    },
    {
      path: '/logs',
      name: 'logs',
      component: () => import('../components/logs/LogsView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../components/settings/SettingsView.vue'),
    },
  ],
});

export default router;
