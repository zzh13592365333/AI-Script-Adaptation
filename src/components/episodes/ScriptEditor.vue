<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import type { EpisodeScript } from '@/domain/project'
import ActionButton from '@/components/common/ActionButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
withDefaults(defineProps<{ script: EpisodeScript; confirmationDisabled?: boolean; showConfirmation?: boolean }>(), {
  showConfirmation: true
})
defineEmits<{ update: [content: string]; confirm: [] }>()
</script>
<template>
  <section class="episode-editor script-editor">
    <header><div><span>EPISODE {{ String(script.episodeNumber).padStart(2, '0') }}</span><h2>剧本正文</h2></div><StatusBadge :status="script.status" /></header>
    <textarea class="script-textarea" :value="script.content" placeholder="生成后的剧本会逐段显示在这里。" @input="$emit('update', ($event.target as HTMLTextAreaElement).value)" />
    <footer><span v-if="script.partial" class="partial-note">生成已中断，已保留当前内容</span><span v-else /><ActionButton v-if="showConfirmation" label="确认本集" variant="primary" :disabled="!script.content || confirmationDisabled" @click="$emit('confirm')"><Check :size="17" /></ActionButton></footer>
  </section>
</template>
