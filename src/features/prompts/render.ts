export function renderPrompt(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in variables)) throw new Error(`缺少提示词变量：${key}`)
    return String(variables[key])
  })
}
