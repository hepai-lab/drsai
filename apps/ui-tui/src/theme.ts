/**
 * Theme — single dark palette for Phase 2.
 *
 * Phase 4 can add light theme + COLORFGBG-driven auto-detect.
 * Colors are plain hex strings consumable by Ink's `color={...}` prop.
 */

export interface Theme {
  primary: string
  accent: string
  border: string
  text: string
  textDim: string
  muted: string
  good: string
  warn: string
  error: string
  user: string
  assistant: string
  tool: string
  reasoning: string
  approvalBorder: string
  code: string
  codeBg: string
}

export const DARK_THEME: Theme = {
  primary: '#FFD700',       // gold
  accent: '#FFBF00',        // amber
  border: '#CD7F32',        // copper
  text: '#FFF8DC',          // cornsilk
  textDim: '#A89668',       // dim gold
  muted: '#7C7060',         // muted brown
  good: '#8FBC8F',          // dark sea green
  warn: '#FFA500',          // orange
  error: '#FF6347',         // tomato
  user: '#6EC6FF',          // soft cyan-blue
  assistant: '#FFF8DC',     // cornsilk (default text)
  tool: '#DDA0DD',          // plum
  reasoning: '#A89668',     // dim gold
  approvalBorder: '#FF6347',
  code: '#FFE4B5',          // moccasin
  codeBg: '#3a2f1a',        // dark amber bg
}

export const theme: Theme = DARK_THEME
