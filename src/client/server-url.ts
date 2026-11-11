/**
 * 游戏服务端 URL 草稿解析（配置面板 URL 格式校验）。
 *
 * 规则：空值 = 清空（不发起服务端 HTTP 交互）；非空必须以 `http://` / `https://`
 * 开头，否则返回 `undefined` 使草稿非法、阻止保存（不落盘）。
 */

/** 解析结果：写值 / 清空 / 非法。 */
export type ServerUrlDraft =
  | { kind: 'set'; value: string }
  | { kind: 'clear' }
  | undefined

/** 解析一行 URL 草稿。 */
export function parseServerUrlDraft(text: string): ServerUrlDraft {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  if (!/^https?:\/\//i.test(trimmed)) return undefined
  return { kind: 'set', value: trimmed }
}
