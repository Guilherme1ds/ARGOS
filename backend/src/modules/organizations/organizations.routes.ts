import { Router } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { db } from '../../db/database.js'
import { atomic } from '../../db/transaction.js'
import { auth } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { authorize, authorizeOrganization, can, hasPermission, type ScopedRole } from '../../shared/policies/permissions.js'
import { logAudit, notify } from '../../utils/audit.js'
import { asyncHandler, HttpError } from '../../utils/http.js'
import { queueMail } from '../../utils/mail.js'
import { normalizeKey } from '../../utils/normalization.js'

const router = Router()
const spacesRouter = Router()

export const inviteSubject = 'Convite para gerir um espaço no ARGOS'
const inviteTtlDays = 7

const coordinateFields = {
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
}

function pairedCoordinates(input: { latitude?: number | null; longitude?: number | null }) {
  return (input.latitude === undefined) === (input.longitude === undefined) && (input.latitude === null) === (input.longitude === null)
}
const coordinatesMessage = { message: 'Informe latitude e longitude juntas.', path: ['latitude'] }

const organizationSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(500).optional(),
  contactEmail: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(160)]).optional(),
})

const organizationUpdateSchema = organizationSchema.partial().extend({ status: z.enum(['active', 'archived']).optional() })

const spaceSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    address: z.string().trim().max(200).optional(),
    ...coordinateFields,
  })
  .refine(pairedCoordinates, coordinatesMessage)

const spaceUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    address: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'archived']).optional(),
    ...coordinateFields,
  })
  .refine(pairedCoordinates, coordinatesMessage)

const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(160),
    role: z.enum(['org_admin', 'space_manager']),
    spaceId: z.number().int().positive().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.role === 'space_manager' && !input.spaceId) {
      ctx.addIssue({ code: 'custom', path: ['spaceId'], message: 'Escolha o espaço que a pessoa vai gerir.' })
    }
    if (input.role === 'org_admin' && input.spaceId) {
      ctx.addIssue({ code: 'custom', path: ['spaceId'], message: 'O papel de administrador da organização não é ligado a um espaço.' })
    }
  })

const tokenSchema = z.object({ token: z.string().trim().min(20).max(200) })

