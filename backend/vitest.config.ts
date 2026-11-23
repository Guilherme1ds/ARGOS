import { defineConfig } from 'vitest/config'

// Cada arquivo sobe a API com banco SQLite e uploads temporários no beforeAll (migrações, seed, sharp).
// Com o padrão de 10 s, a suíte falhava em 7 arquivos quando a máquina estava ocupada (build em paralelo,
// CI compartilhado) e passava inteira quando rodada sozinha.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
