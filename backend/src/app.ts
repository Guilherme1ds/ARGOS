import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { corsOrigins, env } from './config/env.js'
import { db, migrate } from './db/database.js'
import { adminRoutes } from './modules/admin/admin.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js'
import { itemRoutes } from './modules/items/items.routes.js'
import { notificationRoutes } from './modules/notifications/notifications.routes.js'
import { reportRoutes } from './modules/reports/reports.routes.js'
import { uploadRoutes } from './modules/uploads/uploads.routes.js'
import { errorHandler } from './utils/http.js'

migrate()

export const app = express()

app.set('trust proxy', env.TRUST_PROXY)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || randomUUID()
  req.requestId = requestId
  res.setHeader('x-request-id', requestId)
  next()
})
app.use(cors({ origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)), credentials: true }))
app.use(express.json({ limit: `${env.MAX_BODY_MB}mb` }))
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'))
app.use('/uploads', express.static(resolve(env.UPLOAD_DIR)))

app.get(['/health/live', '/api/health'], (_req, res) => {
  res.json({ status: 'ok', service: 'ARGOS API', timestamp: new Date().toISOString() })
})

app.get('/health/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    res.json({ status: 'ready', database: 'ok', version: process.env.npm_package_version ?? '0.1.0' })
  } catch {
    res.status(503).json({ status: 'not_ready', database: 'unavailable' })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/items', itemRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/reports', reportRoutes)

app.use(errorHandler)
