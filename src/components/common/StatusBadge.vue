<script setup lang="ts">
import type { NodeStatus } from '@/domain/project'
defineProps<{ status: NodeStatus }>()
const labels: Record<NodeStatus, string> = { empty: '未开始', generating: '生成中', ready: '待确认', confirmed: '已确认', dirty: '需更新', error: '失败' }
</script>
<template><span class="status-badge" :class="`status-${status}`">{{ labels[status] }}</span></template>
