export type User = {
  id: number
  name: string
  nickname?: string | null
  email: string
  emailVerified?: boolean
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
  latitude?: number | null
  longitude?: number | null
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
  status: ClaimStatus
  created_at: string
  updated_at: string
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

export type MyClaim = {
  id: number
  item_id: number
  status: ClaimStatus
  created_at: string
  item_title: string
  item_status: ItemStatus
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

export type MapItem = Pick<Item, 'id' | 'type' | 'title' | 'category' | 'location' | 'event_date' | 'status' | 'image_url'> & {
  latitude: number
  longitude: number
}

/** Integrações ligadas no servidor (GET /config). */
export type AppConfig = {
  map: { center: [number, number]; zoom: number }
  ai: boolean
  translation: 'deepl' | 'libretranslate' | null
  googleClientId: string | null
  turnstileSiteKey: string | null
  push: { publicKey: string }
  /** E-mail público de atendimento; null quando o servidor não define SUPPORT_EMAIL. */
  supportEmail?: string | null
}

export type ItemSuggestion = {
  title: string
  category: string
  description: string
  color: string
  distinctiveFeatures: string[]
}

export type ReportStatus = 'open' | 'in_review' | 'resolved' | 'dismissed'

/** Denúncia na fila de moderação (GET /admin/reports). */
export type ItemReport = {
  id: number
  item_id: number | null
  item_title: string
  reason: string
  status: ReportStatus
  reporter_id: number | null
  reporter_name: string | null
  assigned_to: number | null
  assignee_name: string | null
  resolution_note: string | null
  resolved_by: number | null
  resolver_name: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type AdminUser = {
  id: number
  name: string
  email: string
  role: Role
  status: 'pending' | 'active' | 'blocked'
  spam_score: number
  email_verified_at: string | null
  created_at: string
  publishing_restricted: boolean
}

export type RetentionRule = { data: string; days: number | null; note: string | null }

export type ConsentStatus = {
  currentVersion: string
  acceptedVersion: string | null
  acceptedAt: string | null
  upToDate: boolean
}

export type PrivacySummary = {
  termsVersion: string
  controller: string
  purposes: string[]
  publicDataPolicy: string
  userRights: string[]
  externalProcessors?: string
  retention?: RetentionRule[]
  consentStatus?: ConsentStatus | null
}
