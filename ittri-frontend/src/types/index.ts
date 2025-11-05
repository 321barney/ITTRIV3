export interface User {
  id: string;
  email: string;
  companyName?: string;
  planCode: string;
  billingCycleStart: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Store {
  id: string;
  sellerId: string;
  name: string;
  gsheetUrl?: string;
  status: "active" | "inactive" | "suspended";
  createdAt: Date;
  updatedAt: Date;
  _count?: { products: number; orders: number };
}

export interface Product {
  id: string;
  storeId: string;
  sellerId: string;
  sku: string;
  title: string;
  price: number;
  currency: string;
  attributesJson?: Record<string, any>;
  inventory?: number;
  status: "active" | "inactive" | "out_of_stock";
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId?: string;
  sku?: string;
  qty: number;
  price?: number;
  metaJson?: Record<string, any>;
  product?: Product;
}

export interface Customer {
  id: string;
  storeId: string;
  email?: string;
  phone?: string;
  name?: string;
  metaJson?: Record<string, any>;
  createdAt: Date;
}

export interface Order {
  id: string;
  storeId: string;
  externalKey: string;
  status: "new" | "confirmed" | "canceled" | "review";
  rawPayloadJson: Record<string, any>;
  customerId?: string;
  decisionJson?: {
    decision: "CONFIRM" | "CANCEL" | "REVIEW";
    reason: string;
    confidence: number;
  };
  decidedBy?: "ai" | "human";
  decisionConfidence?: number;
  decisionReason?: string;
  customer?: Customer;
  items: OrderItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metaJson?: Record<string, any>;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  storeId: string;
  customerId?: string;
  origin: string;
  status: "open" | "closed" | "escalated";
  metaJson?: Record<string, any>;
  messages: Message[];
  customer?: Customer;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardMetrics {
  totalOrders: number;
  totalRevenue: number;
  aiConfirmationRate: number;
  avgResponseTime: number;
  activeConversations: number;
  ordersToday: number;
  revenueToday: number;
  conversionRate: number;
  topProducts: Array<{ product: Product; orderCount: number; revenue: number }>;
  ordersByStatus: Array<{ status: string; count: number; percentage: number }>;
  revenueByDay: Array<{ date: string; revenue: number; orders: number }>;
}

export interface SellerProfile {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string;
  whatsappApi?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegistrationRequest {
  // User fields
  email: string;
  companyName: string;
  planCode: string;

  // Seller profile fields
  sellerName: string;
  phoneNumber: string;
  whatsappApi?: string;

  // Store fields
  storeName: string;
  gsheetUrl?: string;

  // Security
  adminKey: string;
}

export interface RegistrationResponse {
  message: string;
  user: User;
  seller: SellerProfile;
  store: Store;
}
export interface RegistrationRequest {
  email: string
  password: string
  role: 'seller' | 'buyer'
  tier: 'starter' | 'pro' | 'enterprise'
  store_name: string
}

export interface RegistrationResponse {
  message: string
  user: User
  store?: Store
  apiKey?: string
}