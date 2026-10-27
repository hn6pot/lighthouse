// A line the pane may cut to its width: while the pointer is on it, the whole text unfolds below it, dimmed.
import type { EngineInterface } from 'claude-code'

/** Whether `text` may be cut when `used` of the pane's `columns` cells are taken; an unknown width (0) counts as cut. */
export const mayCut = (text: string, columns: number, used: number) => columns <= 0 || [...text].length > columns - used

/**
 * The whole text, hidden until the pointer is on the nearest keyed Box around it (no hook runs: the surface does it).
 * Nothing when the line shows whole anyway.
 */
export function unfold(ui: ReturnType<EngineInterface['ui']['resolve']>, text: string, cut: boolean) {
  const { Box, Text } = ui
  if (!cut) return null
  return (
    <Box display="none" hover={{ display: 'flex' }}>
      <Text dimColor wrap="wrap">{text}</Text>
    </Box>
  )
}
