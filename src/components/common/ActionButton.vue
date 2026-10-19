<script setup lang="ts">
defineProps<{ label: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button class="action-button" :class="`is-${variant ?? 'secondary'}`" :disabled="disabled || loading" @click="$emit('click')">
    <span v-if="loading" class="spinner" aria-hidden="true" />
    <slot />
    <span>{{ loading ? '处理中…' : label }}</span>
  </button>
</template>
