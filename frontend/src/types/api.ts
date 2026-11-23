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
  /** Vínculos de gestão (organização/espaço); as permissões de escopo valem só dentro deles. */
  memberships?: Membership[]
}

export type ScopedRole = 'org_admin' | 'space_manager'

export type Membership = {
  organizationId: number
  organizationName: string
  spaceId: number | null
  spaceName: string | null
  role: ScopedRole
}

export type AppLanguage = 'pt-BR' | 'en-US' | 'es-ES'
export type AppTheme = 'system' | 'light' | 'dark'
export type DateFormat = 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'
export type NotificationPreferences = {
  emailEnabled: boolean
  inAppEnabled: boolean
  digestEnabled: boolean
}

export type Role = 'user' | 'citizen' | 'space_manager' | 'org_admin' | 'moderator' | 'support' | 'admin'
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
  | 'moderation:reports'
  | 'users:read'
  | 'access_requests:review'
  | 'custody:read'
  | 'custody:manage'
  | 'org:manage'
  | 'orgs:manage'
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
  space_id?: number | null
  space_name?: string | null
  organization_name?: string | null
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
  query: Partial<Record<'q' | 'type' | 'category' | 'location' | 'status' | 'from' | 'to' | 'hasImage' | 'sort' | 'spaceId', string | number | boolean>>
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

export type PublicSpace = {
  id: number
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  organizationId: number
  organizationName: string
}

export type Organization = {
  id: number
  name: string
  description: string | null
  contactEmail: string | null
  status: 'active' | 'archived'
  spacesCount: number
  membersCount: number
  myRoles?: ScopedRole[]
  canManage?: boolean
  createdAt: string
  updatedAt: string
}

export type Space = {
  id: number
  organizationId: number
  name: string
  description: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  status: 'active' | 'archived'
  itemsCount: number
  createdAt: string
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export type Invite = {
  id: number
  organizationId: number
  spaceId: number | null
  spaceName: string | null
  email: string
  role: ScopedRole
  status: InviteStatus
  invitedByName: string | null
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}

export type OrganizationMember = {
  id: number
  userId: number
  name: string
  email: string
  role: ScopedRole
  spaceId: number | null
  spaceName: string | null
  createdAt: string
}

export type OrganizationDetail = {
  organization: Organization
  spaces: Space[]
  members: OrganizationMember[]
  invites: Invite[]
}

export type ChatMessage = {
  id: number
  conversation_id: number
  mine: boolean
  body: string
  removed: boolean
  safetyNotice: 'contact_info' | 'payment_request' | null
  created_at: string
}

export type Conversation = {
  id: number
  status: 'open' | 'closed'
  closedByMe: boolean
  role: 'owner' | 'participant'
  item: { id: number; title: string; type: ItemType; status: ItemStatus; image_url: string | null }
  counterpart: { nickname: string; avatar_url: string | null }
  lastReadId: number
  unread: number
  lastMessage: ChatMessage | null
  lastMessageAt: string | null
  createdAt: string
}

export type FlaggedMessage = {
  id: number
  conversation_id: number
  body: string
  moderation_rule: string | null
  created_at: string
  sender_id: number
  sender_name: string
  reported: boolean
  item_id: number
  item_title: string
}

export type CustodyState = 'none' | 'in_custody' | 'in_transit' | 'handed_over' | 'disposed'
export type CustodyEventType = 'received' | 'stored' | 'transferred' | 'handed_over' | 'disposed' | 'note'

export type CustodyEvent = {
  id: number
  sequence: number
  type: CustodyEventType
  spaceId: number | null
  spaceName: string | null
  storageLocation: string | null
  claimId: number | null
  notes: string | null
  actorName: string | null
  occurredAt: string
  hash: string
  prevHash: string
}

export type CustodyChain = {
  item: { id: number; title: string; type: ItemType; status: ItemStatus; spaceId: number | null }
  state: CustodyState
  currentSpaceId: number | null
  chain: { valid: boolean; brokenAt: number | null }
  nextEvents: CustodyEventType[]
  data: CustodyEvent[]
}

export type CustodyPanelRow = {
  id: number
  title: string
  type: ItemType
  status: ItemStatus
  category: string
  image_url: string | null
  state: CustodyState
  last_event: CustodyEventType | null
  last_event_at: string | null
  storage_location: string | null
  custody_since: string | null
  space_id: number | null
  space_name: string | null
  open_claims: number
  overdue: boolean
}

export type FacetValue = { value: string; label: string; count: number }
export type SearchFacets = Record<'type' | 'status' | 'category' | 'space' | 'hasImage', FacetValue[]>

export type SynonymGroup = { id: number; terms: string[]; created_at: string; updated_at: string }

export type RetentionReport = Record<string, number>

export type RetentionStatus = {
  rules: RetentionRule[]
  lastRun: { at: string; trigger: 'schedule' | 'manual'; total: number } | null
  runs: Array<{ id: number; trigger: 'schedule' | 'manual'; total: number; report: RetentionReport; started_at: string; finished_at: string; actor_name: string | null }>
}

export type TrafficWindow = {
  minutes: number
  requests: number
  errors5xx: number
  errors4xx: number
  errorRatePercent: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export type SystemAlert = {
  id: number
  alert_key: string
  severity: 'warning' | 'critical'
  title: string
  detail: string
  status: 'firing' | 'resolved'
  value: number | null
  threshold: number | null
  fired_at: string
  last_seen_at: string
  resolved_at: string | null
}

export type ObservabilityOverview = {
  service: { name: string; environment: string; version: string; schemaVersion: number | null }
  process: { uptimeSeconds: number; startedAt: string; memoryRssMb: number; heapUsedMb: number; eventLoopDelayP99Ms: number; inFlightRequests: number; node: string }
  dependencies: { database: 'ok' | 'unavailable'; mail: 'configured' | 'not_configured'; tracingExport: 'enabled' | 'disabled'; metricsEndpoint: 'enabled' | 'disabled' }
  traffic: {
    last5m: TrafficWindow
    last60m: TrafficWindow
    series: Array<{ at: string; requests: number; errors: number; p95Ms: number }>
    routes: Array<{ route: string; count: number; errors: number; avgMs: number }>
  }
  tracing: { exported: number; dropped: number; failures: number }
  thresholds: { errorRatePercent: number; latencyP95Ms: number; mailFailures: number }
  business: Record<string, number | Record<string, number>> | null
  alerts: SystemAlert[]
  recentProblems: Array<{ ts: string; level: string; event: string; traceId?: string; message?: string }>
}
