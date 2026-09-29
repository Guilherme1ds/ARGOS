import { env } from './config/env.js'
import { app } from './app.js'
import { db } from './db/database.js'

const server = app.listen(env.PORT, () => {
  console.log(`ARGOS API on http://localhost:${env.PORT}/api`)
})

// Conclui as requisições em curso e fecha o SQLite (checkpoint do WAL) antes de sair.
function shutdown(signal: string) {
  console.log(`[server] ${signal} recebido, encerrando...`)
  const forceExit = setTimeout(() => process.exit(1), 10_000)
  forceExit.unref()
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
