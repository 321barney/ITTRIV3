'use client'
import { useState, useEffect } from 'react'
import { useUserStore, useUIStore } from '@/stores'
import type { Product } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProductsTable } from '@/components/features/products/products-table'
import { Plus, Upload, Download, Search } from 'lucide-react'

const mapProduct = (p: any): Product => ({
  id: p.id,
  storeId: p.store_id,
  sellerId: p.seller_id,
  sku: p.sku,
  title: p.title,
  price: Number(p.price ?? 0),
  currency: p.currency ?? 'USD',
  inventory: typeof p.inventory === 'number' ? p.inventory : undefined,
  status: p.status === 'discontinued' ? ('inactive' as any) : (p.status as any),
  attributesJson: p.attributes_json ?? {},
  createdAt: new Date(p.created_at),
  updatedAt: new Date(p.updated_at),
})

export default function ProductsPage() {
  const { currentStore } = useUserStore()
  const { addNotification } = useUIStore()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    const fetchProducts = async () => {
      if (!currentStore?.id) return
      setLoading(true)
      try {
        const res = await fetch(`/api/dashboard/products`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('products_fetch_failed')
        const json = await res.json()
        const items = Array.isArray(json?.items) ? json.items : (Array.isArray(json) ? json : [])
        setProducts(items.map(mapProduct))
      } catch (error) {
        addNotification({ title: 'Error', description: 'Failed to fetch products', type: 'error' })
      } finally {
        setLoading(false)
      }
    }
    fetchProducts()
  }, [currentStore, addNotification])

  const filteredProducts = products.filter(product => {
    const q = searchQuery.toLowerCase()
    const matchesSearch = product.title.toLowerCase().includes(q) || product.sku.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || product.status === statusFilter
    return matchesSearch && matchesStatus
  })

  if (!currentStore) {
    return <div className="text-center py-12"><h3 className="text-lg font-semibold">No store selected</h3><p className="text-muted-foreground">Please select a store to view products</p></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-gray-900">Products</h1><p className="text-gray-600">Manage products for {currentStore.name}</p></div>
        <div className="flex space-x-2">
          <Button variant="outline"><Upload className="h-4 w-4 mr-2" />Import</Button>
          <Button variant="outline"><Download className="h-4 w-4 mr-2" />Export</Button>
          <Button><Plus className="h-4 w-4 mr-2" />Add Product</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Product Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="discontinued">Discontinued</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div></div>
      ) : (
        <Card><CardContent className="p-0"><ProductsTable products={filteredProducts} /></CardContent></Card>
      )}

      {!loading && filteredProducts.length === 0 && (
        <div className="text-center py-12">
          <h3 className="text-lg font-semibold">No products found</h3>
          <p className="text-muted-foreground">{searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Add your first product to get started'}</p>
        </div>
      )}
    </div>
  )
}
