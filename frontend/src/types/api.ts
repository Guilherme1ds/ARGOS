export type User = {
  id: number
  name: string
  nickname?: string | null
  email: string
  role: Role
  status: 'pending' | 'active' | 'blocked'
  spamScore?: number
  avatarUrl?: string | null
  phone?: string | null
  department?: string | null
  bio?: string | null
  preferredContact?: 'in_app' | 'email'
  language?: AppLanguage
  theme?: AppTheme
  timezone?: string
  dateFormat?: DateFormat
  compactMode?: boolean
  highContrast?: boolean
  notificationPreferences?: NotificationPreferences
  permissions?: Permission[]
}

export type AppLanguage = 'pt-BR' | 'en-US' | 'es-ES'
export type AppTheme = 'system' | 'light' | 'dark'
export type DateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
export type NotificationPreferences = {
  emailEnabled: boolean
  inAppEnabled: boolean
  digestEnabled: boolean
}

export type Role = 'user' | 'citizen' | 'space_manager' | 'org_admin' | 'support' | 'admin'
export type Permission =
  | 'items:read_public'
  | 'items:create'
  | 'items:update_own'
  | 'items:moderate'
  | 'items:return'
  | 'claims:create'
  | 'claims:review'
  | 'claims:read_private'
  | 'chat:send'
  | 'chat:moderate'
  | 'reports:read_org'
  | 'reports:export_org'
  | 'users:manage_org'
  | 'platform:admin'

export type ItemStatus = 'lost' | 'found' | 'claimed' | 'returned'
export type ItemType = 'lost' | 'found'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type Item = {
  id: number
  owner_id?: number
  owner_name?: string
  owner_nickname?: string | null
  owner_avatar_url?: string | null
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
  contact_preference?: 'in_app' | 'email'
  created_at: string
  comments_count?: number
  latest_comments?: FeedComment[]
}

export type FeedComment = {
  id: number
  item_id: number
  user_id: number
  author_name: string
  author_nickname?: string | null
  author_avatar_url?: string | null
  body: string
  created_at: string
}

export type DashboardMetrics = {
  lost: number
  found: number
  claimed: number
  returned: number
  pendingApproval: number
}

export type Claim = {
  id: number
  item_id: number
  claimant_id: number
  claimant_name?: string
  message: string
  proof_details: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  updated_at: string
}

export type ItemMatch = Pick<
  Item,
  'id' | 'type' | 'title' | 'category' | 'location' | 'campus_block' | 'approximate_place' | 'event_date' | 'status' | 'image_url'
> & {
  score: number
  reasons: string[]
}

export type SavedSearch = {
  id: number
  name: string
  query: Partial<Record<'q' | 'type' | 'category' | 'location' | 'status' | 'from' | 'to' | 'hasImage' | 'sort', string | boolean>>
  enabled: boolean
  created_at: string
  updated_at: string
}

export type Notification = {
  id: number
  user_id: number
  title: string
  body: string
  type: string
  action_url?: string | null
  read_at?: string | null
  created_at: string
}

export type AuditLog = {
  id: number
  actor_id?: number | null
  actor_name?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  metadata?: string | null
  ip_address?: string | null
  user_agent?: string | null
  created_at: string
}
