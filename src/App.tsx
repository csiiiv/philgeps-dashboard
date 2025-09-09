import { DataExplorer } from './components/DataExplorer'
import { colors, typography, spacing } from './design-system'
import './App.css'

function App() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: colors.background.secondary,
      fontFamily: typography.fontFamily.sans.join(', '),
    }}>
      {/* Header */}
      <header style={{
        backgroundColor: colors.background.primary,
        borderBottom: `1px solid ${colors.border.light}`,
        padding: `${spacing[4]} ${spacing[6]}`,
        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
        <h1 style={{
          ...typography.textStyles.h1,
          color: colors.text.primary,
          margin: 0,
        }}>
          PHILGEPS Awards Data Explorer
        </h1>
          <div style={{
            fontSize: typography.fontSize.sm,
            color: colors.text.secondary,
          }}>
            v1.0.0
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: spacing[6],
      }}>
        <DataExplorer />
      </main>

      {/* Footer */}
      <footer style={{
        backgroundColor: colors.background.primary,
        borderTop: `1px solid ${colors.border.light}`,
        padding: `${spacing[6]} ${spacing[6]}`,
        marginTop: spacing[12],
        textAlign: 'center',
        color: colors.text.secondary,
        fontSize: typography.fontSize.sm,
      }}>
        <p style={{ margin: 0 }}>
          Built with React, TypeScript, and DuckDB-WASM
        </p>
      </footer>
    </div>
  )
}

export default App
