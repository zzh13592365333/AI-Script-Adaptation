import type { AiAdapter } from './adapter'
import { HttpAiAdapter } from './http-adapter'
import { MockAiAdapter } from './mock-adapter'

export function createAiAdapter(env?: { VITE_AI_ADAPTER?: string; VITE_API_BASE_URL?: string }): AiAdapter {
  const runtimeEnv = env ?? import.meta.env
  return runtimeEnv.VITE_AI_ADAPTER === 'http'
    ? new HttpAiAdapter(runtimeEnv.VITE_API_BASE_URL ?? '/api')
    : new MockAiAdapter()
}

export type * from './adapter'
