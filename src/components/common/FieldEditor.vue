<script setup lang="ts">
defineProps<{ modelValue: string; label: string; hint?: string; rows?: number }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <label class="field-editor">
    <span class="field-label">{{ label }}</span>
    <span v-if="hint" class="field-hint">{{ hint }}</span>
    <textarea :value="modelValue" :rows="rows ?? 5" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
  </label>
</template>
