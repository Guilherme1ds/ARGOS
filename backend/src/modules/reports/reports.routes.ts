import { Router } from 'express'
import { db } from '../../db/database.js'
import { auth } from '../../middleware/auth.js'
import { authorize } from '../../shared/policies/permissions.js'
import { logAudit } from '../../utils/audit.js'
import { asyncHandler } from '../../utils/http.js'

const router = Router()
router.use(auth, authorize('reports:export_org'))

// Início que Excel/LibreOffice/Google Sheets interpretam como fórmula ou comando:
// = + - @, tabulação, CR/LF e variantes Unicode (largura total ＝＋－＠, formas pequenas e o sinal de menos),
// mesmo depois de espaços ou caracteres de controle que algumas planilhas descartam.
const formulaTrigger = /^[\s\u0000-\u001f  -​　﻿]*[=+\-@＝＋－＠﹢﹣﹦﹫−]|^[\t\r\n]/

/**
 * Valor de célula CSV seguro para planilhas: textos que começariam uma fórmula recebem um apóstrofo
 * no início (a planilha mostra o texto literal), e todo campo vai entre aspas com aspas internas duplicadas.
 * Leitores programáticos veem o apóstrofo como parte do valor; por isso só é aplicado aos campos de texto livre.
 */
export function spreadsheetSafeText(value: unknown) {
  const text = String(value ?? '')
  return formulaTrigger.test(text) ? `'${text}` : text
}

function csvCell(value: unknown, freeText = false) {
  const text = freeText ? spreadsheetSafeText(value) : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

const headers = ['id', 'type', 'title', 'category', 'location', 'event_date', 'status', 'approval_status', 'created_at'] as const
// Campos escritos por usuários; os demais são enums, números ou datas gerados pelo servidor.
const freeTextColumns = new Set<string>(['title', 'category', 'location'])

export function itemsCsv(rows: Array<Record<string, unknown>>) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header], freeTextColumns.has(header))).join(','))].join('\r\n')
}

router.get(
  '/items.csv',
  asyncHandler(async (req, res) => {
    // Instalação de campus único: somente o administrador da plataforma exporta (ver shared/policies/permissions.ts).
    const rows = db
      .prepare('SELECT id, type, title, category, location, event_date, status, approval_status, created_at FROM items ORDER BY id')
      .all() as Record<string, unknown>[]
    res.header('Content-Type', 'text/csv; charset=utf-8')
    res.header('Cache-Control', 'no-store')
    res.attachment('argos-itens.csv')
    logAudit(req, 'reports.items_exported', 'report', 'items.csv', { rows: rows.length })
    res.send(itemsCsv(rows))
  }),
)

export { router as reportRoutes }
