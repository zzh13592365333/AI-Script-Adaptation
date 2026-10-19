<script setup lang="ts">
import { Check, Lock, LockOpen } from 'lucide-vue-next'
import type { EpisodeOutline } from '@/domain/project'
import ActionButton from '@/components/common/ActionButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
const props = defineProps<{ outline: EpisodeOutline; confirmationDisabled?: boolean }>()
const emit = defineEmits<{ update: [title: string, content: string]; lock: []; confirm: [] }>()
</script>
<template>
  <section class="episode-editor">
    <header><div><span>EPISODE {{ String(outline.episodeNumber).padStart(2, '0') }}</span><h2>分集大纲</h2></div><StatusBadge :status="outline.status" /></header>
    <label><span>本集标题</span><input :value="outline.title" @input="emit('update', ($event.target as HTMLInputElement).value, props.outline.content)" /></label>
    <label class="grow"><span>剧情大纲</span><textarea :value="outline.content" @input="emit('update', props.outline.title, ($event.target as HTMLTextAreaElement).value)" /></label>
    <footer><ActionButton :label="outline.locked ? '解除锁定' : '锁定大纲'" variant="ghost" @click="emit('lock')"><LockOpen v-if="outline.locked" :size="17" /><Lock v-else :size="17" /></ActionButton><ActionButton label="确认本集" variant="primary" :disabled="!outline.content || confirmationDisabled" @click="emit('confirm')"><Check :size="17" /></ActionButton></footer>
  </section>
</template>
