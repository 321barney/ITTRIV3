'use client'
import { useState, useEffect } from 'react'
import { useUserStore, useUIStore } from '@/stores'
import type { Order } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OrdersTable } from '@/components/features/orders/orders-table'
import { Download, Search } from 'lucide-react'

/**
 * Normalize a raw order record from the API into the Order interface used by the UI.
 *
 * The backend previously exposed `external_key` and `raw_payload_json` fields. In the
 * updated schema these fields have been renamed to `external_id` and `raw_payload`.
 * To maintain compatibility with older responses, we fall back to the legacy names when
 * the new names are absent.
 */
const mapOrder = (o: any): Order => ({
  id: o.id,
  storeId: o.store_id,
  externalKey: o.external_id ?? o.external_key,
  status: o.status as any,
  rawPayloadJson: o.raw_payload ?? o.raw_payload_json ?? {},
  customerId: o.customer_id ?? undefined,
  decidedBy: o.decided_by ?? undefined,
  decisionConfidence: typeof o.decision_confidence === 'number' ? o.decision_confidence : undefined,
  decisionReason: o.decision_reason ?? undefined,
  items: (o.items ?? []).map((it: any) => ({
    id: it.id,
    orderId: it.order_id,
    productId: it.product_id ?? undefined,
    sku: it.sku ?? '',
    qty: it.qty ?? 1,
    price: Number(it.price ?? 0),
    product: it.product
      ? {
          id: it.product.id,
          storeId: it.product.store_id,
          sellerId: it.product.seller_id,
          sku: it.product.sku,
          title: it.product.title,
          price: Number(it.product.price ?? 0),
          currency: it.product.currency ?? 'USD',
          status: it.product.status,
          createdAt: new Date(it.product.created_at),
          updatedAt: new Date(it.product.updated_at),
        }
      : undefined,
  })),
  customer: o.customer
    ? {
        id: o.customer.id ?? '',
        storeId: o.customer.store_id ?? o.store_id,
        name: o.customer.name ?? '',
        email: o.customer.email ?? '',
        phone: o.customer.phone ?? '',
        createdAt: new Date(o.customer.created_at ?? Date.now()),
      }
    : undefined,
  createdAt: new Date(o.created_at),
  updatedAt: new Date(o.updated_at),
});

export default function OrdersPage() {
  const { currentStore } = useUserStore()
  const { addNotification } = useUIStore()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  useEffect(() => {
    const fetchOrders = async () => {
      if (!currentStore?.id) return
      setLoading(true)
      try {
        const qs = new URLSearchParams({ storeId: currentStore.id, limit: '50' })
        const res = await fetch(`/api/dashboard/orders?${qs.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('orders_fetch_failed')
        const json = await res.json()
        const list = Array.isArray(json?.orders) ? json.orders : (Array.isArray(json) ? json : [])
        setOrders(list.map(mapOrder))
      } catch (error) {
        addNotification({ title: 'Error', description: 'Failed to fetch orders', type: 'error' })
      } finally {
        setLoading(false)
      }
    }
    fetchOrders()
  }, [currentStore, addNotification])

  const filteredOrders = orders.filter(order => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      order.externalKey?.toLowerCase().includes(q) ||
      order.customer?.name?.toLowerCase().includes(q) ||
      order.customer?.email?.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    return matchesSearch && matchesStatus
  })

  if (!currentStore) {
    return <div className="text-center py-12"><h3 className="text-lg font-semibold">No store selected</h3><p className="text-muted-foreground">Please select a store to view orders</p></div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold text-gray-900">Orders</h1><p className="text-gray-600">Manage orders for {currentStore.name}</p></div>
        <Button variant="outline"><Download className="h-4 w-4 mr-2" />Export Orders</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Order Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search orders..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="all">All Status</option>
              <option value="new">New</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div></div>
      ) : (
        <Card><CardContent className="p-0"><OrdersTable orders={filteredOrders} /></CardContent></Card>
      )}

      {!loading && filteredOrders.length === 0 && (
        <div className="text-center py-12">
          <h3 className="text-lg font-semibold">No orders found</h3>
          <p className="text-muted-foreground">{(searchQuery || statusFilter !== 'all') ? 'Try adjusting your filters' : 'No orders available for this store'}</p>
        </div>
      )}
    </div>
  )
}
