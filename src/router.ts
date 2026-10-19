import { createRouter, createWebHashHistory } from 'vue-router'

const Placeholder = { template: '<main>自动AI漫剧流程</main>' }

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: Placeholder }]
})
