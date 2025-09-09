import React, { useEffect, useState, useCallback, useRef } from 'react'
import { queryParquetPaged, queryTopRelated, queryContractsByEntity } from '../poc/httpfs'
import { colors, typography, spacing, commonStyles } from '../design-system'

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

export const DataExplorer: React.FC = () => {
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
  const [loading, setLoading] = useState(false)
  const [dbInitializing, setDbInitializing] = useState(true)
  const [debouncing, setDebouncing] = useState(false)
  const [summaryStats, setSummaryStats] = useState({
    totalContracts: 0,
    totalValue: 0,
    averageValue: 0,
    topEntity: '',
    topEntityValue: 0
  })

  // Page size constant
  const pageSize = 10

  // Debounce refs and functions
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const modalDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Helper function to calculate current page from pageIndex (offset-based)
  const getCurrentPage = (pageIndex: number) => Math.floor(pageIndex / pageSize) + 1
  const getTotalPages = (totalCount: number) => Math.ceil(totalCount / pageSize)
  
  // Helper functions for modal contracts (uses page size of 20)
  const getModalCurrentPage = (pageIndex: number) => Math.floor(pageIndex / 20) + 1
  const getModalTotalPages = (totalCount: number) => Math.ceil(totalCount / 20)

  // Helper function to safely convert BigInt to number
  const safeNumber = (value: any): number => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'bigint') return Number(value)
    if (typeof value === 'number') return value
    if (typeof value === 'string') {
      const parsed = parseFloat(value)
      return isNaN(parsed) ? 0 : parsed
    }
    return 0
  }

  // Helper functions for formatting
  const formatCurrency = (value: any): string => {
    if (!value || value === '' || value === null || value === undefined) return '-'
    const num = safeNumber(value)
    if (isNaN(num)) return '-'
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num)
  }

  const formatDate = (value: any): string => {
    if (!value || value === '' || value === null || value === undefined) return '-'
    try {
      let date: Date
      if (typeof value === 'string') {
        date = new Date(value)
      } else if (typeof value === 'number' || typeof value === 'bigint') {
        date = new Date(Number(value))
      } else if (value instanceof Date) {
        date = value
      } else {
        return '-'
      }
      
      if (isNaN(date.getTime())) return '-'
      return date.toISOString().slice(0, 10) // YYYY-MM-DD format
    } catch {
      return '-'
    }
  }

  const formatText = (value: any): string => {
    if (!value || value === '' || value === null || value === undefined) return '-'
    return String(value)
  }

  // Calculate summary statistics
  const calculateSummaryStats = (data: any[]) => {
    if (data.length === 0) {
      return {
        totalContracts: 0,
        totalValue: 0,
        averageValue: 0,
        topEntity: '',
        topEntityValue: 0
      }
    }

    const totalContracts = data.reduce((sum, row) => sum + safeNumber(row.contract_count), 0)
    const totalValue = data.reduce((sum, row) => sum + safeNumber(row.total_contract_value), 0)
    const averageValue = totalContracts > 0 ? totalValue / totalContracts : 0
    
    const topEntity = data[0]?.entity || ''
    const topEntityValue = safeNumber(data[0]?.total_contract_value)

    return {
      totalContracts,
      totalValue,
      averageValue,
      topEntity,
      topEntityValue
    }
  }

  // Generate CSV content
  const generateCSV = (data: any[]) => {
    if (data.length === 0) return ''
    
    const csvColumns = [
      { key: 'entity', label: 'Entity' },
      { key: 'contract_count', label: 'Contracts' },
      { key: 'total_contract_value', label: 'Total Value' },
      { key: 'average_contract_value', label: 'Avg Value' },
      { key: 'first_contract_date', label: 'First' },
      { key: 'last_contract_date', label: 'Last' },
    ]
    
    const headers = csvColumns.map((col: any) => col.label).join(',')
    
    const rows = data.map(row => 
      csvColumns.map((col: any) => {
        const value = row[col.key]
        if (value === null || value === undefined) return ''
        
        // Format values for CSV
        if (col.key === 'total_contract_value' || col.key === 'average_contract_value') {
          const numValue = safeNumber(value)
          return formatCurrency(numValue).replace(/[₱,]/g, '')
        } else if (col.key === 'first_contract_date' || col.key === 'last_contract_date') {
          return formatDate(value)
        } else {
          return String(value).replace(/,/g, ';') // Replace commas to avoid CSV issues
        }
      }).join(',')
    )
    
    return [headers, ...rows].join('\n')
  }

  // Download CSV file
  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

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
      console.log('Load function called with pageIndex:', pi, 'dbInitializing:', dbInitializing)
      setLoading(true)
      setError(null)
      const whereParts: string[] = []
      if (nameFilter.trim()) whereParts.push(`lower(entity) LIKE '%${nameFilter.trim().toLowerCase().replace(/'/g, "''")}%'`)
      whereParts.push('contract_count > 0')
      const where = whereParts.join(' AND ')
      console.log('Querying parquet with URL:', parquetUrl)
      const res = await queryParquetPaged(parquetUrl, pi, pageSize, {
        orderBy: `${sortBy} ${sortDir}`,
        where
      })
      console.log('Query result:', res)
      setRows(res.rows)
      setTotal(res.totalCount)
      
      // Calculate summary statistics
      const stats = calculateSummaryStats(res.rows)
      setSummaryStats(stats)
      
      // Only clear dbInitializing when we get a successful query result
      if (dbInitializing) {
        console.log('First successful query - clearing dbInitializing')
        setDbInitializing(false)
      }
    } catch (e: any) {
      console.error('Load function error:', e)
      setError(String(e?.message || e))
      // If this is the first load and it fails, clear dbInitializing to show error
      if (dbInitializing) {
        setDbInitializing(false)
      }
    } finally {
      setLoading(false)
    }
  }

  // Debounced load function for main table
  const debouncedLoad = useCallback((pi: number) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      console.log('Debouncing cancelled - previous action was overridden')
      clearTimeout(debounceTimeoutRef.current)
    }
    
    // Show debouncing indicator
    console.log('Debouncing started - waiting 1s before loading pageIndex:', pi)
    setDebouncing(true)
    
    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      console.log('Debounced load executing for pageIndex:', pi)
      setDebouncing(false)
      load(pi)
    }, 1000)
  }, [sortBy, sortDir, nameFilter, dataset, timeRange, selectedYear, selectedQuarter])


  // Debounced modal contracts load function
  const debouncedModalContractsLoad = useCallback((
    breadcrumbFilters: Array<{ dim: string; value: string }>,
    offset: number,
    orderBy: string
  ) => {
    // Clear existing timeout
    if (modalDebounceTimeoutRef.current) {
      clearTimeout(modalDebounceTimeoutRef.current)
    }
    
    // Set new timeout
    modalDebounceTimeoutRef.current = setTimeout(async () => {
      console.log('Debounced modal contracts load executing for offset:', offset)
      // Set loading state when we actually start the query
      setModalData(prev => prev ? {
        ...prev,
        tabs: {
          ...prev.tabs,
          contracts: {
            ...prev.tabs.contracts!,
            loading: true
          }
        }
      } : null)
      
      try {
        const res = await queryContractsByEntity(
          breadcrumbFilters,
          offset,
          20,
          orderBy,
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
              pageIndex: offset
            }
          }
        } : null)
      } catch (e) {
        console.error('Debounced modal contracts load error:', e)
        setModalData(prev => prev ? {
          ...prev,
          tabs: {
            ...prev.tabs,
            contracts: {
              ...prev.tabs.contracts!,
              loading: false,
              error: String(e)
            }
          }
        } : null)
      }
    }, 1000)
  }, [])

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

  // Initialize database and load initial data
  useEffect(() => {
    const init = async () => {
      try {
        console.log('Starting database initialization...')
        setDbInitializing(true)
        const { getDb } = await import('../poc/httpfs')
        await getDb()
        console.log('Database initialized successfully')
        // Load initial data after DB is ready - use immediate load for first load
        console.log('Loading initial data...')
        await load(pageIndex)
      } catch (e) {
        console.error('Database initialization failed:', e)
        setDbInitializing(false)
        setError(String(e))
      }
    }
    init()
  }, []) // Empty dependency array - only run once on mount

  // Load data when dependencies change (but only after DB is initialized)
  // Note: This useEffect is disabled in favor of debounced functions
  // useEffect(() => {
  //   if (!dbInitializing) {
  //     console.log('Loading data due to dependency change...')
  //     load(pageIndex)
  //   }
  // }, [pageIndex, dataset, timeRange, selectedYear, selectedQuarter, dbInitializing])

  // Special useEffect for time range changes to trigger debounced load
  useEffect(() => {
    if (!dbInitializing) {
      console.log('Time range changed - triggering debounced load')
      debouncedLoad(pageIndex)
    }
  }, [timeRange, selectedYear, selectedQuarter, dbInitializing])

  // Special useEffect for dataset changes to trigger debounced load
  useEffect(() => {
    if (!dbInitializing) {
      console.log('Dataset changed - triggering debounced load')
      debouncedLoad(pageIndex)
    }
  }, [dataset, dbInitializing])

  // Debug state changes
  useEffect(() => {
    console.log('State changed - dbInitializing:', dbInitializing, 'loading:', loading, 'rows.length:', rows.length)
  }, [dbInitializing, loading, rows.length])

  // Cleanup debounce timeouts on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      if (modalDebounceTimeoutRef.current) {
        clearTimeout(modalDebounceTimeoutRef.current)
      }
    }
  }, [])

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

  // Contract columns - show all data regardless of dataset context
  const getContractColumns = () => {
    return [
      { key: 'award_date', label: 'Award Date' },
      { key: 'contractor_name', label: 'Contractor' },
      { key: 'organization_name', label: 'Organization' },
      { key: 'business_category', label: 'Category' },
      { key: 'area_of_delivery', label: 'Area' },
      { key: 'contract_value', label: 'Contract Value' },
      { key: 'award_title', label: 'Award Title' },
      { key: 'notice_title', label: 'Notice Title' },
      { key: 'contract_no', label: 'Contract No' },
    ]
  }

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
                <div style={{ 
                  textAlign: 'center', 
                  padding: spacing[8],
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: spacing[4],
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    border: `3px solid ${colors.gray[300]}`,
                    borderTop: `3px solid ${colors.primary[600]}`,
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{
                    fontSize: typography.fontSize.sm,
                    color: colors.text.secondary,
                    fontWeight: typography.fontWeight.medium,
                  }}>
                    Loading {activeTab === 'contracts' ? 'contracts' : getEntityTypeLabel(activeTab as EntityType).toLowerCase()}...
                  </span>
                </div>
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
                        {getContractColumns().map(c => (
                          <th 
                            key={c.key} 
                            style={{ borderBottom: '1px solid #ddd', textAlign: 'left', padding: 6, backgroundColor: '#f8f9fa', cursor: 'pointer', userSelect: 'none' }}
                            onClick={() => {
                              const newDir = contractsSortBy === c.key && contractsSortDir === 'DESC' ? 'ASC' : 'DESC'
                              setContractsSortBy(c.key as string)
                              setContractsSortDir(newDir)
                              // reload contracts tab with new order
                              console.log('Sorting contracts by:', c.key, newDir)
                              const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                              let cur: DrillModalData | undefined = modalData ?? undefined
                              while (cur) {
                                breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                                cur = cur.parentModal
                              }
                              debouncedModalContractsLoad(breadcrumbFilters, 0, `${c.key} ${newDir}`)
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
                          {getContractColumns().map(col => (
                            <td 
                              key={col.key} 
                              style={{ 
                                padding: spacing[3], 
                                borderBottom: `1px solid ${colors.border.light}`,
                                wordWrap: 'break-word',
                                whiteSpace: 'normal',
                                verticalAlign: 'top',
                              }}
                            >
                              {col.key === 'award_date'
                                ? formatDate(r[col.key])
                                : col.key === 'contract_value'
                                ? formatCurrency(r[col.key])
                                : formatText(r[col.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  
                  {/* Empty state for contracts */}
                  {modalData.tabs.contracts!.data.length === 0 && !modalData.tabs.contracts!.loading && (
                    <div style={{
                      padding: spacing[8],
                      textAlign: 'center',
                      backgroundColor: colors.background.secondary,
                      borderTop: `1px solid ${colors.border.light}`,
                    }}>
                      <div style={{
                        fontSize: typography.fontSize.lg,
                        color: colors.text.secondary,
                        marginBottom: spacing[3],
                      }}>
                        📄
                      </div>
                      <p style={{
                        fontSize: typography.fontSize.sm,
                        color: colors.text.secondary,
                        margin: 0,
                      }}>
                        No contracts found for this entity
                      </p>
                    </div>
                  )}
                  
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
                      Page {getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0)} of {getModalTotalPages(modalData.tabs.contracts!.totalCount || 0)} 
                      (showing {modalData.tabs.contracts!.data.length} of {modalData.tabs.contracts!.totalCount} contracts)
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => {
                          const currentPage = getCurrentPage(modalData.tabs.contracts!.pageIndex || 0)
                          console.log('Previous button clicked - currentPage:', currentPage, 'pageIndex:', modalData.tabs.contracts!.pageIndex)
                          if (currentPage > 0) {
                            const newOffset = (modalData.tabs.contracts!.pageIndex || 0) - 20
                            console.log('Loading previous page with offset:', newOffset, 'FIXED VERSION')
                            
                            const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                            let cur: DrillModalData | undefined = modalData ?? undefined
                            while (cur) {
                              breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                              cur = cur.parentModal
                            }
                            debouncedModalContractsLoad(
                              breadcrumbFilters,
                              newOffset,
                              contractsSortBy ? `${contractsSortBy} ${contractsSortDir}` : 'award_date DESC'
                            )
                          }
                        }}
                        disabled={getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          border: '1px solid #ddd',
                          backgroundColor: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? '#f5f5f5' : 'white',
                          cursor: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? 'not-allowed' : 'pointer',
                          color: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) === 0 ? '#999' : '#333'
                        }}
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => {
                          const currentPage = getCurrentPage(modalData.tabs.contracts!.pageIndex || 0)
                          const totalPages = getTotalPages(modalData.tabs.contracts!.totalCount || 0)
                          console.log('Next button clicked - currentPage:', currentPage, 'totalPages:', totalPages, 'pageIndex:', modalData.tabs.contracts!.pageIndex)
                          if (currentPage < totalPages - 1) {
                            const newOffset = (modalData.tabs.contracts!.pageIndex || 0) + 20
                            console.log('Loading next page with offset:', newOffset, 'FIXED VERSION')
                            
                            const breadcrumbFilters: Array<{ dim: string; value: string }> = []
                            let cur: DrillModalData | undefined = modalData ?? undefined
                            while (cur) {
                              breadcrumbFilters.unshift({ dim: cur.srcDim, value: cur.srcVal })
                              cur = cur.parentModal
                            }
                            debouncedModalContractsLoad(
                              breadcrumbFilters,
                              newOffset,
                              contractsSortBy ? `${contractsSortBy} ${contractsSortDir}` : 'award_date DESC'
                            )
                          }
                        }}
                        disabled={getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getModalTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1}
                        style={{
                          padding: '4px 8px',
                          fontSize: 12,
                          border: '1px solid #ddd',
                          backgroundColor: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getModalTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? '#f5f5f5' : 'white',
                          cursor: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getModalTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? 'not-allowed' : 'pointer',
                          color: getModalCurrentPage(modalData.tabs.contracts!.pageIndex || 0) >= getModalTotalPages(modalData.tabs.contracts!.totalCount || 0) - 1 ? '#999' : '#333'
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
                            padding: spacing[3], 
                            color: colors.primary[600], 
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            wordWrap: 'break-word',
                            whiteSpace: 'normal',
                          }} 
                          onClick={() => onModalDrill(String(r.entity), activeTab as EntityType)}
                        >
                          {formatText(r.entity)}
                        </td>
                        <td style={{ 
                          padding: spacing[3],
                          wordWrap: 'break-word',
                          whiteSpace: 'normal',
                        }}>
                          {formatText(r.contract_count)}
                        </td>
                        <td style={{ 
                          padding: spacing[3],
                          wordWrap: 'break-word',
                          whiteSpace: 'normal',
                          textAlign: 'right',
                        }}>
                          {formatCurrency(r.total_contract_value)}
                        </td>
                        <td style={{ 
                          padding: spacing[3],
                          wordWrap: 'break-word',
                          whiteSpace: 'normal',
                          textAlign: 'right',
                        }}>
                          {formatCurrency(r.average_contract_value)}
                        </td>
                        <td style={{ 
                          padding: spacing[3],
                          wordWrap: 'break-word',
                          whiteSpace: 'normal',
                        }}>
                          {formatDate(r.first_contract_date)}
                        </td>
                        <td style={{ 
                          padding: spacing[3],
                          wordWrap: 'break-word',
                          whiteSpace: 'normal',
                        }}>
                          {formatDate(r.last_contract_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              
              {/* Empty state for related entities */}
              {modalData.tabs[activeTab]!.data.length === 0 && !modalData.tabs[activeTab]!.loading && (
                <div style={{
                  padding: spacing[8],
                  textAlign: 'center',
                  backgroundColor: colors.background.secondary,
                  borderTop: `1px solid ${colors.border.light}`,
                }}>
                  <div style={{
                    fontSize: typography.fontSize.lg,
                    color: colors.text.secondary,
                    marginBottom: spacing[3],
                  }}>
                    🔍
                  </div>
                  <p style={{
                    fontSize: typography.fontSize.sm,
                    color: colors.text.secondary,
                    margin: 0,
                  }}>
                    No related {getEntityTypeLabel(activeTab as EntityType).toLowerCase()} found
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Loading modal for database initialization
  if (dbInitializing) {
    console.log('Rendering database initialization modal, dbInitializing:', dbInitializing)
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
        zIndex: 9999,
      }}>
        <div style={{
          backgroundColor: colors.background.primary,
          borderRadius: commonStyles.borderRadius.lg,
          padding: spacing[8],
          textAlign: 'center',
          boxShadow: commonStyles.shadow.lg,
          maxWidth: '400px',
          margin: spacing[4],
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: spacing[4],
            animation: 'spin 1s linear infinite',
          }}>
            ⚙️
          </div>
          <h3 style={{
            ...typography.textStyles.h3,
            color: colors.text.primary,
            margin: `0 0 ${spacing[2]} 0`,
          }}>
            Initializing Database
          </h3>
          <p style={{
            fontSize: typography.fontSize.sm,
            color: colors.text.secondary,
            margin: 0,
          }}>
            Loading DuckDB-WASM and preparing data...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: `linear-gradient(135deg, ${colors.background.primary} 0%, ${colors.background.secondary} 100%)`,
      borderRadius: commonStyles.borderRadius.lg,
      boxShadow: commonStyles.shadow.base,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: spacing[6],
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
      }}>
        <h2 style={{
          ...typography.textStyles.h2,
          color: colors.text.primary,
          margin: `0 0 ${spacing[4]} 0`,
        }}>
          {dataset === 'contractors' ? 'Contractors' : 
           dataset === 'areas' ? 'Areas' : 
           dataset === 'organizations' ? 'Organizations' : 'Business Categories'}
        </h2>
        
        {/* Summary Cards */}
        <div style={{
          padding: spacing[6],
          borderBottom: `1px solid ${colors.border.light}`,
          backgroundColor: colors.background.secondary,
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: spacing[4],
          }}>
            {/* Total Contracts Card */}
            <div style={{
              padding: spacing[4],
              backgroundColor: colors.background.primary,
              borderRadius: commonStyles.borderRadius.lg,
              boxShadow: commonStyles.shadow.sm,
              border: `1px solid ${colors.border.light}`,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing[2],
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: colors.primary[100],
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  📊
                </div>
                <div style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: typography.fontWeight.medium,
                }}>
                  Total Contracts
                </div>
              </div>
              <div style={{
                fontSize: typography.fontSize['2xl'],
                fontWeight: typography.fontWeight.bold,
                color: colors.text.primary,
                marginBottom: spacing[1],
              }}>
                {summaryStats.totalContracts.toLocaleString()}
              </div>
              <div style={{
                fontSize: typography.fontSize.sm,
                color: colors.text.secondary,
              }}>
                {dataset === 'contractors' ? 'Contractors' : 
                 dataset === 'areas' ? 'Areas' : 
                 dataset === 'organizations' ? 'Organizations' : 'Categories'}
              </div>
            </div>

            {/* Total Value Card */}
            <div style={{
              padding: spacing[4],
              backgroundColor: colors.background.primary,
              borderRadius: commonStyles.borderRadius.lg,
              boxShadow: commonStyles.shadow.sm,
              border: `1px solid ${colors.border.light}`,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing[2],
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: colors.primary[100],
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  💰
                </div>
                <div style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: typography.fontWeight.medium,
                }}>
                  Total Value
                </div>
              </div>
              <div style={{
                fontSize: typography.fontSize['2xl'],
                fontWeight: typography.fontWeight.bold,
                color: colors.text.primary,
                marginBottom: spacing[1],
              }}>
                {formatCurrency(summaryStats.totalValue)}
              </div>
              <div style={{
                fontSize: typography.fontSize.sm,
                color: colors.text.secondary,
              }}>
                Contract Value
              </div>
            </div>

            {/* Average Value Card */}
            <div style={{
              padding: spacing[4],
              backgroundColor: colors.background.primary,
              borderRadius: commonStyles.borderRadius.lg,
              boxShadow: commonStyles.shadow.sm,
              border: `1px solid ${colors.border.light}`,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing[2],
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: colors.primary[100],
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  📈
                </div>
                <div style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: typography.fontWeight.medium,
                }}>
                  Average Value
                </div>
              </div>
              <div style={{
                fontSize: typography.fontSize['2xl'],
                fontWeight: typography.fontWeight.bold,
                color: colors.text.primary,
                marginBottom: spacing[1],
              }}>
                {formatCurrency(summaryStats.averageValue)}
              </div>
              <div style={{
                fontSize: typography.fontSize.sm,
                color: colors.text.secondary,
              }}>
                Per Contract
              </div>
            </div>

            {/* Top Entity Card */}
            <div style={{
              padding: spacing[4],
              backgroundColor: colors.background.primary,
              borderRadius: commonStyles.borderRadius.lg,
              boxShadow: commonStyles.shadow.sm,
              border: `1px solid ${colors.border.light}`,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: spacing[2],
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  backgroundColor: colors.primary[100],
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                }}>
                  🏆
                </div>
                <div style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: typography.fontWeight.medium,
                }}>
                  Top {dataset === 'contractors' ? 'Contractor' : 
                       dataset === 'areas' ? 'Area' : 
                       dataset === 'organizations' ? 'Organization' : 'Category'}
                </div>
              </div>
              <div style={{
                fontSize: typography.fontSize.lg,
                fontWeight: typography.fontWeight.bold,
                color: colors.text.primary,
                marginBottom: spacing[1],
                wordWrap: 'break-word',
                whiteSpace: 'normal',
              }}>
                {formatText(summaryStats.topEntity)}
              </div>
              <div style={{
                fontSize: typography.fontSize.sm,
                color: colors.text.secondary,
              }}>
                {formatCurrency(summaryStats.topEntityValue)}
              </div>
            </div>
          </div>
        </div>
        
        {/* Controls */}
        <div style={{
          display: 'flex',
          gap: spacing[4],
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: spacing[4],
        }}>
          <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
            <label style={{
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              color: colors.text.primary,
            }}>
              Dataset:
            </label>
            <select 
              value={dataset} 
              onChange={e => { 
                setPageIndex(0)
                setDataset(e.target.value as any)
              }}
              disabled={loading || debouncing}
              style={{
                padding: `${spacing[2]} ${spacing[3]}`,
                border: `1px solid ${colors.border.medium}`,
                borderRadius: commonStyles.borderRadius.md,
                fontSize: typography.fontSize.sm,
                backgroundColor: colors.background.primary,
                color: colors.text.primary,
              }}
            >
              <option value="contractors">Contractors</option>
              <option value="areas">Areas</option>
              <option value="organizations">Organizations</option>
              <option value="categories">Business Categories</option>
            </select>
          </div>
        
          <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
            <label style={{
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              color: colors.text.primary,
            }}>
              Time Range:
            </label>
            <select 
              value={timeRange} 
              onChange={e => { 
                setPageIndex(0)
                setTimeRange(e.target.value as any)
              }}
              disabled={loading || debouncing}
              style={{
                padding: `${spacing[2]} ${spacing[3]}`,
                border: `1px solid ${colors.border.medium}`,
                borderRadius: commonStyles.borderRadius.md,
                fontSize: typography.fontSize.sm,
                backgroundColor: colors.background.primary,
                color: colors.text.primary,
              }}
            >
              <option value="all_time">All Time</option>
              <option value="yearly">Yearly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
        
        {timeRange === 'yearly' && (
          <>
            <label>Year:</label>
            <select 
              value={selectedYear} 
              onChange={e => { 
                setPageIndex(0)
                setSelectedYear(Number(e.target.value))
              }}
              disabled={loading || debouncing}
            >
              {Array.from({ length: 9 }, (_, i) => 2013 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </>
        )}
        
        {timeRange === 'quarterly' && (
          <>
            <label>Year:</label>
            <select 
              value={selectedYear} 
              onChange={e => { 
                setPageIndex(0)
                setSelectedYear(Number(e.target.value))
              }}
              disabled={loading || debouncing}
            >
              {Array.from({ length: 9 }, (_, i) => 2013 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <label>Quarter:</label>
            <select 
              value={selectedQuarter} 
              onChange={e => { 
                setPageIndex(0)
                setSelectedQuarter(Number(e.target.value))
              }}
              disabled={loading || debouncing}
            >
              <option value={1}>Q1</option>
              <option value={2}>Q2</option>
              <option value={3}>Q3</option>
              <option value={4}>Q4</option>
            </select>
          </>
        )}
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <input
            placeholder="Search entities..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            onKeyDown={(e) => { 
              if (e.key === 'Enter') { 
                setPageIndex(0)
                debouncedLoad(0) 
              } 
            }}
            style={{
              width: '100%',
              padding: `${spacing[2]} ${spacing[3]}`,
              paddingRight: nameFilter ? spacing[8] : spacing[3],
              border: `1px solid ${colors.border.medium}`,
              borderRadius: commonStyles.borderRadius.md,
              fontSize: typography.fontSize.sm,
              backgroundColor: colors.background.primary,
              color: colors.text.primary,
              transition: commonStyles.transition.fast,
            }}
            onFocus={(e) => {
              e.target.style.borderColor = colors.primary[500]
              e.target.style.boxShadow = `0 0 0 3px ${colors.primary[100]}`
            }}
            onBlur={(e) => {
              e.target.style.borderColor = colors.border.medium
              e.target.style.boxShadow = 'none'
            }}
          />
          {nameFilter && (
            <button
              onClick={() => {
                setNameFilter('')
                setPageIndex(0)
                debouncedLoad(0)
              }}
              style={{
                position: 'absolute',
                right: spacing[2],
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: colors.gray[400],
                cursor: 'pointer',
                fontSize: typography.fontSize.sm,
                padding: spacing[1],
                borderRadius: commonStyles.borderRadius.sm,
                transition: commonStyles.transition.fast,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = colors.gray[600]
                e.currentTarget.style.backgroundColor = colors.gray[100]
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = colors.gray[400]
                e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              ✕
            </button>
          )}
        </div>
        <button 
          onClick={() => { 
            setPageIndex(0)
            debouncedLoad(0) 
          }}
          disabled={loading || debouncing}
          style={{
            padding: `${spacing[2]} ${spacing[4]}`,
            border: `1px solid ${colors.primary[600]}`,
            borderRadius: commonStyles.borderRadius.md,
            backgroundColor: loading || debouncing ? colors.gray[100] : colors.primary[600],
            color: loading || debouncing ? colors.gray[400] : colors.background.primary,
            cursor: loading || debouncing ? 'not-allowed' : 'pointer',
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.medium,
            transition: commonStyles.transition.fast,
            boxShadow: loading || debouncing ? 'none' : commonStyles.shadow.sm,
          }}
          onMouseOver={(e) => {
            if (!loading && !debouncing) {
              e.currentTarget.style.backgroundColor = colors.primary[700]
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = commonStyles.shadow.md
            }
          }}
          onMouseOut={(e) => {
            if (!loading && !debouncing) {
              e.currentTarget.style.backgroundColor = colors.primary[600]
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = commonStyles.shadow.sm
            }
          }}
        >
          {loading ? 'Loading...' : debouncing ? 'Searching...' : 'Search'}
        </button>
        
        {/* Export Button - Hidden for now but logic kept */}
        {false && (
          <button
            onClick={() => {
              const csvContent = generateCSV(rows)
              downloadCSV(csvContent, `${dataset}_${timeRange}_${selectedYear}_${selectedQuarter}.csv`)
            }}
            disabled={loading || debouncing || rows.length === 0}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              border: `1px solid ${colors.primary[600]}`,
              borderRadius: commonStyles.borderRadius.md,
              backgroundColor: loading || debouncing || rows.length === 0 ? colors.gray[100] : colors.primary[600],
              color: loading || debouncing || rows.length === 0 ? colors.gray[400] : colors.background.primary,
              cursor: loading || debouncing || rows.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              transition: commonStyles.transition.fast,
              boxShadow: loading || debouncing || rows.length === 0 ? 'none' : commonStyles.shadow.sm,
            }}
            onMouseOver={(e) => {
              if (!loading && !debouncing && rows.length > 0) {
                e.currentTarget.style.backgroundColor = colors.primary[700]
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.md
              }
            }}
            onMouseOut={(e) => {
              if (!loading && !debouncing && rows.length > 0) {
                e.currentTarget.style.backgroundColor = colors.primary[600]
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.sm
              }
            }}
          >
            📥 Export CSV
          </button>
        )}
      </div>

      {/* Quick Filters */}
      <div style={{
        padding: `${spacing[4]} ${spacing[6]}`,
        borderBottom: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
      }}>
        <div style={{
          display: 'flex',
          gap: spacing[2],
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: typography.fontSize.sm,
            fontWeight: typography.fontWeight.medium,
            color: colors.text.primary,
            marginRight: spacing[2],
          }}>
            Quick Filters:
          </span>
          {[
            { label: 'All Time', timeRange: 'all_time', year: 2021, quarter: 4 },
            { label: '2021', timeRange: 'yearly', year: 2021, quarter: 4 },
            { label: '2020', timeRange: 'yearly', year: 2020, quarter: 4 },
            { label: 'Q4 2021', timeRange: 'quarterly', year: 2021, quarter: 4 },
            { label: 'Q3 2021', timeRange: 'quarterly', year: 2021, quarter: 3 },
          ].map((filter, idx) => (
            <button
              key={idx}
              onClick={() => {
                setTimeRange(filter.timeRange as any)
                setSelectedYear(filter.year)
                setSelectedQuarter(filter.quarter)
                setPageIndex(0)
              }}
              disabled={loading || debouncing}
              style={{
                padding: `${spacing[1]} ${spacing[3]}`,
                border: `1px solid ${colors.border.medium}`,
                borderRadius: commonStyles.borderRadius.md,
                backgroundColor: timeRange === filter.timeRange && selectedYear === filter.year && selectedQuarter === filter.quarter 
                  ? colors.primary[600] 
                  : colors.background.primary,
                color: timeRange === filter.timeRange && selectedYear === filter.year && selectedQuarter === filter.quarter 
                  ? colors.background.primary 
                  : colors.text.primary,
                cursor: loading || debouncing ? 'not-allowed' : 'pointer',
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.medium,
                transition: commonStyles.transition.fast,
                opacity: loading || debouncing ? 0.6 : 1,
              }}
              onMouseOver={(e) => {
                if (!loading && !debouncing) {
                  e.currentTarget.style.backgroundColor = timeRange === filter.timeRange && selectedYear === filter.year && selectedQuarter === filter.quarter 
                    ? colors.primary[700] 
                    : colors.primary[50]
                }
              }}
              onMouseOut={(e) => {
                if (!loading && !debouncing) {
                  e.currentTarget.style.backgroundColor = timeRange === filter.timeRange && selectedYear === filter.year && selectedQuarter === filter.quarter 
                    ? colors.primary[600] 
                    : colors.background.primary
                }
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
        {/* Status */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: `${spacing[3]} ${spacing[4]}`,
          backgroundColor: colors.background.secondary,
          borderTop: `1px solid ${colors.border.light}`,
          fontSize: typography.fontSize.sm,
          color: colors.text.secondary,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[4] }}>
            <span style={{ 
              fontWeight: typography.fontWeight.medium,
              color: colors.text.primary 
            }}>
              {total.toLocaleString()} records
            </span>
            {nameFilter && (
              <span style={{
                padding: `${spacing[1]} ${spacing[2]}`,
                backgroundColor: colors.primary[100],
                color: colors.primary[700],
                borderRadius: commonStyles.borderRadius.sm,
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.medium,
              }}>
                Filtered by: "{nameFilter}"
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            {debouncing && (
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: spacing[1],
                color: colors.primary[600], 
                fontSize: typography.fontSize.xs,
                fontStyle: 'italic'
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  border: `2px solid ${colors.primary[300]}`,
                  borderTop: `2px solid ${colors.primary[600]}`,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                Debouncing... (1s)
              </div>
            )}
            {loading && (
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: spacing[1],
                color: colors.primary[600]
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  border: `2px solid ${colors.primary[300]}`,
                  borderTop: `2px solid ${colors.primary[600]}`,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                Loading...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          padding: spacing[4],
          backgroundColor: colors.error[50],
          border: `1px solid ${colors.error[500]}`,
          color: colors.error[600],
          fontSize: typography.fontSize.sm,
        }}>
          Error: {error}
        </div>
      )}

      {/* Data Table */}
      <div style={{ overflow: 'auto', position: 'relative' }}>
        {loading && (() => {
          console.log('Rendering data loading overlay, loading:', loading)
          return (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing[3],
              padding: spacing[4],
              backgroundColor: colors.background.primary,
              borderRadius: commonStyles.borderRadius.lg,
              boxShadow: commonStyles.shadow.lg,
            }}>
              <div style={{
                width: '20px',
                height: '20px',
                border: `2px solid ${colors.gray[300]}`,
                borderTop: `2px solid ${colors.primary[600]}`,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <span style={{
                fontSize: typography.fontSize.sm,
                color: colors.text.primary,
                fontWeight: typography.fontWeight.medium,
              }}>
                Loading data...
              </span>
            </div>
          </div>
          )
        })()}
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: typography.fontSize.sm,
        }}>
          <thead>
            <tr style={{ 
              backgroundColor: colors.background.secondary,
              boxShadow: `0 2px 4px ${colors.gray[100]}`,
            }}>
              {columns.map(c => (
                <th 
                  key={c.key} 
                  style={{
                    padding: spacing[4],
                    textAlign: 'left',
                    fontWeight: typography.fontWeight.semibold,
                    color: colors.text.primary,
                    borderBottom: `2px solid ${colors.border.medium}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: commonStyles.transition.fast,
                    position: 'relative',
                  }}
                  onClick={() => {
                    const newDir = sortBy === c.key && sortDir === 'DESC' ? 'ASC' : 'DESC'
                    setSortBy(c.key)
                    setSortDir(newDir)
                    setPageIndex(0)
                    debouncedLoad(0)
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = colors.gray[100]
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = colors.background.secondary
                  }}
                >
                  {c.label} {sortBy === c.key ? (sortDir === 'DESC' ? '↓' : '↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              // Loading skeleton
              Array.from({ length: 5 }, (_, idx) => (
                <tr key={`skeleton-${idx}`} style={{ borderBottom: `1px solid ${colors.border.light}` }}>
                  {columns.map((_, colIdx) => (
                    <td 
                      key={colIdx}
                      style={{ 
                        padding: spacing[3],
                        height: '48px',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{
                        width: colIdx === 0 ? '80%' : colIdx === 1 ? '60%' : '40%',
                        height: '16px',
                        backgroundColor: colors.gray[200],
                        borderRadius: commonStyles.borderRadius.sm,
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              rows.map((r, idx) => (
              <tr 
                key={idx}
                style={{
                  borderBottom: `1px solid ${colors.border.light}`,
                  transition: commonStyles.transition.fast,
                  cursor: 'pointer',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = colors.primary[50]
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = `0 4px 8px ${colors.gray[200]}`
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <td 
                  style={{ 
                    padding: spacing[3],
                    color: colors.primary[600],
                    cursor: 'pointer',
                    fontWeight: typography.fontWeight.medium,
                    wordWrap: 'break-word',
                    whiteSpace: 'normal',
                  }} 
                  onClick={() => onDrill(String(r.entity))}
                >
                  {formatText(r.entity)}
                </td>
                <td style={{ 
                  padding: spacing[3],
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                }}>
                  {formatText(r.contract_count)}
                </td>
                <td style={{ 
                  padding: spacing[3],
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                  textAlign: 'right',
                }}>
                  {formatCurrency(r.total_contract_value)}
                </td>
                <td style={{ 
                  padding: spacing[3],
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                  textAlign: 'right',
                }}>
                  {formatCurrency(r.average_contract_value)}
                </td>
                <td style={{ 
                  padding: spacing[3],
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                }}>
                  {formatDate(r.first_contract_date)}
                </td>
                <td style={{ 
                  padding: spacing[3],
                  wordWrap: 'break-word',
                  whiteSpace: 'normal',
                }}>
                  {formatDate(r.last_contract_date)}
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Empty State */}
      {rows.length === 0 && !loading && (
        <div style={{
          padding: spacing[12],
          textAlign: 'center',
          backgroundColor: colors.background.secondary,
          borderTop: `1px solid ${colors.border.light}`,
        }}>
          <div style={{
            fontSize: typography.fontSize.xl,
            color: colors.text.secondary,
            marginBottom: spacing[4],
          }}>
            📊
          </div>
          <h3 style={{
            ...typography.textStyles.h3,
            color: colors.text.primary,
            margin: `0 0 ${spacing[2]} 0`,
          }}>
            No data found
          </h3>
          <p style={{
            fontSize: typography.fontSize.sm,
            color: colors.text.secondary,
            margin: 0,
            maxWidth: '400px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            {nameFilter.trim() 
              ? `No results found for "${nameFilter}". Try adjusting your search terms.`
              : 'No data available for the selected criteria. Try changing the time range or dataset.'
            }
          </p>
          {nameFilter.trim() && (
            <button
              onClick={() => {
                setNameFilter('')
                setPageIndex(0)
                load(0)
              }}
              style={{
                marginTop: spacing[4],
                padding: `${spacing[2]} ${spacing[4]}`,
                border: `1px solid ${colors.primary[300]}`,
                borderRadius: commonStyles.borderRadius.md,
                backgroundColor: colors.primary[50],
                color: colors.primary[700],
                cursor: 'pointer',
                fontSize: typography.fontSize.sm,
                fontWeight: typography.fontWeight.medium,
                transition: commonStyles.transition.fast,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = colors.primary[100]
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = colors.primary[50]
              }}
            >
              Clear search filter
            </button>
          )}
        </div>
      )}

      {/* Pagination Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${spacing[4]} ${spacing[6]}`,
        borderTop: `1px solid ${colors.border.light}`,
        backgroundColor: colors.background.secondary,
      }}>
        <div style={{
          fontSize: typography.fontSize.sm,
          color: colors.text.secondary,
          display: 'flex',
          alignItems: 'center',
          gap: spacing[2],
        }}>
          <span>Showing</span>
          <span style={{ 
            fontWeight: typography.fontWeight.medium,
            color: colors.text.primary 
          }}>
            {pageIndex + 1}-{Math.min(pageIndex + pageSize, total)}
          </span>
          <span>of</span>
          <span style={{ 
            fontWeight: typography.fontWeight.medium,
            color: colors.text.primary 
          }}>
            {total.toLocaleString()}
          </span>
          <span>records</span>
        </div>
        
        <div style={{
          display: 'flex',
          gap: spacing[2],
          alignItems: 'center',
        }}>
          <button
            disabled={pageIndex === 0 || loading || debouncing}
            onClick={() => {
              const newPageIndex = Math.max(0, pageIndex - pageSize)
              setPageIndex(newPageIndex)
              debouncedLoad(newPageIndex)
            }}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              border: `1px solid ${colors.border.medium}`,
              borderRadius: commonStyles.borderRadius.md,
              backgroundColor: pageIndex === 0 || loading || debouncing ? colors.gray[100] : colors.background.primary,
              color: pageIndex === 0 || loading || debouncing ? colors.gray[400] : colors.text.primary,
              cursor: pageIndex === 0 || loading || debouncing ? 'not-allowed' : 'pointer',
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              transition: commonStyles.transition.fast,
              boxShadow: pageIndex === 0 || loading || debouncing ? 'none' : commonStyles.shadow.sm,
            }}
            onMouseOver={(e) => {
              if (pageIndex > 0 && !loading && !debouncing) {
                e.currentTarget.style.backgroundColor = colors.primary[50]
                e.currentTarget.style.borderColor = colors.primary[300]
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.md
              }
            }}
            onMouseOut={(e) => {
              if (pageIndex > 0 && !loading && !debouncing) {
                e.currentTarget.style.backgroundColor = colors.background.primary
                e.currentTarget.style.borderColor = colors.border.medium
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.sm
              }
            }}
          >
            ← Previous
          </button>
          
          <span style={{
            fontSize: typography.fontSize.sm,
            color: colors.text.secondary,
            padding: `0 ${spacing[2]}`,
          }}>
            Page {getCurrentPage(pageIndex)} of {getTotalPages(total)}
          </span>
          
          <button
            disabled={pageIndex + pageSize >= total || loading || debouncing}
            onClick={() => {
              const newPageIndex = pageIndex + pageSize
              setPageIndex(newPageIndex)
              debouncedLoad(newPageIndex)
            }}
            style={{
              padding: `${spacing[2]} ${spacing[4]}`,
              border: `1px solid ${colors.border.medium}`,
              borderRadius: commonStyles.borderRadius.md,
              backgroundColor: pageIndex + pageSize >= total || loading || debouncing ? colors.gray[100] : colors.background.primary,
              color: pageIndex + pageSize >= total || loading || debouncing ? colors.gray[400] : colors.text.primary,
              cursor: pageIndex + pageSize >= total || loading || debouncing ? 'not-allowed' : 'pointer',
              fontSize: typography.fontSize.sm,
              fontWeight: typography.fontWeight.medium,
              transition: commonStyles.transition.fast,
              boxShadow: pageIndex + pageSize >= total || loading || debouncing ? 'none' : commonStyles.shadow.sm,
            }}
            onMouseOver={(e) => {
              if (pageIndex + pageSize < total && !loading && !debouncing) {
                e.currentTarget.style.backgroundColor = colors.primary[50]
                e.currentTarget.style.borderColor = colors.primary[300]
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.md
              }
            }}
            onMouseOut={(e) => {
              if (pageIndex + pageSize < total && !loading && !debouncing) {
                e.currentTarget.style.backgroundColor = colors.background.primary
                e.currentTarget.style.borderColor = colors.border.medium
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = commonStyles.shadow.sm
              }
            }}
          >
            Next →
          </button>
        </div>
      </div>

      {renderModal()}
    </div>
  )
}


