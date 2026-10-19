<script setup lang="ts">
import { CheckCircle2, Circle, Lock, RefreshCw } from 'lucide-vue-next'
import type { EpisodeOutline, EpisodeScript } from '@/domain/project'
defineProps<{ items: Array<EpisodeOutline | EpisodeScript>; selected: number; mode: 'outline' | 'script' }>()
defineEmits<{ select: [episodeNumber: number] }>()
</script>
<template>
  <div class="episode-list">
    <button v-for="item in items" :key="item.episodeNumber" :class="{ selected: selected === item.episodeNumber }" @click="$emit('select', item.episodeNumber)">
      <span class="episode-number">{{ String(item.episodeNumber).padStart(2, '0') }}</span>
      <span class="episode-list-copy"><strong>{{ mode === 'outline' ? ((item as EpisodeOutline).title || `第 ${item.episodeNumber} 集`) : `第 ${item.episodeNumber} 集剧本` }}</strong><small>{{ item.status === 'confirmed' ? '已确认' : item.status === 'dirty' ? '需要更新' : item.status === 'ready' ? '待确认' : item.status === 'generating' ? '生成中' : '未生成' }}</small></span>
      <Lock v-if="mode === 'outline' && (item as EpisodeOutline).locked" :size="14" />
      <RefreshCw v-else-if="item.status === 'dirty'" :size="14" />
      <CheckCircle2 v-else-if="item.status === 'confirmed'" :size="15" />
      <Circle v-else :size="14" />
    </button>
  </div>
</template>
