'use client'
import { useState, useEffect } from 'react'
import { useUserStore, useUIStore } from '@/stores'
import type { Conversation } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { ConversationList } from '@/components/features/conversations/conversation-list'
import { ConversationView } from '@/components/features/conversations/conversation-view'

export default function ConversationsPage() {
  const { currentStore } = useUserStore()
  const { addNotification } = useUIStore()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchConversations = async () => {
      if (!currentStore?.id) return
      setLoading(true)
      try {
        const qs = new URLSearchParams({ store_id: currentStore.id, limit: '20' })
        const res = await fetch(`/api/dashboard/conversations?${qs.toString()}`, {
          credentials: 'include',
          cache: 'no-store',
        })
        if (!res.ok) throw new Error('conversations_fetch_failed')
        const json = await res.json()
        const list = Array.isArray(json?.conversations) ? json.conversations : []
        
        const convos: Conversation[] = list.map((c: any) => ({
          id: c.id,
          storeId: c.store_id,
          customerId: c.customer_id ?? 'unknown',
          origin: c.origin,
          status: c.status,
          customer: c.customer
            ? {
                id: c.customer.id ?? '',
                storeId: c.customer.store_id ?? c.store_id,
                name: c.customer.name ?? '',
                email: c.customer.email ?? '',
                createdAt: new Date(c.customer.created_at ?? Date.now()),
              }
            : undefined,
          messages: (c.messages ?? []).map((m: any) => ({
            id: m.id,
            conversationId: c.id,
            role: m.role ?? (m.direction === 'in' ? 'user' : 'assistant'),
            content: m.content ?? m.text ?? '',
            createdAt: new Date(m.created_at),
          })),
          createdAt: new Date(c.created_at),
          updatedAt: new Date(c.updated_at),
        }))

        setConversations(convos)
        if (convos.length) setActiveConversation(convos[0])
      } catch (e) {
        addNotification({ title: 'Error', description: 'Failed to fetch conversations', type: 'error' })
      } finally {
        setLoading(false)
      }
    }
    fetchConversations()
  }, [currentStore, addNotification])

  const handleSendMessage = (content: string) => {
    if (!activeConversation) return
    addNotification({ title: 'Message Sent', description: 'Your message has been sent to the customer', type: 'success' })
    const newMessage = { id: `message-${Date.now()}`, conversationId: activeConversation.id, role: 'assistant' as const, content, createdAt: new Date() }
    const updated = { ...activeConversation, messages: [...activeConversation.messages, newMessage], updatedAt: new Date() }
    setActiveConversation(updated)
    setConversations(conversations.map(c => c.id === updated.id ? updated : c))
  }

  if (!currentStore) return <div className="text-center py-12"><h3 className="text-lg font-semibold">No store selected</h3><p className="text-muted-foreground">Please select a store to view conversations</p></div>
  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div></div>

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold text-gray-900">Conversations</h1><p className="text-gray-600">Manage customer conversations for {currentStore.name}</p></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
        <Card className="lg:col-span-1">
          <CardContent className="p-0 h-full overflow-hidden">
            <div className="p-4 border-b"><h3 className="font-semibold">Active Conversations ({conversations.length})</h3></div>
            <div className="overflow-y-auto h-full p-4">
              {activeConversation && (
                <ConversationList
                  conversations={conversations}
                  activeConversation={activeConversation}
                  onSelectConversation={setActiveConversation}
                />
              )}
              {!activeConversation && (
                <div className="text-sm text-muted-foreground">No conversations found.</div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-0 h-full">
            {activeConversation ? (
              <ConversationView conversation={activeConversation} onSendMessage={handleSendMessage} />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <h3 className="text-lg font-semibold">Select a conversation</h3>
                  <p className="text-muted-foreground">Choose a conversation from the list to start messaging</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
