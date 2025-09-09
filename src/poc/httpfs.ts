// Initialize DuckDB-WASM with HTTPFS and run paged queries against a Parquet served by Vite
import * as duckdb from '@duckdb/duckdb-wasm'

let db: duckdb.AsyncDuckDB | null = null

export async function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (db) return db
  
  try {
    // Use classic worker; the bundled worker script is not an ES module
    const worker = new Worker('/workers/duckdb-browser-eh.worker.js')
  const logger = new duckdb.ConsoleLogger()
  db = new duckdb.AsyncDuckDB(logger, worker)
    await db.instantiate('/workers/duckdb-eh.wasm')

    // Readiness check to ensure the engine is actually initialized
    const testConn = await db.connect()
    await testConn.query('SELECT 1')
    await testConn.close()

    console.log('DuckDB initialized successfully')
  } catch (e) {
    console.error('DuckDB initialization failed:', e)
    throw e
  }

  return db
}

export async function queryParquetPaged(
  parquetUrl: string,
  pageIndex: number,
  pageSize: number,
  opts?: { where?: string; orderBy?: string; columns?: string[] }
): Promise<{ rows: any[]; totalCount: number }> {
  const database = await getDb()

  // Load Parquet into memory and register it as a virtual file
  const logicalName = 'current.parquet'
  try {
    const resp = await fetch(parquetUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`Failed to fetch Parquet: ${resp.status} ${resp.statusText}`)
    const buf = await resp.arrayBuffer()
    // @ts-ignore
    await (database as any).registerFileBuffer(logicalName, new Uint8Array(buf))
  } catch (e) {
    console.error('Failed to register Parquet buffer:', e)
    throw e
  }

  const conn = await database.connect()
  const viewName = 'v'
  const projection = opts?.columns?.length ? opts.columns.join(', ') : '*'
  const where = opts?.where ? `WHERE ${opts.where}` : ''
  const order = opts?.orderBy ? `ORDER BY ${opts.orderBy}` : ''
  const offset = pageIndex * pageSize

  await conn.query(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM parquet_scan('${logicalName}')`)
  const res = await conn.query(`SELECT ${projection} FROM ${viewName} ${where} ${order} LIMIT ${pageSize} OFFSET ${offset}`)
  const count = await conn.query(`SELECT COUNT(*) AS c FROM ${viewName} ${where}`)

  const fieldNames: string[] = res.schema.fields.map((f: any) => f.name)
  const resultArray: any[] = res.toArray()
  const rows = resultArray.map((row: any) => {
    // Row could be an array-like or an object; normalize to object by field names
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      // If it already has named properties, pick them
      const obj: any = {}
      for (const name of fieldNames) obj[name] = (row as any)[name]
      return obj
    } else {
      // Assume positional array
      const arr: any[] = row as any[]
      const obj: any = {}
      fieldNames.forEach((name, idx) => { obj[name] = arr?.[idx] })
      return obj
    }
  })

  const countArr: any[] = count.toArray()
  let totalCount = 0
  if (countArr.length > 0) {
    const first = countArr[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      totalCount = Number((first as any)['c'] ?? 0)
    } else if (Array.isArray(first)) {
      totalCount = Number(first[0] ?? 0)
    }
  }
  await conn.close()
  return { rows, totalCount }
}

export async function queryTopRelated(
  sourceDim: 'contractor'|'area'|'organization'|'category',
  sourceValue: string,
  targetDim: 'contractor'|'area'|'organization'|'category',
  limit: number,
  factsParquetUrl: string = '/parquet/facts_awards_all_time.parquet'
): Promise<any[]> {
  const database = await getDb()

  // Map dims to column names in facts
  const dimToCol = (d: string) => {
    switch (d) {
      case 'contractor': return 'contractor_name'
      case 'area': return 'area_of_delivery'
      case 'organization': return 'organization_name'
      case 'category': return 'business_category'
      default: return 'contractor_name'
    }
  }
  const srcCol = dimToCol(sourceDim)
  const tgtCol = dimToCol(targetDim)

  // Load facts parquet into memory and register
  const logicalName = 'facts_related.parquet'
  try {
    // drop previous registration to avoid stale schema
    try { /* @ts-ignore */ await (database as any).dropFile(logicalName) } catch {}
    const resp = await fetch(factsParquetUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`Failed to fetch facts parquet: ${resp.status} ${resp.statusText}`)
    const buf = await resp.arrayBuffer()
    // @ts-ignore
    await (database as any).registerFileBuffer(logicalName, new Uint8Array(buf))
  } catch (e) {
    console.error('Failed to register facts buffer:', e)
    throw e
  }

  const conn = await database.connect()
  const esc = (v: string) => v.replace(/'/g, "''")
  const sql = `
    CREATE OR REPLACE VIEW f AS SELECT * FROM parquet_scan('${logicalName}');
    SELECT
      ${tgtCol} AS entity,
      COUNT(*) AS contract_count,
      SUM(total_contract_amount) AS total_contract_value,
      AVG(total_contract_amount) AS average_contract_value,
      MIN(award_date) AS first_contract_date,
      MAX(award_date) AS last_contract_date
    FROM f
    WHERE ${srcCol} = '${esc(sourceValue)}'
      AND ${tgtCol} IS NOT NULL
    GROUP BY 1
    ORDER BY total_contract_value DESC
    LIMIT ${limit}
  `
  const res = await conn.query(sql)
  const fields: string[] = res.schema.fields.map((f: any) => f.name)
  const arr: any[] = res.toArray()
  const rows = arr.map((row: any) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const obj: any = {}
      for (const name of fields) obj[name] = (row as any)[name]
      return obj
    } else {
      const a: any[] = row as any[]
      const obj: any = {}
      fields.forEach((name, idx) => { obj[name] = a?.[idx] })
      return obj
    }
  })
  await conn.close()
  return rows
}

export async function queryContractsByEntity(
  filters: Array<{ dim: string; value: string }>,
  pageIndex: number,
  pageSize: number,
  orderBy?: string,
  factsParquetUrl: string = '/parquet/facts_awards_all_time.parquet'
): Promise<{ rows: any[]; totalCount: number }> {
  const database = await getDb()

  const dimToCol = (d: string) => {
    switch (d) {
      case 'contractor_name': return 'contractor_name'
      case 'area_of_delivery': return 'area_of_delivery'
      case 'organization_name': return 'organization_name'
      case 'business_category': return 'business_category'
      case 'contractor': return 'contractor_name'
      case 'area': return 'area_of_delivery'
      case 'organization': return 'organization_name'
      case 'category': return 'business_category'
      default: return d // Assume it's already the column name
    }
  }
  const logicalName = 'facts_contracts.parquet' // Use different name to avoid conflicts

  // Register facts buffer (drop first to avoid stale schema)
  try {
    try { /* @ts-ignore */ await (database as any).dropFile(logicalName) } catch {}
    const resp = await fetch(factsParquetUrl, { cache: 'no-store' })
    if (!resp.ok) throw new Error(`Failed to fetch facts parquet: ${resp.status} ${resp.statusText}`)
    const buf = await resp.arrayBuffer()
    // @ts-ignore
    await (database as any).registerFileBuffer(logicalName, new Uint8Array(buf))
  } catch (e) {
    console.error('Failed to register facts buffer:', e)
    throw e
  }

  const conn = await database.connect()
  const esc = (v: string) => v.replace(/'/g, "''")
  const offset = pageIndex // pageIndex is already the correct offset from frontend

  const baseView = `CREATE OR REPLACE VIEW facts_v AS SELECT * FROM parquet_scan('${logicalName}')`;
  await conn.query(baseView)

  // Detect available columns to avoid binder errors on stale schemas
  const info = await conn.query(`PRAGMA table_info('facts_v')`)
  const infoArr: any[] = info.toArray()
  const availableCols = new Set<string>(
    infoArr.map((row: any) => (Array.isArray(row) ? String(row[1]) : String((row as any).name)))
  )

  const has = (c: string) => availableCols.has(c)
  const orderClause = orderBy ? `ORDER BY ${orderBy}` : 'ORDER BY award_date DESC'
  const whereClauses = filters.map(f => `${dimToCol(f.dim)} = '${esc(f.value)}'`)
  const whereCombined = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const selectSql = `
    SELECT 
      ${has('award_date') ? 'award_date' : "NULL AS award_date"},
      ${has('contractor_name') ? 'contractor_name' : "'' AS contractor_name"},
      ${has('business_category') ? 'business_category' : "'' AS business_category"},
      ${has('organization_name') ? 'organization_name' : "'' AS organization_name"},
      ${has('area_of_delivery') ? 'area_of_delivery' : "'' AS area_of_delivery"},
      ${has('total_contract_amount') ? 'total_contract_amount AS contract_value' : '0 AS contract_value'},
      ${has('award_title') ? 'award_title' : "'' AS award_title"},
      ${has('notice_title') ? 'notice_title' : "'' AS notice_title"},
      ${has('contract_no') ? 'contract_no' : "'' AS contract_no"}
    FROM facts_v
    ${whereCombined}
    ${orderClause}
    LIMIT ${pageSize} OFFSET ${offset}
  `
  const countSql = `SELECT COUNT(*) AS c FROM facts_v ${whereCombined}`

  const res = await conn.query(selectSql)
  const count = await conn.query(countSql)

  const fields: string[] = res.schema.fields.map((f: any) => f.name)
  const arr: any[] = res.toArray()
  const rows = arr.map((row: any) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const obj: any = {}
      for (const name of fields) obj[name] = (row as any)[name]
      return obj
    } else {
      const a: any[] = row as any[]
      const obj: any = {}
      fields.forEach((name, idx) => { obj[name] = a?.[idx] })
      return obj
    }
  })

  const countArr: any[] = count.toArray()
  let totalCount = 0
  if (countArr.length > 0) {
    const first = countArr[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      totalCount = Number((first as any)['c'] ?? 0)
    } else if (Array.isArray(first)) {
      totalCount = Number(first[0] ?? 0)
    }
  }
  await conn.close()
  return { rows, totalCount }
}
