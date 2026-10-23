export interface PromptTemplate {
  id: string
  name: string
  version: string
  systemPrompt: string
  userTemplate: string
}

export const promptTemplates = {
  sourceAnalysis: {
    id: 'source-analysis', name: '原稿分析', version: '1.1',
    systemPrompt: '你是资深AI漫剧编剧策划和视觉叙事顾问。只分析原稿，不续写。',
    userTemplate: '分析以下原稿，输出题材、核心卖点、人物关系、冲突、反转、结构、视觉化场景和漫剧创作建议。\n原稿：\n{{sourceText}}'
  },
  adaptationSetup: {
    id: 'adaptation-setup', name: '漫剧设定', version: '1.1',
    systemPrompt: '你负责把故事整理为可持续生产的AI漫剧设定方案。',
    userTemplate: '目标受众与形式：{{targetMarket}}\n原稿分析：{{sourceAnalysis}}\n额外要求：{{instruction}}\n输出创作方向、画面风格、主角身份、世界观和主要人物。'
  },
  seriesPlanning: {
    id: 'series-planning', name: '全剧规划', version: '1.1',
    systemPrompt: '你负责规划节奏紧凑、冲突持续升级、画面节点明确的AI漫剧。',
    userTemplate: '根据漫剧设定规划 {{episodeCount}} 集，每集约 {{targetWords}} 字。\n漫剧设定：{{adaptation}}\n输出剧名候选、类型、总纲和阶段剧情。'
  },
  episodeOutlines: {
    id: 'episode-outlines', name: '分集大纲', version: '1.1',
    systemPrompt: '你负责将全剧总纲拆分为连续、不重复且便于画面制作的分集大纲。',
    userTemplate: '将以下规划拆为 {{episodeCount}} 集。每集包含目标、开场画面钩子、主要事件、视觉高潮、反转与结尾悬念。\n{{seriesPlan}}'
  },
  episodeExpansion: {
    id: 'episode-expansion', name: '逐集扩写', version: '1.1',
    systemPrompt: '你负责输出可直接用于AI画面制作的漫剧分场脚本，只输出正文。',
    userTemplate: '扩写第 {{episodeNumber}} 集，目标 {{targetWords}} 字。每场明确场景、人物、动作、情绪、对白与关键画面。\n人物与世界观：{{context}}\n上一集摘要：{{previousSummary}}\n本集大纲：{{outline}}'
  },
  episodeRewrite: {
    id: 'episode-rewrite', name: '单集重写', version: '1.1',
    systemPrompt: '你负责在保持人物与剧情连续性的前提下按要求重写漫剧分场脚本。',
    userTemplate: '修改要求：{{instruction}}\n本集大纲：{{outline}}\n当前剧本：{{script}}'
  }
} satisfies Record<string, PromptTemplate>

export type PromptTemplateId = keyof typeof promptTemplates

export function getPromptTemplates(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): typeof promptTemplates {
  const templates = JSON.parse(JSON.stringify(promptTemplates)) as typeof promptTemplates
  if (!storage) return templates
  try {
    const raw = storage.getItem('ai-comic-workflow.prompts.v1')
      ?? storage.getItem('adaptation-workbench.prompts.v1')
      ?? '{}'
    const saved = JSON.parse(raw) as Partial<typeof promptTemplates>
    for (const key of Object.keys(templates) as PromptTemplateId[]) Object.assign(templates[key], saved[key] ?? {})
  } catch { /* Invalid overrides fall back to defaults. */ }
  return templates
}
