<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RotateCcw, Save, X } from 'lucide-vue-next'
import { getPromptTemplates, promptTemplates, type PromptTemplateId } from '@/features/prompts/templates'
import ActionButton from '@/components/common/ActionButton.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const storageKey = 'ai-comic-workflow.prompts.v1'
const cloneDefaults = () => JSON.parse(JSON.stringify(promptTemplates)) as typeof promptTemplates
const templates = reactive(getPromptTemplates())
const selected = ref<PromptTemplateId>('sourceAnalysis')
const active = computed(() => templates[selected.value])
const savedNotice = ref(false)
function save() { localStorage.setItem(storageKey, JSON.stringify(templates)); savedNotice.value = true; setTimeout(() => { savedNotice.value = false }, 1200) }
function restore() {
  Object.assign(templates, cloneDefaults())
  localStorage.removeItem(storageKey)
  localStorage.removeItem('adaptation-workbench.prompts.v1')
  savedNotice.value = false
}
</script>
<template>
  <div v-if="open" class="settings-backdrop" @click.self="emit('close')">
    <aside class="settings-drawer" aria-label="提示词设置">
      <header><div><span class="eyebrow">ADVANCED</span><h2>提示词设置</h2></div><button class="icon-button" title="关闭" @click="emit('close')"><X :size="19" /></button></header>
      <p>模板会保存在当前浏览器中，接入真实 API 后可在适配层读取并发送。</p>
      <div class="prompt-tabs"><button v-for="(template, key) in templates" :key="key" :class="{ active: selected === key }" @click="selected = key as PromptTemplateId">{{ template.name }}</button></div>
      <label><span>System Prompt</span><textarea v-model="active.systemPrompt" rows="6" /></label>
      <label><span>User Template</span><textarea v-model="active.userTemplate" data-test="user-template" rows="14" /></label>
      <small>模板版本 {{ active.version }} · 请保留形如 <code v-pre>{{variable}}</code> 的变量。</small>
      <footer><ActionButton data-test="restore-prompts" label="恢复默认" variant="ghost" @click="restore"><RotateCcw :size="16" /></ActionButton><span v-if="savedNotice">已保存</span><ActionButton data-test="save-prompts" label="保存设置" variant="primary" @click="save"><Save :size="16" /></ActionButton></footer>
    </aside>
  </div>
</template>
