// Design System - Spacing
export const spacing = {
  // Base spacing scale (4px increments)
  0: '0',
  1: '0.25rem',  // 4px
  2: '0.5rem',   // 8px
  3: '0.75rem',  // 12px
  4: '1rem',     // 16px
  5: '1.25rem',  // 20px
  6: '1.5rem',   // 24px
  8: '2rem',     // 32px
  10: '2.5rem',  // 40px
  12: '3rem',    // 48px
  16: '4rem',    // 64px
  20: '5rem',    // 80px
  24: '6rem',    // 96px
  32: '8rem',    // 128px
}

// Semantic spacing
export const semanticSpacing = {
  // Component spacing
  component: {
    padding: spacing[4],
    margin: spacing[4],
    gap: spacing[3],
  },
  
  // Layout spacing
  layout: {
    container: spacing[6],
    section: spacing[12],
    page: spacing[8],
  },
  
  // Form spacing
  form: {
    fieldGap: spacing[4],
    labelGap: spacing[2],
    buttonGap: spacing[3],
  },
  
  // Table spacing
  table: {
    cellPadding: spacing[3],
    headerPadding: spacing[4],
    rowGap: spacing[1],
  },
  
  // Modal spacing
  modal: {
    padding: spacing[6],
    headerGap: spacing[4],
    contentGap: spacing[4],
  }
}

export type Spacing = keyof typeof spacing
export type SemanticSpacing = keyof typeof semanticSpacing
