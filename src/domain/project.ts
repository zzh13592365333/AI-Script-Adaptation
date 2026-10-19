export type NodeStatus = 'empty' | 'generating' | 'ready' | 'confirmed' | 'dirty' | 'error'
export type StageId = 'source' | 'adaptation' | 'planning' | 'outlines' | 'scripts'

export interface ContentNode {
  status: NodeStatus
  content: string
  error?: string
}

export interface SourceDocument {
  name: string
  type: 'txt' | 'docx' | 'epub' | 'sample'
  text: string
  chapters: Array<{ title: string; content: string }>
  characterCount: number
  truncated: boolean
}

export interface AdaptationSetup {
  status: NodeStatus
  direction: string
  identity: string
  world: string
  characters: string
}

export interface SeriesPlanning {
  status: NodeStatus
  title: string
  titleCandidates: string[]
  genre: string
  episodeCount: number
  targetWords: number
  seriesOutline: string
  phasePlan: string
}

export interface EpisodeOutline {
  episodeNumber: number
  title: string
  content: string
  status: NodeStatus
  locked: boolean
}

export interface EpisodeScript {
  episodeNumber: number
  content: string
  status: NodeStatus
  partial: boolean
  summaryStale: boolean
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  updatedAt: string
  activeStage: StageId
  source: SourceDocument | null
  analysis: ContentNode
  adaptation: AdaptationSetup
  planning: SeriesPlanning
  outlines: EpisodeOutline[]
  scripts: EpisodeScript[]
  overflow: { outlines: EpisodeOutline[]; scripts: EpisodeScript[] }
}

export function createOutline(episodeNumber: number): EpisodeOutline {
  return { episodeNumber, title: '', content: '', status: 'empty', locked: false }
}

export function createScript(episodeNumber: number): EpisodeScript {
  return { episodeNumber, content: '', status: 'empty', partial: false, summaryStale: false }
}

export function createProject(): Project {
  const episodeCount = 24
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: '未命名漫剧项目',
    updatedAt: new Date().toISOString(),
    activeStage: 'source',
    source: null,
    analysis: { status: 'empty', content: '' },
    adaptation: { status: 'empty', direction: '', identity: '', world: '', characters: '' },
    planning: {
      status: 'empty',
      title: '',
      titleCandidates: [],
      genre: '都市情感',
      episodeCount,
      targetWords: 1200,
      seriesOutline: '',
      phasePlan: ''
    },
    outlines: Array.from({ length: episodeCount }, (_, index) => createOutline(index + 1)),
    scripts: Array.from({ length: episodeCount }, (_, index) => createScript(index + 1)),
    overflow: { outlines: [], scripts: [] }
  }
}
