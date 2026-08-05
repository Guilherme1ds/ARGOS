export type User = {
  id: number
  name: string
  email: string
  role: 'user' | 'admin'
  status: 'pending' | 'active' | 'blocked'
  spamScore?: number
}

export type ItemStatus = 'lost' | 'found' | 'claimed' | 'returned'
export type ItemType = 'lost' | 'found'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type Item = {
  id: number
  owner_id: number
  owner_name?: string
  owner_email?: string
  type: ItemType
  title: string
  description: string
  category: string
  location: string
  campus_block?: string
  approximate_place?: string
  event_date: string
  status: ItemStatus
  approval_status: ApprovalStatus
  image_url?: string
  contact_preference: 'in_app' | 'email'
  created_at: string
}

export type DashboardMetrics = {
  lost: number
  found: number
  claimed: number
  returned: number
  pendingApproval: number
}
