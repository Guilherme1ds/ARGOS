import bcrypt from 'bcryptjs'
import { env } from '../config/env.js'
import { privacyNotice } from '../config/privacy-notice.js'
import { db, migrate } from '../db/database.js'
import { normalizeKey } from '../utils/normalization.js'

/**
 * Dados de demonstração para testar todos os papéis localmente: `npm run seed:dev` (só NODE_ENV=development).
 * Idempotente: rodar de novo restaura as senhas e os papéis das contas de teste sem duplicar nada.
 * Não envia e-mail: as contas já nascem confirmadas e os vínculos de gestão são gravados direto.
 */
if (env.NODE_ENV !== 'development') {
  console.error('seed:dev só roda com NODE_ENV=development (nunca em produção ou homologação).')
  process.exit(1)
}

export const demoPassword = 'Argos@Teste2026'

type Account = { email: string; name: string; role: 'citizen' | 'moderator' | 'support'; note: string }

const accounts: Account[] = [
  { email: 'cidadao@argos.local', name: 'Cidadã Teste', role: 'citizen', note: 'publica e reivindica; dona do caso encontrado' },
  { email: 'cidadao2@argos.local', name: 'Cidadão Dois', role: 'citizen', note: 'perdeu o celular; use para conversar com a outra cidadã' },
  { email: 'moderador@argos.local', name: 'Moderador Teste', role: 'moderator', note: 'casos, pistas, denúncias e mensagens sinalizadas' },
  { email: 'suporte@argos.local', name: 'Suporte Teste', role: 'support', note: 'consulta contas e aprova solicitações de acesso' },
  { email: 'gestor.org@argos.local', name: 'Gestora da Organização', role: 'citizen', note: 'administra a organização Campus Demonstração' },
  { email: 'gestor.espaco@argos.local', name: 'Gestor da Biblioteca', role: 'citizen', note: 'gere o espaço Biblioteca (custódia e devoluções)' },
]

migrate()

const passwordHash = bcrypt.hashSync(demoPassword, 10)

const seed = db.transaction(() => {
  const ids = new Map<string, number>()
  for (const account of accounts) {
    db.prepare(
      `INSERT INTO users (name, email, password_hash, role, status, email_verified_at)
       VALUES (@name, @email, @passwordHash, @role, 'active', CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO UPDATE SET
         name = excluded.name, password_hash = excluded.password_hash, role = excluded.role, status = 'active',
         spam_score = 0, chat_muted_until = NULL, email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP`,
    ).run({ ...account, passwordHash })
    const id = (db.prepare('SELECT id FROM users WHERE email = ?').get(account.email) as { id: number }).id
    ids.set(account.email, id)
    db.prepare(
      `INSERT INTO privacy_consents (user_id, terms_version, purpose, granted, user_agent)
       SELECT ?, ?, 'account_registration', 1, 'seed-dev'
       WHERE NOT EXISTS (SELECT 1 FROM privacy_consents WHERE user_id = ? AND purpose = 'account_registration' AND terms_version = ?)`,
    ).run(id, privacyNotice.version, id, privacyNotice.version)
  }

  // Organização com dois espaços; vínculos de gestão gravados direto (sem convite por e-mail).
  const orgName = 'Campus Demonstração'
  db.prepare("INSERT OR IGNORE INTO organizations (name, name_key, description, created_by) VALUES (?, ?, 'Organização de exemplo para testes locais.', 1)").run(orgName, normalizeKey(orgName))
  const organizationId = (db.prepare('SELECT id FROM organizations WHERE name_key = ?').get(normalizeKey(orgName)) as { id: number }).id
  db.prepare("UPDATE organizations SET status = 'active' WHERE id = ?").run(organizationId)
  const spaceIds = new Map<string, number>()
  for (const [name, address] of [['Biblioteca', 'Bloco A, térreo'], ['Secretaria', 'Bloco B, sala 3']]) {
    db.prepare("INSERT OR IGNORE INTO spaces (organization_id, name, name_key, address) VALUES (?, ?, ?, ?)").run(organizationId, name, normalizeKey(name), address)
    const space = db.prepare('SELECT id FROM spaces WHERE organization_id = ? AND name_key = ?').get(organizationId, normalizeKey(name)) as { id: number }
    db.prepare("UPDATE spaces SET status = 'active' WHERE id = ?").run(space.id)
    spaceIds.set(name, space.id)
  }
  const member = db.prepare(
    `INSERT INTO organization_members (organization_id, space_id, user_id, role, created_by)
     SELECT ?, ?, ?, ?, 1 WHERE NOT EXISTS (
       SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ? AND role = ? AND COALESCE(space_id, 0) = ?)`,
  )
  member.run(organizationId, null, ids.get('gestor.org@argos.local'), 'org_admin', organizationId, ids.get('gestor.org@argos.local'), 'org_admin', 0)
  const library = spaceIds.get('Biblioteca')!
  member.run(organizationId, library, ids.get('gestor.espaco@argos.local'), 'space_manager', organizationId, ids.get('gestor.espaco@argos.local'), 'space_manager', library)

  // Casos de exemplo (criados uma vez, pelo título).
  const items = [
    {
      owner: 'cidadao@argos.local', type: 'found', title: 'Smartphone preto com capinha azul', category: 'Eletrônicos',
      description: 'Encontrado na mesa 4 da biblioteca, tela bloqueada. Entreguei no balcão.', location: 'Biblioteca', spaceId: library,
    },
    {
      owner: 'cidadao2@argos.local', type: 'lost', title: 'Celular preto perdido', category: 'Eletrônicos',
      description: 'Perdi meu celular preto ontem à tarde, acho que foi na biblioteca.', location: 'Bloco A', spaceId: null,
    },
    {
      owner: 'cidadao@argos.local', type: 'found', title: 'Guarda-chuva vermelho', category: 'Outros',
      description: 'Guarda-chuva vermelho esquecido na entrada da secretaria.', location: 'Bloco B', spaceId: spaceIds.get('Secretaria')!,
    },
  ]
  let created = 0
  for (const item of items) {
    if (db.prepare('SELECT 1 FROM items WHERE title = ?').get(item.title)) continue
    db.prepare(
      `INSERT INTO items (owner_id, type, title, description, category, category_key, location, location_key, event_date,
        status, approval_status, contact_preference, space_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now', 'localtime'), ?, 'approved', 'in_app', ?)`,
    ).run(
      ids.get(item.owner), item.type, item.title, item.description, item.category, normalizeKey(item.category),
      item.location, normalizeKey(item.location), item.type, item.spaceId,
    )
    created += 1
  }
  return { organizationId, created }
})

const result = seed()
console.log(`\nDados de demonstração prontos (organização #${result.organizationId}, ${result.created} casos novos).`)
console.log(`Senha de todas as contas abaixo: ${demoPassword}\n`)
console.table(accounts.map((account) => ({ login: account.email, papel: account.role, uso: account.note })))
console.log(`Administrador: ${env.ADMIN_EMAIL} (senha definida em ADMIN_PASSWORD no backend/.env).\n`)
db.close()
