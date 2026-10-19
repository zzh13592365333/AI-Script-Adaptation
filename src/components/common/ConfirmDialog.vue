<script setup lang="ts">
defineProps<{ open: boolean; title: string; message: string }>()
defineEmits<{ confirm: []; cancel: [] }>()
</script>
<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="$emit('cancel')">
    <section class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2><p>{{ message }}</p>
      <div class="dialog-actions"><button class="text-button" @click="$emit('cancel')">取消</button><button class="action-button is-danger" @click="$emit('confirm')">确认</button></div>
    </section>
  </div>
</template>
