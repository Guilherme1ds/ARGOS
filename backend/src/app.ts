import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { resolve } from 'node:path'
import { env } from './config/env.js'
import { migrate } from './db/database.js'
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

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))
app.use('/uploads', express.static(resolve(env.UPLOAD_DIR)))

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ARGOS API', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/items', itemRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/reports', reportRoutes)

app.use(errorHandler)
