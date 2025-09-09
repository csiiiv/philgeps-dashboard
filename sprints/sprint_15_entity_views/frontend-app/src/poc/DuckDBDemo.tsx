import React, { useEffect, useState } from 'react'
import { createDuckDB, DuckDB, AsyncDuckDB } from '@duckdb/duckdb-wasm'

export const DuckDBDemo: React.FC = () => {
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        // Minimal in-memory query to validate wasm; HTTPFS attach next step
        // Note: Real HTTPFS needs bundles and config; this verifies the runtime
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const duckdb: any = await import('@duckdb/duckdb-wasm')
        const JS_DELIVER_BUNDLES = duckdb.getJsDelivrBundles()
        const bundle = await JS_DELIVER_BUNDLES.selectBundle()
        const worker = new Worker(bundle.mainWorker)
        const logger = new duckdb.ConsoleLogger()
        const db = new duckdb.AsyncDuckDB(logger, worker)
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker)

        const conn = await db.connect()
        await conn.query("CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (1), (2), (3)")
        const result = await conn.query("SELECT a, a*10 AS b FROM t ORDER BY a DESC")
        const out = result.toArray().map((r: any) => ({ a: r.get('a'), b: r.get('b') }))
        setRows(out)
        await conn.close()
        await db.terminate()
      } catch (e: any) {
        setError(String(e?.message || e))
      }
    })()
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <h1>DuckDB-WASM Demo</h1>
      {error ? (
        <div style={{ color: 'red' }}>Error: {error}</div>
      ) : (
        <pre>{JSON.stringify(rows, null, 2)}</pre>
      )}
      <p style={{ fontSize: 12, color: '#555' }}>Next: attach Parquet over HTTPFS and paginate.</p>
    </div>
  )
}
