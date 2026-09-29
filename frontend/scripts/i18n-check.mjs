// Confere se todo texto marcado para tradução existe nos dicionários (en-US, es-ES) e aponta
// textos soltos em JSX que ainda não passam por t(). Uso: npm run i18n:check [-- --list]
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const translatable = /\b(?:(?:t|translateNow|msg)\(|translate\(\s*\w+,)\s*'((?:[^'\\]|\\.)*)'/g
const looseJsxText = />\s*([A-Za-zÀ-ú][^<>{}]*[A-Za-zÀ-ú.!?:])\s*</g

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/i18n[\\/](en|es)\.ts$/.test(path) ? [path] : []
  })
}

const keys = new Map()
const loose = []
for (const file of sourceFiles(root)) {
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(translatable)) {
    const key = match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    if (!keys.has(key)) keys.set(key, relative(root, file))
  }
  if (file.endsWith('.tsx')) {
    for (const match of source.matchAll(looseJsxText)) {
      const text = match[1].trim()
      // Ignora genéricos de TypeScript (Promise<...>, useState<...>) e nomes que não se traduzem.
      if (/[=();\n?]|^(Promise|string|return)$/.test(text)) continue
      if (!/^(ARGOS|CSV|PT|EN|ES|UTC|Português|English|Español|OpenStreetMap)$/.test(text)) loose.push(`${relative(root, file)}: ${text}`)
    }
  }
}

const dictionaries = {
  'en-US': (await import(pathToFileURL(join(root, 'i18n', 'en.ts')).href)).en,
  'es-ES': (await import(pathToFileURL(join(root, 'i18n', 'es.ts')).href)).es,
}

if (process.argv.includes('--list')) {
  console.log(JSON.stringify([...keys.keys()].sort(), null, 2))
  process.exit(0)
}

let failed = false
for (const [language, dictionary] of Object.entries(dictionaries)) {
  const missing = [...keys.keys()].filter((key) => !(key in dictionary))
  const unused = Object.keys(dictionary).filter((key) => !keys.has(key))
  const placeholders = [...keys.keys()].filter((key) => {
    const expected = (key.match(/\{\w+\}/g) ?? []).sort().join()
    return key in dictionary && (dictionary[key].match(/\{\w+\}/g) ?? []).sort().join() !== expected
  })
  console.log(`${language}: ${keys.size - missing.length}/${keys.size} traduzidos`)
  for (const key of missing) console.log(`  faltando: "${key}" (${keys.get(key)})`)
  for (const key of placeholders) console.log(`  variáveis diferentes: "${key}"`)
  for (const key of unused) console.log(`  sem uso: "${key}"`)
  if (missing.length || placeholders.length) failed = true
}

if (loose.length) {
  console.log(`\nTextos em JSX fora de t() (${loose.length}):`)
  for (const entry of loose) console.log(`  ${entry}`)
}

process.exit(failed ? 1 : 0)