type OrganizationRow = {
  id: number
  name: string
  description: string | null
  contact_email: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

type SpaceRow = {
  id: number
  organization_id: number
  name: string
  description: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

type InviteRow = {
  id: number
  organization_id: number
  space_id: number | null
  email: string
  role: ScopedRole
  status: 'pending' | 'accepted' | 'revoked'
  expires_at: string
  accepted_at: string | null
  created_at: string
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function cleanText(value: string | undefined) {
  return value === undefined ? undefined : value.trim() || null
}

function organizationDto(row: OrganizationRow & { spaces_count?: number; members_count?: number }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    contactEmail: row.contact_email,
    status: row.status,
    spacesCount: row.spaces_count ?? 0,
    membersCount: row.members_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function spaceDto(row: SpaceRow & { items_count?: number }) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    status: row.status,
    itemsCount: row.items_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Convite expirado continua "pending" no banco; a API informa o estado efetivo. */
function inviteDto(row: InviteRow & { space_name?: string | null; invited_by_name?: string | null }, now = Date.now()) {
  const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= now
  return {
    id: row.id,
    organizationId: row.organization_id,
    spaceId: row.space_id,
    spaceName: row.space_name ?? null,
    email: row.email,
    role: row.role,
    status: expired ? ('expired' as const) : row.status,
    invitedByName: row.invited_by_name ?? null,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  }
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`
}

const organizationSelect = `
  SELECT organizations.*,
         (SELECT COUNT(*) FROM spaces WHERE spaces.organization_id = organizations.id AND spaces.status = 'active') AS spaces_count,
         (SELECT COUNT(DISTINCT user_id) FROM organization_members WHERE organization_members.organization_id = organizations.id) AS members_count
  FROM organizations`

function findOrganization(id: unknown) {
  const row = db.prepare(`${organizationSelect} WHERE organizations.id = ?`).get(Number(id)) as
    | (OrganizationRow & { spaces_count: number; members_count: number })
    | undefined
  if (!row) throw new HttpError(404, 'Organização não encontrada.')
  return row
}

function findSpace(organizationId: number, spaceId: unknown) {
  const row = db.prepare('SELECT * FROM spaces WHERE id = ? AND organization_id = ?').get(Number(spaceId), organizationId) as SpaceRow | undefined
  if (!row) throw new HttpError(404, 'Espaço não encontrado.')
  return row
}

function uniqueViolation(error: unknown) {
  return String(error).includes('UNIQUE constraint failed')
}

// Espaços ativos de organizações ativas: lista pública para o formulário de publicação e os filtros da busca.
spacesRouter.get(
  '/',
  rateLimit(120, 60_000),
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT spaces.id, spaces.name, spaces.address, spaces.latitude, spaces.longitude,
                organizations.id AS organization_id, organizations.name AS organization_name
         FROM spaces JOIN organizations ON organizations.id = spaces.organization_id
         WHERE spaces.status = 'active' AND organizations.status = 'active'
         ORDER BY organizations.name COLLATE NOCASE, spaces.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: number; name: string; address: string | null; latitude: number | null; longitude: number | null; organization_id: number; organization_name: string }>
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
      })),
    })
  }),
)

// Administração da plataforma vê todas; as demais contas veem só as organizações em que têm vínculo.
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const all = hasPermission(req.user!.role, 'orgs:manage')
    const organizationIds = [...new Set((req.user!.memberships ?? []).map((membership) => membership.organizationId))]
    if (!all && !organizationIds.length) return res.json({ data: [] })
    const where = all ? '' : `WHERE organizations.id IN (${organizationIds.map(() => '?').join(', ')})`
    const rows = db
      .prepare(`${organizationSelect} ${where} ORDER BY organizations.name COLLATE NOCASE`)
      .all(...(all ? [] : organizationIds)) as Array<OrganizationRow & { spaces_count: number; members_count: number }>
    res.json({
      data: rows.map((row) => ({
        ...organizationDto(row),
        myRoles: (req.user!.memberships ?? []).filter((membership) => membership.organizationId === row.id).map((membership) => membership.role),
        canManage: can(req.user, 'org:manage', { organizationId: row.id }),
      })),
    })
  }),
)

router.post(
  '/',
  auth,
  authorize('orgs:manage'),
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = organizationSchema.parse(req.body)
    let id: number
    try {
      id = Number(
        db
          .prepare('INSERT INTO organizations (name, name_key, description, contact_email, created_by) VALUES (?, ?, ?, ?, ?)')
          .run(input.name, normalizeKey(input.name), cleanText(input.description) ?? null, cleanText(input.contactEmail) ?? null, req.user!.id)
          .lastInsertRowid,
      )
    } catch (error) {
      if (uniqueViolation(error)) throw new HttpError(409, 'Já existe uma organização com este nome.')
      throw error
    }
    logAudit(req, 'organization.created', 'organization', id, { name: input.name })
    res.status(201).json({ id, message: 'Organização criada.', organization: organizationDto(findOrganization(id)) })
  }),
)

// Convites: rotas literais antes de /:id.
router.post(
  '/invites/preview',
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = tokenSchema.parse(req.body)
    const invite = db
      .prepare(
        `SELECT manager_invites.*, organizations.name AS organization_name, spaces.name AS space_name
         FROM manager_invites
         JOIN organizations ON organizations.id = manager_invites.organization_id
         LEFT JOIN spaces ON spaces.id = manager_invites.space_id
         WHERE manager_invites.token_hash = ?`,
      )
      .get(hashToken(input.token)) as (InviteRow & { organization_name: string; space_name: string | null }) | undefined
    if (!invite) throw new HttpError(404, 'Convite não encontrado. Peça um novo convite a quem administra a organização.')
    const dto = inviteDto(invite)
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      invite: {
        organizationName: invite.organization_name,
        spaceName: invite.space_name,
        role: dto.role,
        status: dto.status,
        emailHint: maskEmail(invite.email),
        expiresAt: dto.expiresAt,
      },
    })
  }),
)

router.post(
  '/invites/accept',
  auth,
  rateLimit(10, 60_000),
  asyncHandler(async (req, res) => {
    const input = tokenSchema.parse(req.body)
    const result = atomic(() => {
      const invite = db
        .prepare(
          `SELECT manager_invites.*, organizations.name AS organization_name, organizations.status AS organization_status,
                  spaces.name AS space_name, spaces.status AS space_status
           FROM manager_invites
           JOIN organizations ON organizations.id = manager_invites.organization_id
           LEFT JOIN spaces ON spaces.id = manager_invites.space_id
           WHERE manager_invites.token_hash = ?`,
        )
        .get(hashToken(input.token)) as
        | (InviteRow & { invited_by: number | null; organization_name: string; organization_status: string; space_name: string | null; space_status: string | null })
        | undefined
      if (!invite) throw new HttpError(404, 'Convite não encontrado. Peça um novo convite a quem administra a organização.')
      if (invite.status === 'accepted') throw new HttpError(409, 'Este convite já foi aceito.', { code: 'invite_used' })
      if (invite.status === 'revoked') throw new HttpError(410, 'Este convite foi cancelado. Peça um novo convite.', { code: 'invite_revoked' })
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        throw new HttpError(410, 'Este convite expirou. Peça um novo convite.', { code: 'invite_expired' })
      }
      // O convite vale para o e-mail convidado: outra conta não herda o acesso mesmo que tenha o link.
      if (invite.email.toLowerCase() !== req.user!.email.toLowerCase()) {
        throw new HttpError(403, 'Este convite foi enviado para outro e-mail. Entre com a conta convidada para aceitar.', {
          code: 'invite_email_mismatch',
        })
      }
      if (invite.organization_status !== 'active' || (invite.space_id && invite.space_status !== 'active')) {
        throw new HttpError(409, 'A organização ou o espaço deste convite não está mais ativo.')
      }

      db.prepare(
        `INSERT OR IGNORE INTO organization_members (organization_id, space_id, user_id, role, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(invite.organization_id, invite.space_id, req.user!.id, invite.role, invite.invited_by)
      db.prepare("UPDATE manager_invites SET status = 'accepted', accepted_by = ?, accepted_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.user!.id, invite.id)
      logAudit(req, 'organization.invite_accepted', 'organization', invite.organization_id, {
        inviteId: invite.id,
        role: invite.role,
        spaceId: invite.space_id,
      })
      if (invite.invited_by && invite.invited_by !== req.user!.id) {
        notify(
          invite.invited_by,
          'Convite aceito',
          `${req.user!.name} aceitou o convite para ${invite.space_name ?? invite.organization_name}.`,
          'organization',
          '/organizations',
        )
      }
      return invite
    })
    res.json({
      message: 'Convite aceito. Você já pode gerir este espaço.',
      membership: { organizationId: result.organization_id, organizationName: result.organization_name, spaceId: result.space_id, spaceName: result.space_name, role: result.role },
    })
  }),
)

router.get(
  '/:id',
  auth,
  asyncHandler(async (req, res) => {
    const organization = findOrganization(req.params.id)
    const canManage = can(req.user, 'org:manage', { organizationId: organization.id })
    const myMemberships = (req.user!.memberships ?? []).filter((membership) => membership.organizationId === organization.id)
    if (!canManage && !myMemberships.length) throw new HttpError(403, 'Acesso negado para esta organização.')

    const spaces = db
      .prepare(
        `SELECT spaces.*, (SELECT COUNT(*) FROM items WHERE items.space_id = spaces.id) AS items_count
         FROM spaces WHERE organization_id = ? ORDER BY status, name COLLATE NOCASE`,
      )
      .all(organization.id) as Array<SpaceRow & { items_count: number }>
    // Gestor de espaço enxerga só os espaços que gere; membros e convites ficam com quem administra a organização.
    const visibleSpaces = canManage ? spaces : spaces.filter((space) => myMemberships.some((membership) => membership.spaceId === space.id))
    const members = canManage
      ? (db
          .prepare(
            `SELECT organization_members.id, organization_members.user_id, users.name, users.email, organization_members.role,
                    organization_members.space_id, spaces.name AS space_name, organization_members.created_at
             FROM organization_members
             JOIN users ON users.id = organization_members.user_id
             LEFT JOIN spaces ON spaces.id = organization_members.space_id
             WHERE organization_members.organization_id = ?
             ORDER BY organization_members.role, users.name COLLATE NOCASE`,
          )
          .all(organization.id) as Array<{ id: number; user_id: number; name: string; email: string; role: ScopedRole; space_id: number | null; space_name: string | null; created_at: string }>)
      : []
    const invites = canManage
      ? (db
          .prepare(
            `SELECT manager_invites.*, spaces.name AS space_name, users.name AS invited_by_name
             FROM manager_invites
             LEFT JOIN spaces ON spaces.id = manager_invites.space_id
             LEFT JOIN users ON users.id = manager_invites.invited_by
             WHERE manager_invites.organization_id = ? AND manager_invites.status <> 'revoked'
             ORDER BY manager_invites.created_at DESC, manager_invites.id DESC LIMIT 100`,
          )
          .all(organization.id) as Array<InviteRow & { space_name: string | null; invited_by_name: string | null }>)
      : []

    res.json({
      organization: { ...organizationDto(organization), canManage, myRoles: myMemberships.map((membership) => membership.role) },
      spaces: visibleSpaces.map(spaceDto),
      members: members.map((member) => ({
        id: member.id,
        userId: member.user_id,
        name: member.name,
        email: member.email,
        role: member.role,
        spaceId: member.space_id,
        spaceName: member.space_name,
        createdAt: member.created_at,
      })),
      invites: invites.map((invite) => inviteDto(invite)),
    })
  }),
)

router.patch(
  '/:id',
  auth,
  authorizeOrganization('org:manage'),
  asyncHandler(async (req, res) => {
    const input = organizationUpdateSchema.parse(req.body)
    const organization = findOrganization(req.params.id)
    // Arquivar tira a organização (e os vínculos dela) de operação: decisão da administração da plataforma.
    if (input.status && input.status !== organization.status && !hasPermission(req.user!.role, 'orgs:manage')) {
      throw new HttpError(403, 'Só a administração da plataforma arquiva ou reativa organizações.')
    }
    const name = input.name ?? organization.name
    try {
      db.prepare(
        `UPDATE organizations SET name = ?, name_key = ?, description = ?, contact_email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(
        name,
        normalizeKey(name),
        input.description === undefined ? organization.description : cleanText(input.description),
        input.contactEmail === undefined ? organization.contact_email : cleanText(input.contactEmail),
        input.status ?? organization.status,
        organization.id,
      )
    } catch (error) {
      if (uniqueViolation(error)) throw new HttpError(409, 'Já existe uma organização com este nome.')
      throw error
    }
    logAudit(req, 'organization.updated', 'organization', organization.id, input)
    res.json({ message: 'Organização atualizada.', organization: organizationDto(findOrganization(organization.id)) })
  }),
)

router.delete(
  '/:id',
  auth,
  authorize('orgs:manage'),
  asyncHandler(async (req, res) => {
    const organization = findOrganization(req.params.id)
    const linkedItems = db
      .prepare('SELECT COUNT(*) AS total FROM items JOIN spaces ON spaces.id = items.space_id WHERE spaces.organization_id = ?')
      .get(organization.id) as { total: number }
    // Casos continuam publicados, sem espaço; espaços, vínculos e convites saem em cascata.
    db.prepare('DELETE FROM organizations WHERE id = ?').run(organization.id)
    logAudit(req, 'organization.deleted', 'organization', organization.id, { name: organization.name, itemsUnlinked: linkedItems.total })
    res.json({ message: 'Organização excluída.' })
  }),
)

router.post(
  '/:id/spaces',
  auth,
  authorizeOrganization('org:manage'),
  rateLimit(30, 60_000),
  asyncHandler(async (req, res) => {
    const input = spaceSchema.parse(req.body)
    const organization = findOrganization(req.params.id)
    let id: number
    try {
      id = Number(
        db
          .prepare('INSERT INTO spaces (organization_id, name, name_key, description, address, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(organization.id, input.name, normalizeKey(input.name), cleanText(input.description) ?? null, cleanText(input.address) ?? null, input.latitude ?? null, input.longitude ?? null)
          .lastInsertRowid,
      )
    } catch (error) {
      if (uniqueViolation(error)) throw new HttpError(409, 'Esta organização já tem um espaço com este nome.')
      throw error
    }
    logAudit(req, 'space.created', 'space', id, { organizationId: organization.id, name: input.name })
    res.status(201).json({ id, message: 'Espaço criado.', space: spaceDto(findSpace(organization.id, id)) })
  }),
)

router.patch(
  '/:id/spaces/:spaceId',
  auth,
  authorizeOrganization('org:manage'),
  asyncHandler(async (req, res) => {
    const input = spaceUpdateSchema.parse(req.body)
    const organization = findOrganization(req.params.id)
    const space = findSpace(organization.id, req.params.spaceId)
    const name = input.name ?? space.name
    try {
      db.prepare(
        `UPDATE spaces SET name = ?, name_key = ?, description = ?, address = ?, latitude = ?, longitude = ?, status = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(
        name,
        normalizeKey(name),
        input.description === undefined ? space.description : cleanText(input.description),
        input.address === undefined ? space.address : cleanText(input.address),
        input.latitude === undefined ? space.latitude : input.latitude,
        input.longitude === undefined ? space.longitude : input.longitude,
        input.status ?? space.status,
        space.id,
      )
    } catch (error) {
      if (uniqueViolation(error)) throw new HttpError(409, 'Esta organização já tem um espaço com este nome.')
      throw error
    }
    logAudit(req, 'space.updated', 'space', space.id, { organizationId: organization.id, ...input })
    res.json({ message: 'Espaço atualizado.', space: spaceDto(findSpace(organization.id, space.id)) })
  }),
)

router.delete(
  '/:id/spaces/:spaceId',
  auth,
  authorizeOrganization('org:manage'),
  asyncHandler(async (req, res) => {
    const organization = findOrganization(req.params.id)
    const space = findSpace(organization.id, req.params.spaceId)
    const linked = db.prepare('SELECT COUNT(*) AS total FROM items WHERE space_id = ?').get(space.id) as { total: number }
    // Espaço com casos é arquivado (some das listas, mantém o histórico); sem casos, é removido de fato.
    if (linked.total > 0) {
      db.prepare("UPDATE spaces SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(space.id)
      logAudit(req, 'space.archived', 'space', space.id, { organizationId: organization.id, items: linked.total })
      return res.json({ message: 'Espaço arquivado: os casos ligados a ele foram mantidos.', archived: true })
    }
    db.prepare('DELETE FROM spaces WHERE id = ?').run(space.id)
    logAudit(req, 'space.deleted', 'space', space.id, { organizationId: organization.id, name: space.name })
    res.json({ message: 'Espaço excluído.', archived: false })
  }),
)

router.post(
  '/:id/invites',
  auth,
  authorizeOrganization('org:manage'),
  rateLimit(20, 60_000),
  asyncHandler(async (req, res) => {
    const input = inviteSchema.parse(req.body)
    const organization = findOrganization(req.params.id)
    if (organization.status !== 'active') throw new HttpError(409, 'Reative a organização antes de convidar gestores.')
    const space = input.spaceId ? findSpace(organization.id, input.spaceId) : null
    if (space && space.status !== 'active') throw new HttpError(409, 'Reative o espaço antes de convidar gestores.')

    const existingMember = db
      .prepare(
        `SELECT 1 FROM organization_members JOIN users ON users.id = organization_members.user_id
         WHERE organization_members.organization_id = ? AND organization_members.role = ?
           AND COALESCE(organization_members.space_id, 0) = ? AND LOWER(users.email) = ?`,
      )
      .get(organization.id, input.role, space?.id ?? 0, input.email)
    if (existingMember) throw new HttpError(409, 'Esta pessoa já tem este papel aqui.')

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + inviteTtlDays * 86_400_000)
    const id = atomic(() => {
      // Um convite pendente por pessoa/papel/espaço: reenviar cancela o anterior (o link antigo deixa de valer).
      db.prepare(
        `UPDATE manager_invites SET status = 'revoked'
         WHERE organization_id = ? AND email = ? AND role = ? AND COALESCE(space_id, 0) = ? AND status = 'pending'`,
      ).run(organization.id, input.email, input.role, space?.id ?? 0)
      const inviteId = Number(
        db
          .prepare('INSERT INTO manager_invites (organization_id, space_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(organization.id, space?.id ?? null, input.email, input.role, hashToken(token), req.user!.id, expiresAt.toISOString())
          .lastInsertRowid,
      )
      // O e-mail convidado não entra na auditoria em texto: fica o identificador do convite.
      logAudit(req, 'organization.invite_created', 'organization', organization.id, { inviteId, role: input.role, spaceId: space?.id ?? null })
      const target = space ? `o espaço "${space.name}" (${organization.name})` : `a organização "${organization.name}"`
      const roleText = input.role === 'org_admin' ? 'administrar' : 'gerir'
      queueMail(
        input.email,
        inviteSubject,
        `${req.user!.name} convidou você para ${roleText} ${target} no ARGOS.\n\n` +
          `Para aceitar, entre (ou crie sua conta) com este e-mail e abra: ${env.FRONTEND_URL.replace(/\/$/, '')}/invite#token=${token}\n` +
          `O convite expira em ${inviteTtlDays} dias e só pode ser usado uma vez. Se você não esperava este convite, ignore esta mensagem.`,
        { sensitive: true, expiresAt: expiresAt.getTime() },
      )
      return inviteId
    })
    const invite = db
      .prepare('SELECT manager_invites.*, spaces.name AS space_name FROM manager_invites LEFT JOIN spaces ON spaces.id = manager_invites.space_id WHERE manager_invites.id = ?')
      .get(id) as InviteRow & { space_name: string | null }
    res.status(201).json({ id, message: 'Convite enviado por e-mail.', invite: inviteDto({ ...invite, invited_by_name: req.user!.name }) })
  }),
)

router.delete(
  '/:id/invites/:inviteId',
  auth,
  authorizeOrganization('org:manage'),
  asyncHandler(async (req, res) => {
    const organization = findOrganization(req.params.id)
    const changed = db
      .prepare("UPDATE manager_invites SET status = 'revoked' WHERE id = ? AND organization_id = ? AND status = 'pending'")
      .run(req.params.inviteId, organization.id).changes
    if (!changed) throw new HttpError(404, 'Convite pendente não encontrado.')
    logAudit(req, 'organization.invite_revoked', 'organization', organization.id, { inviteId: Number(req.params.inviteId) })
    res.json({ message: 'Convite cancelado.' })
  }),
)

router.delete(
  '/:id/members/:memberId',
  auth,
  authorizeOrganization('org:manage'),
  asyncHandler(async (req, res) => {
    const organization = findOrganization(req.params.id)
    const member = db.prepare('SELECT id, user_id, role, space_id FROM organization_members WHERE id = ? AND organization_id = ?').get(req.params.memberId, organization.id) as
      | { id: number; user_id: number; role: ScopedRole; space_id: number | null }
      | undefined
    if (!member) throw new HttpError(404, 'Vínculo não encontrado.')
    atomic(() => {
      // Uma organização não fica sem quem a administre por engano de quem está saindo.
      if (member.role === 'org_admin' && member.user_id === req.user!.id && !hasPermission(req.user!.role, 'orgs:manage')) {
        const others = db
          .prepare("SELECT COUNT(*) AS total FROM organization_members WHERE organization_id = ? AND role = 'org_admin' AND id <> ?")
          .get(organization.id, member.id) as { total: number }
        if (!others.total) throw new HttpError(422, 'Convide outra pessoa para administrar a organização antes de sair.')
      }
      db.prepare('DELETE FROM organization_members WHERE id = ?').run(member.id)
      logAudit(req, 'organization.member_removed', 'organization', organization.id, { userId: member.user_id, role: member.role, spaceId: member.space_id })
      if (member.user_id !== req.user!.id) {
        notify(member.user_id, 'Acesso de gestão removido', `Seu vínculo com "${organization.name}" foi removido.`, 'organization')
      }
    })
    res.json({ message: 'Vínculo removido.' })
  }),
)

export { router as organizationRoutes, spacesRouter as spaceRoutes }
