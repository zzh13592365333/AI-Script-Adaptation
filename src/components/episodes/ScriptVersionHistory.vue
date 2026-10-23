<script setup lang="ts">
import { History } from 'lucide-vue-next'
import type { ScriptVersion } from '@/features/script-tasks/types'

defineProps<{ versions: ScriptVersion[]; currentVersion?: number }>()
defineEmits<{ select: [content: string] }>()
</script>

<template>
  <section v-if="versions.length" class="script-version-history">
    <header><History :size="16" /><h2>版本记录</h2></header>
    <div class="version-list">
      <button
        v-for="item in versions"
        :key="item.version"
        :class="{ active: item.version === currentVersion }"
        :data-test="`version-${item.version}`"
        @click="$emit('select', item.content)"
      >
        <strong>V{{ item.version }}</strong>
        <span>{{ item.source === 'human' ? '人工编辑' : '模型生成' }}</span>
        <small>{{ item.approved ? '已批准' : '草稿' }}</small>
      </button>
    </div>
  </section>
</template>
