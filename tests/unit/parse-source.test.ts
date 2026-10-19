import { describe, expect, it } from 'vitest'
import { parseSource, sourceTextForAnalysis } from '@/features/files/parse-source'

describe('source parsing', () => {
  it('parses a txt file into a source document', async () => {
    const file = new File(['第一章\n雨夜的电话。'], 'story.txt', { type: 'text/plain' })
    const result = await parseSource(file)
    expect(result.name).toBe('story.txt')
    expect(result.type).toBe('txt')
    expect(result.characterCount).toBeGreaterThan(5)
    expect(result.chapters[0].title).toBe('第一章')
  })

  it('samples the beginning, middle and end of long sources for faster analysis', () => {
    const source = `${'A'.repeat(40_000)}${'B'.repeat(40_000)}${'C'.repeat(40_000)}`
    const result = sourceTextForAnalysis(source)
    expect(result.text.length).toBeLessThan(25_000)
    expect(result.text).toContain('A'.repeat(100))
    expect(result.text).toContain('B'.repeat(100))
    expect(result.text).toContain('C'.repeat(100))
    expect(result.truncated).toBe(true)
  })

  it('rejects unsupported files', async () => {
    await expect(parseSource(new File(['x'], 'story.pdf'))).rejects.toThrow('TXT、DOCX 或 EPUB')
  })
})
