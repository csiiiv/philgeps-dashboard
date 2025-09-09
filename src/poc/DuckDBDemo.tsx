import React, { useEffect, useState } from 'react'
import { queryParquetPaged, queryTopRelated, queryContractsByEntity } from './httpfs'

type EntityType = 'contractor' | 'area' | 'organization' | 'category'

interface DrillModalData {
  srcDim: EntityType
  srcVal: string
  tabs: {
    [key in EntityType]?: {
      data: any[]
      loading: boolean
      error?: string
    }
  } & {
    contracts?: {
      data: any[]
      loading: boolean
      error?: string
      totalCount: number
      pageIndex: number
    }
  }
  parentModal?: DrillModalData // For breadcrumb navigation
}

export const DuckDBDemo: React.FC = () => {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [dataset, setDataset] = useState<'contractors'|'areas'|'organizations'|'categories'>('contractors')
  const [nameFilter, setNameFilter] = useState('')
  const [timeRange, setTimeRange] = useState<'all_time'|'yearly'|'quarterly'>('all_time')
  const [selectedYear, setSelectedYear] = useState<number>(2021)
  const [selectedQuarter, setSelectedQuarter] = useState<number>(4)
  const [modalData, setModalData] = useState<DrillModalData | null>(null)
  const [activeTab, setActiveTab] = useState<EntityType | 'contracts' | null>(null)
  const [sortBy, setSortBy] = useState<string>('total_contract_value')
  const [sortDir, setSortDir] = useState<'ASC'|'DESC'>('DESC')
  const [contractsSortBy, setContractsSortBy] = useState<string>('award_date')
  const [contractsSortDir, setContractsSortDir] = useState<'ASC'|'DESC'>('DESC')

  // Helper function to calculate current page from pageIndex
  const getCurrentPage = (pageIndex: number) => Math.floor(pageIndex / 20)
  const getTotalPages = (totalCount: number) => Math.ceil(totalCount / 20)
  const pageSize = 10

  // Helper function to get Parquet URL based on time range
  const getParquetUrl = (entityType: string) => {
    const basePath = '/parquet'
    
    if (timeRange === 'all_time') {
      return `${basePath}/agg_${entityType}.parquet`
    } else if (timeRange === 'yearly') {
      return `${basePath}/yearly/year_${selectedYear}/agg_${entityType}.parquet`
    } else if (timeRange === 'quarterly') {
      return `${basePath}/quarterly/year_${selectedYear}_q${selectedQuarter}/agg_${entityType}.parquet`
    }
    return `${basePath}/agg_${entityType}.parquet`
  }

  const getFactsUrl = () => {
    const basePath = '/parquet'
    
    if (timeRange === 'all_time') {
      return `${basePath}/facts_awards_all_time.parquet`
    } else if (timeRange === 'yearly') {
      return `${basePath}/yearly/facts_awards_year_${selectedYear}.parquet`
    } else if (timeRange === 'quarterly') {
      return `${basePath}/quarterly/facts_awards_year_${selectedYear}_q${selectedQuarter}.parquet`
    }
    return `${basePath}/facts_awards_all_time.parquet`
  }

  const parquetUrl = getParquetUrl(dataset === 'contractors' ? 'contractor' : 
                                   dataset === 'areas' ? 'area' :
                                   dataset === 'organizations' ? 'organization' : 'business_category')

  // map dataset -> srcDim keyword
  const srcDimForDataset = (ds: typeof dataset): EntityType =>
    ds === 'contractors' ? 'contractor' : ds === 'areas' ? 'area' : ds === 'organizations' ? 'organization' : 'category'

  const load = async (pi: number) => {
    try {
      setError(null)
      const whereParts: string[] = []
      if (nameFilter.trim()) whereParts.push(`lower(entity) LIKE '%${nameFilter.trim().toLowerCase().replace(/'/g, "''")}%'`)
      whereParts.push('contract_count > 0')
      const where = whereParts.join(' AND ')
      const res = await queryParquetPaged(parquetUrl, pi, pageSize, {
        orderBy: `${sortBy} ${sortDir}`,
        where
      })
      setRows(res.rows)
      setTotal(res.totalCount)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onDrill = async (entityVal: string, fromModal: boolean = false, parentModal?: DrillModalData) => {
    const srcDim = fromModal ? (parentModal?.srcDim || 'contractor') : srcDimForDataset(dataset)
    
    // Initialize modal data with loading state for all other entity types
    const allEntityTypes: EntityType[] = ['contractor', 'area', 'organization', 'category']
    const otherEntityTypes = allEntityTypes.filter(t => t !== srcDim)
    
    const initialModalData: DrillModalData = {
      srcDim,
      srcVal: entityVal,
      tabs: {
        contracts: {
          data: [],
          loading: true,
          totalCount: 0,
          pageIndex: 0
        }
      },
      parentModal
    }
    
    // Set loading state for all tabs
    otherEntityTypes.forEach(entityType => {
      initialModalData.tabs[entityType] = {
        data: [],
        loading: true
      }
    })
    
    setModalData(initialModalData)
    setActiveTab('contracts') // Set contracts tab as active by default
    
    // Load data for all tabs in parallel
    const loadPromises = [
      // Load related entities
      ...otherEntityTypes.map(async (entityType) => {
        try {
          const data = await queryTopRelated(srcDim as any, entityVal, entityType as any, 10, getFactsUrl())
          setModalData(prev => prev ? {
            ...prev,
            tabs: {
              ...prev.tabs,
              [entityType]: {
                data,
                loading: false
              }
            }
          } : null)
        } catch (e: any) {
          setModalData(prev => prev ? {
            ...prev,
            tabs: {
              ...prev.tabs,
              [entityType]: {
                data: [],
                loading: false,
                error: String(e?.message || e)
              }
            }
          } : null)
        }
      }),
      // Load contracts
      (async () => {
        try {
          const contractsRes = await queryContractsByEntity(
            [{ dim: srcDim as any, value: entityVal }],
            0,
            20, // Show first 20 contracts
            'award_date DESC',
            getFactsUrl()
          )
          setModalData(prev => prev ? {
            ...prev,
            tabs: {
              ...prev.tabs,
              contracts: {
                data: contractsRes.rows,
                loading: false,
                totalCount: contractsRes.totalCount,
                pageIndex: 0
              }
            }
          } : null)
        } catch (e: any) {
          setModalData(prev => prev ? {
            ...prev,
            tabs: {
              ...prev.tabs,
              contracts: {
                data: [],
                loading: false,
                error: String(e?.message || e),
                totalCount: 0,
                pageIndex: 0
              }
            }
          } : null)
        }
      })()
    ]
    
    await Promise.all(loadPromises)
  }

  const onModalDrill = async (entityVal: string, entityType: EntityType) => {
    if (modalData) {
      // Create a new modal that's nested under the current one
      const newModalData: DrillModalData = {
        srcDim: entityType,
        srcVal: entityVal,
        tabs: {
          contracts: {
            data: [],
            loading: true,
            totalCount: 0,
            pageIndex: 0
          }
        },
        parentModal: modalData // This creates the nesting
      }
      
      // Set loading state for all other entity types
      const allEntityTypes: EntityType[] = ['contractor', 'area', 'organization', 'category']
      const otherEntityTypes = allEntityTypes.filter(t => t !== entityType)
      
      otherEntityTypes.forEach(et => {
        newModalData.tabs[et] = {
          data: [],
          loading: true
        }
      })
      
      setModalData(newModalData)
      setActiveTab('contracts')
      
      // Build accumulated filters from breadcrumb + current selection
      const breadcrumbFilters: Array<{ dim: string; value: string }> = []
      let cur: DrillModalData | undefined = newModalData
      while (cur) {
        breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
        cur = cur.parentModal
      }

      // Load data for all tabs in parallel
      const loadPromises = [
        // Load related entities
        ...otherEntityTypes.map(async (et) => {
          try {
            const data = await queryTopRelated(entityType as any, entityVal, et as any, 10, getFactsUrl())
            setModalData(prev => prev ? {
              ...prev,
              tabs: {
                ...prev.tabs,
                [et]: {
                  data,
                  loading: false
                }
              }
            } : null)
          } catch (e: any) {
            setModalData(prev => prev ? {
              ...prev,
              tabs: {
                ...prev.tabs,
                [et]: {
                  data: [],
                  loading: false,
                  error: String(e?.message || e)
                }
              }
            } : null)
          }
        }),
        // Load contracts with all accumulated filters (e.g., contractor + area)
        (async () => {
          try {
            const contractsRes = await queryContractsByEntity(
              breadcrumbFilters,
              0,
              20,
              'award_date DESC',
              getFactsUrl()
            )
            setModalData(prev => prev ? {
              ...prev,
              tabs: {
                ...prev.tabs,
                contracts: {
                  data: contractsRes.rows,
                  loading: false,
                  totalCount: contractsRes.totalCount,
                  pageIndex: 0
                }
              }
            } : null)
          } catch (e: any) {
            setModalData(prev => prev ? {
              ...prev,
              tabs: {
                ...prev.tabs,
                contracts: {
                  data: [],
                  loading: false,
                  error: String(e?.message || e),
                  totalCount: 0,
                  pageIndex: 0
                }
              }
            } : null)
          }
        })()
      ]
      
      await Promise.all(loadPromises)
    }
  }

  const goBack = () => {
    if (modalData?.parentModal) {
      setModalData(modalData.parentModal)
      const firstTab = Object.keys(modalData.parentModal.tabs).find(key => key !== 'contracts') as EntityType | undefined
      setActiveTab(firstTab || 'contracts')
    } else {
      setModalData(null)
      setActiveTab(null)
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const { getDb } = await import('./httpfs')
        await getDb()
        load(pageIndex)
      } catch (e) {
        setError(String(e))
      }
    }
    init()
  }, [pageIndex, dataset, timeRange, selectedYear, selectedQuarter])

  const columns = [
    { key: 'entity', label: 'Entity' },
    { key: 'contract_count', label: 'Contracts' },
    { key: 'total_contract_value', label: 'Total Value' },
    { key: 'average_contract_value', label: 'Avg Value' },
    { key: 'first_contract_date', label: 'First' },
    { key: 'last_contract_date', label: 'Last' },
  ]

  const getEntityTypeLabel = (entityType: EntityType): string => {
    switch (entityType) {
      case 'contractor': return 'Contractors'
      case 'area': return 'Areas'
      case 'organization': return 'Organizations'
      case 'category': return 'Business Categories'
    }
  }

  const renderBreadcrumb = () => {
    if (!modalData) return null
    
    const breadcrumbs: Array<{ srcDim: EntityType; srcVal: string }> = []
    let current: DrillModalData | undefined = modalData
    while (current) {
      breadcrumbs.unshift({ srcDim: current.srcDim, srcVal: current.srcVal })
      current = current.parentModal
    }
    
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 8, 
        marginBottom: 16, 
        fontSize: 14,
        padding: '8px 12px',
        backgroundColor: '#f8f9fa',
        borderRadius: 6,
        border: '1px solid #e9ecef'
      }}>
        <span style={{ color: '#666', fontSize: 12 }}>Drill Path:</span>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={idx}>
            <span style={{ 
              color: idx === breadcrumbs.length - 1 ? '#2563eb' : '#666',
              fontWeight: idx === breadcrumbs.length - 1 ? 'bold' : 'normal',
              backgroundColor: idx === breadcrumbs.length - 1 ? '#e3f2fd' : 'transparent',
              padding: '2px 6px',
              borderRadius: 4
            }}>
              {getEntityTypeLabel(crumb.srcDim)}: {crumb.srcVal}
            </span>
            {idx < breadcrumbs.length - 1 && <span style={{ color: '#999', fontSize: 16 }}>→</span>}
          </React.Fragment>
        ))}
      </div>
    )
  }

  const contractColumns = [
    { key: 'award_date', label: 'Award Date' },
    { key: 'organization_name', label: 'Organization' },
    { key: 'business_category', label: 'Category' },
    { key: 'area_of_delivery', label: 'Area' },
    { key: 'contract_value', label: 'Value' },
    { key: 'award_title', label: 'Award Title' },
    { key: 'notice_title', label: 'Notice Title' },
    { key: 'contract_no', label: 'Contract No' },
  ]

  const renderModal = () => {
    if (!modalData) return null

    const availableTabs = Object.keys(modalData.tabs) as (EntityType | 'contracts')[]
    
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: 8,
          padding: 20,
          maxWidth: '95vw',
          maxHeight: '90vh',
          width: 1000,
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Related to: {modalData.srcVal}</span>
                {modalData.parentModal && (
                  <span style={{ 
                    fontSize: 12, 
                    color: '#666', 
                    backgroundColor: '#e9ecef', 
                    padding: '2px 6px', 
                    borderRadius: 4 
                  }}>
                    Level {(() => {
                      let depth = 1
                      let current: DrillModalData | undefined = modalData.parentModal
                      while (current) {
                        depth++
                        current = current.parentModal
                      }
                      return depth
                    })()}
                  </span>
                )}
              </h2>
              {renderBreadcrumb()}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {modalData.parentModal && (
                <button 
                  onClick={goBack}
                  style={{ 
                    background: '#f3f4f6', 
                    border: '1px solid #d1d5db', 
                    padding: '4px 8px', 
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12
                  }}
                >
                  ← Back
                </button>
              )}
              <button 
                onClick={() => { setModalData(null); setActiveTab(null) }}
                style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          </div>
          
          <div style={{ display: 'flex', borderBottom: '1px solid #ddd', marginBottom: 16 }}>
            {availableTabs.map(tabKey => (
              <button
                key={tabKey}
                onClick={() => setActiveTab(tabKey as any)}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderBottom: activeTab === tabKey ? '2px solid #2563eb' : '2px solid transparent',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                  color: activeTab === tabKey ? '#2563eb' : '#666'
                }}
              >
                {tabKey === 'contracts' ? 'Contracts' : getEntityTypeLabel(tabKey as EntityType)}
              </button>
            ))}
          </div>
          
          {activeTab && modalData.tabs[activeTab] && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              {modalData.tabs[activeTab]!.loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>Loading...</div>
              ) : modalData.tabs[activeTab]!.error ? (
                <div style={{ color: 'red', padding: 20 }}>Error: {modalData.tabs[activeTab]!.error}</div>
              ) : activeTab === 'contracts' ? (
                <div>
                  <div style={{ marginBottom: 8, fontSize: 14, color: '#666' }}>
                    Showing {modalData.tabs.contracts!.data.length} of {modalData.tabs.contracts!.totalCount} contracts
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {contractColumns.map(c => (
                          <th 
                            key={c.key} 
                            style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: 6, backgroundColor: '#f8f9fa', cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => {
                              const newDir = contractsSortBy === c.key && contractsSortDir === 'DESC' ? 'ASC' : 'DESC'
                              setContractsSortBy(c.key as string)
                              setContractsSortDir(newDir)
                              // reload contracts tab with new order
                              ;(async () => {
                                try {
                                  console.log('Sorting contracts by:', c.key, newDir)
                                  const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                                  let cur: DrillModalData | undefined = modalData ?? undefined
                                  while (cur) {
                                    breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                                    cur = cur.parentModal
                                  }
                                  const res = await queryContractsByEntity(
                                    breadcrumbFilters,
                                    0,
                                    20,
                                    `${c.key} ${newDir}`,
                                    getFactsUrl()
                                  )
                                  console.log('Sorting result - rows:', res.rows.length, 'totalCount:', res.totalCount)
                                  setModalData(prev => prev ? {
                                    ...prev,
                                    tabs: {
                                      ...prev.tabs,
                                      contracts: {
                                        data: res.rows,
                                        loading: false,
                                        totalCount: res.totalCount,
                                        pageIndex: 0 // Reset to first page when sorting
                                      }
                                    }
                                  } : null)
                                } catch (e) {
                                  // noop
                                }
                              })()
                            }}
                          >
                            {c.label}{' '}
                            {contractsSortBy === c.key ? (contractsSortDir === 'DESC' ? '↓' : '↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {modalData.tabs.contracts!.data.map((r: any, idx: number) => (
                        <tr key={idx}>
                          {contractColumns.map(col => (
                            <td 
                              key={col.key} 
                              style={{ 
                                padding: 6, 
                                borderBottom: '1px solid #eee',
                                maxWidth: col.key === 'award_title' || col.key === 'notice_title' ? 200 : undefined,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={String(r[col.key] ?? '')}
                            >
                              {col.key === 'award_date'
                                ? (() => {
                                    const v = r[col.key]
                                    if (!v) return ''
                                    // Normalize to YYYY-MM-DD
                                    try {
                                      if (typeof v === 'string') {
                                        // If already in YYYY-MM-DD, return as is; else try Date parse
                                        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
                                        const d = new Date(v)
                                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                                      }
                                      if (v instanceof Date) return v.toISOString().slice(0, 10)
                                      if (typeof v === 'number' || typeof v === 'bigint') {
                                        const d = new Date(Number(v))
                                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                                      }
                                      return String(v)
                                    } catch {
                                      return String(v)
                                    }
                                  })()
                                : String(r[col.key] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {/* Pagination controls */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginTop: 12, 
                    padding: '8px 0',
                    borderTop: '1px solid #eee'
                  }}>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      Page {getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) + 1} of {getTotalPages(modalData.tabs.contracts!.totalCount || 0)} 
                      (showing {modalData.tabs.contracts!.data.length} of {modalData.tabs.contracts!.totalCount} contracts)
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const currentPage = getCurrentPage(modalData.tabs.contracts!.pageIndex || 0)
                          console.log('Previous button clicked - currentPage:', currentPage, 'pageIndex:', modalData.tabs.contracts!.pageIndex)
                          if (currentPage > 0) {
                            const newOffset = (modalData.tabs.contracts!.pageIndex || 0) - 20
                            console.log('Loading previous page with offset:', newOffset, 'FIXED VERSION')
                            try {
                              const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                              let cur: DrillModalData | undefined = modalData ?? undefined
                              while (cur) {
                                breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                                cur = cur.parentModal
                              }
                              const res = await queryContractsByEntity(
                                breadcrumbFilters,
                                newOffset,
                                20,
                                contractsSortBy ? `${contractsSortBy} ${contractsSortDir}` : 'award_date DESC',
                                getFactsUrl()
                              )
                              setModalData(prev => prev ? {
                                ...prev,
                                tabs: {
                                  ...prev.tabs,
                                  contracts: {
                                    data: res.rows,
                                    loading: false,
                                    totalCount: res.totalCount,
                                    pageIndex: newOffset
                                  }
                                }
                              } : null)
                            } catch (e) {
                              console.error('Failed to load previous page:', e)
                            }
                          }
                        }}
                        disabled={getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          border: '1px solid #ddd',
                          backgroundColor: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? '#f5f5f5' : 'white',
                          cursor: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? 'not-allowed' : 'pointer',
                          color: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? '#999' : '#333'
                        }}
                      >
                        Previous
                      </button>
                      <button
                        onClick={async () => {
                          const currentPage = getCurrentPage(modalData.tabs.contracts!.pageIndex || 0)
                          const totalPages = getTotalPages(modalData.tabs.contracts!.totalCount || 0)
                          console.log('Next button clicked - currentPage:', currentPage, 'totalPages:', totalPages, 'pageIndex:', modalData.tabs.contracts!.pageIndex)
                          if (currentPage < totalPages - 1) {
                            const newOffset = (modalData.tabs.contracts!.pageIndex || 0) + 20
                            console.log('Loading next page with offset:', newOffset, 'FIXED VERSION')
                            try {
                              const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                              let cur: DrillModalData | undefined = modalData ?? undefined
                              while (cur) {
                                breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                                cur = cur.parentModal
                              }
                              const res = await queryContractsByEntity(
                                breadcrumbFilters,
                                newOffset,
                                20,
                                contractsSortBy ? `${contractsSortBy} ${contractsSortDir}` : 'award_date DESC',
                                getFactsUrl()
                              )
                              setModalData(prev => prev ? {
                                ...prev,
                                tabs: {
                                  ...prev.tabs,
                                  contracts: {
                                    data: res.rows,
                                    loading: false,
                                    totalCount: res.totalCount,
                                    pageIndex: newOffset
                                  }
                                }
                              } : null)
                            } catch (e) {
                              console.error('Failed to load next page:', e)
                            }
                          }
                        }}
                        disabled={getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          border: '1px solid #ddd',
                          backgroundColor: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? '#f5f5f5' : 'white',
                          cursor: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? 'not-allowed' : 'pointer',
                          color: getCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? '#999' : '#333'
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {columns.map(c => (
                        <th 
                          key={c.key} 
                          style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: 6, cursor: 'pointer', userSelect: 'none' }}
                          onClick={() => {
                            // client-side sort for related tabs (10 rows)
                            const newDir = sortBy === c.key && sortDir === 'DESC' ? 'ASC' : 'DESC'
                            setSortBy(c.key)
                            setSortDir(newDir)
                            setModalData(prev => prev ? {
                              ...prev,
                              tabs: {
                                ...prev.tabs,
                                [activeTab]: {
                                  ...(prev.tabs as any)[activeTab!],
                                  data: [...(prev.tabs as any)[activeTab!].data].sort((a: any, b: any) => {
                                    const av = a[c.key]
                                    const bv = b[c.key]
                                    if (av == null && bv == null) return 0
                                    if (av == null) return 1
                                    if (bv == null) return -1
                                    if (av < bv) return newDir === 'ASC' ? -1 : 1
                                    if (av > bv) return newDir === 'ASC' ? 1 : -1
                                    return 0
                                  })
                                }
                              }
                            } : null)
                          }}
                        >
                          {c.label}{' '}
                          {sortBy === c.key ? (sortDir === 'DESC' ? '↓' : '↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modalData.tabs[activeTab]!.data.map((r, idx) => (
                      <tr key={idx}>
                        <td 
                          style={{ 
                            padding: 6, 
                            color: '#2563eb', 
                            cursor: 'pointer',
                            textDecoration: 'underline'
                          }} 
                          onClick={() => onModalDrill(String(r.entity), activeTab as EntityType)}
                        >
                          {String(r.entity ?? '')}
                        </td>
                        <td style={{ padding: 6 }}>{String(r.contract_count ?? '')}</td>
                        <td style={{ padding: 6 }}>{String(r.total_contract_value ?? '')}</td>
                        <td style={{ padding: 6 }}>{String(r.average_contract_value ?? '')}</td>
                        <td style={{ padding: 6 }}>{String(r.first_contract_date ?? '')}</td>
                        <td style={{ padding: 6 }}>{String(r.last_contract_date ?? '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>DuckDB-WASM Parquet Sandbox</h1>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <label>Dataset:</label>
        <select value={dataset} onChange={e => { setPageIndex(0); setDataset(e.target.value as any) }}>
          <option value="contractors">Contractors</option>
          <option value="areas">Areas</option>
          <option value="organizations">Organizations</option>
          <option value="categories">Business Categories</option>
        </select>
        
        <label>Time Range:</label>
        <select value={timeRange} onChange={e => { setPageIndex(0); setTimeRange(e.target.value as any) }}>
          <option value="all_time">All Time</option>
          <option value="yearly">Yearly</option>
          <option value="quarterly">Quarterly</option>
        </select>
        
        {timeRange === 'yearly' && (
          <>
            <label>Year:</label>
            <select value={selectedYear} onChange={e => { setPageIndex(0); setSelectedYear(Number(e.target.value)) }}>
              {Array.from({ length: 9 }, (_, i) => 2013 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </>
        )}
        
        {timeRange === 'quarterly' && (
          <>
            <label>Year:</label>
            <select value={selectedYear} onChange={e => { setPageIndex(0); setSelectedYear(Number(e.target.value)) }}>
              {Array.from({ length: 9 }, (_, i) => 2013 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <label>Quarter:</label>
            <select value={selectedQuarter} onChange={e => { setPageIndex(0); setSelectedQuarter(Number(e.target.value)) }}>
              <option value={1}>Q1</option>
              <option value={2}>Q2</option>
              <option value={3}>Q3</option>
              <option value={4}>Q4</option>
            </select>
          </>
        )}
        <input
          placeholder="Filter name contains..."
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPageIndex(0); load(0) } }}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button onClick={() => { setPageIndex(0); load(0) }}>Apply</button>
      </div>
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}
      <div style={{ margin: '8px 0' }}>Total rows: {total}</div>

      <div style={{ overflow: 'auto', maxHeight: 360 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {columns.map(c => (
                <th 
                  key={c.key} 
                  style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: 6, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => {
                    const newDir = sortBy === c.key && sortDir === 'DESC' ? 'ASC' : 'DESC'
                    setSortBy(c.key)
                    setSortDir(newDir)
                    setPageIndex(0)
                    load(0)
                  }}
                >
                  {c.label}{' '}
                  {sortBy === c.key ? (sortDir === 'DESC' ? '↓' : '↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td style={{ padding: 6, color: '#2563eb', cursor: 'pointer' }} onClick={() => onDrill(String(r.entity))}>{String(r.entity ?? '')}</td>
                <td style={{ padding: 6 }}>{String(r.contract_count ?? '')}</td>
                <td style={{ padding: 6 }}>{String(r.total_contract_value ?? '')}</td>
                <td style={{ padding: 6 }}>{String(r.average_contract_value ?? '')}</td>
                <td style={{ padding: 6 }}>
                  {(() => {
                    const v = r.first_contract_date
                    if (!v) return ''
                    try {
                      if (typeof v === 'string') {
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
                        const d = new Date(v)
                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                      }
                      if (v instanceof Date) return v.toISOString().slice(0, 10)
                      if (typeof v === 'number' || typeof v === 'bigint') {
                        const d = new Date(Number(v))
                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                      }
                      return String(v)
                    } catch { return String(v) }
                  })()}
                </td>
                <td style={{ padding: 6 }}>
                  {(() => {
                    const v = r.last_contract_date
                    if (!v) return ''
                    try {
                      if (typeof v === 'string') {
                        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
                        const d = new Date(v)
                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                      }
                      if (v instanceof Date) return v.toISOString().slice(0, 10)
                      if (typeof v === 'number' || typeof v === 'bigint') {
                        const d = new Date(Number(v))
                        return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
                      }
                      return String(v)
                    } catch { return String(v) }
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button disabled={pageIndex===0} onClick={() => setPageIndex(p => Math.max(0, p-1))}>Prev</button>
        <button disabled={(pageIndex+1)*pageSize>=total} onClick={() => setPageIndex(p => p+1)}>Next</button>
      </div>

      {renderModal()}
    </div>
  )
}


