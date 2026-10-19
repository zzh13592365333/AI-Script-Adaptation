import JSZip from 'jszip'
import mammoth from 'mammoth'
import type { SourceDocument } from '@/domain/project'

const ANALYSIS_LIMIT = 24_000
const ANALYSIS_HEAD_LENGTH = 10_000
const ANALYSIS_MIDDLE_LENGTH = 7_000
const ANALYSIS_TAIL_LENGTH = 7_000

function readBlob(blob: Blob, mode: 'text'): Promise<string>
function readBlob(blob: Blob, mode: 'arrayBuffer'): Promise<ArrayBuffer>
function readBlob(blob: Blob, mode: 'text' | 'arrayBuffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.onload = () => resolve(reader.result as string | ArrayBuffer)
    if (mode === 'text') reader.readAsText(blob)
    else reader.readAsArrayBuffer(blob)
  })
}

export function sourceTextForAnalysis(text: string): { text: string; truncated: boolean } {
  if (text.length <= ANALYSIS_LIMIT) return { text, truncated: false }
  const middleStart = Math.max(ANALYSIS_HEAD_LENGTH, Math.floor((text.length - ANALYSIS_MIDDLE_LENGTH) / 2))
  const sampled = [
    `【原稿开头节选】\n${text.slice(0, ANALYSIS_HEAD_LENGTH)}`,
    `【原稿中段节选】\n${text.slice(middleStart, middleStart + ANALYSIS_MIDDLE_LENGTH)}`,
    `【原稿结尾节选】\n${text.slice(-ANALYSIS_TAIL_LENGTH)}`
  ].join('\n\n')
  return { text: sampled, truncated: true }
}

function chaptersFromText(text: string): SourceDocument['chapters'] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const chapters: SourceDocument['chapters'] = []
  let title = '正文'
  let buffer: string[] = []
  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content || chapters.length === 0) chapters.push({ title, content })
    buffer = []
  }
  for (const line of lines) {
    if (/^第.{1,12}[章节回](?:\s|$)/.test(line.trim())) {
      if (buffer.length) flush()
      title = line.trim()
    } else buffer.push(line)
  }
  flush()
  return chapters
}

function buildSource(name: string, type: SourceDocument['type'], text: string, chapters = chaptersFromText(text)): SourceDocument {
  return { name, type, text, chapters, characterCount: text.length, truncated: text.length > ANALYSIS_LIMIT }
}

async function parseDocx(file: File): Promise<SourceDocument> {
  const result = await mammoth.extractRawText({ arrayBuffer: await readBlob(file, 'arrayBuffer') })
  return buildSource(file.name, 'docx', result.value)
}

async function parseEpub(file: File): Promise<SourceDocument> {
  const zip = await JSZip.loadAsync(await readBlob(file, 'arrayBuffer'))
  const container = await zip.file('META-INF/container.xml')?.async('string')
  if (!container) throw new Error('EPUB 缺少 container.xml')
  const containerDoc = new DOMParser().parseFromString(container, 'application/xml')
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB 缺少内容清单')
  const opf = await zip.file(opfPath)?.async('string')
  if (!opf) throw new Error('EPUB 内容清单无法读取')
  const opfDoc = new DOMParser().parseFromString(opf, 'application/xml')
  const manifest = new Map(Array.from(opfDoc.querySelectorAll('manifest item')).map((item) => [item.getAttribute('id') ?? '', item.getAttribute('href') ?? '']))
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const chapters: SourceDocument['chapters'] = []
  for (const item of Array.from(opfDoc.querySelectorAll('spine itemref'))) {
    const href = manifest.get(item.getAttribute('idref') ?? '')
    if (!href) continue
    const html = await zip.file(`${base}${decodeURIComponent(href)}`)?.async('string')
    if (!html) continue
    const document = new DOMParser().parseFromString(html, 'text/html')
    const title = document.querySelector('h1,h2,h3,title')?.textContent?.trim() || `章节 ${chapters.length + 1}`
    const content = document.body.textContent?.replace(/\s+\n/g, '\n').trim() ?? ''
    if (content) chapters.push({ title, content })
  }
  const text = chapters.map((chapter) => `${chapter.title}\n${chapter.content}`).join('\n\n')
  if (!text) throw new Error('EPUB 中没有可读取的正文')
  return buildSource(file.name, 'epub', text, chapters)
}

export async function parseSource(file: File): Promise<SourceDocument> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'txt') return buildSource(file.name, 'txt', await readBlob(file, 'text'))
  if (extension === 'docx') return parseDocx(file)
  if (extension === 'epub') return parseEpub(file)
  throw new Error('仅支持 TXT、DOCX 或 EPUB 文件')
}
