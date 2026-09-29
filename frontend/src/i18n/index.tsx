import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppLanguage } from '../types/api'
import { en } from './en'
import { es } from './es'

export type TranslationVars = Record<string, string | number>
export type Translate = (text: string, vars?: TranslationVars) => string

export const languages: Array<{ value: AppLanguage; label: string; short: string }> = [
  { value: 'pt-BR', label: 'Português', short: 'PT' },
  { value: 'en-US', label: 'English', short: 'EN' },
  { value: 'es-ES', label: 'Español', short: 'ES' },
]

// As chaves são o texto em português: o código continua legível e o que faltar cai no original.
const dictionaries: Record<AppLanguage, Record<string, string>> = { 'pt-BR': {}, 'en-US': en, 'es-ES': es }
const storageKey = 'argos.language'

let activeLanguage: AppLanguage = 'pt-BR'

function interpolate(text: string, vars?: TranslationVars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function translate(language: AppLanguage, text: string, vars?: TranslationVars) {
  return interpolate(dictionaries[language][text] ?? text, vars)
}

/** Marca um texto para tradução posterior (tabelas de rótulos); a tradução acontece ao exibir, com t(). */
export function msg(text: string) {
  return text
}

/** Para código fora de componentes (mensagens de erro, formatação de datas). */
export function t(text: string, vars?: TranslationVars) {
  return translate(activeLanguage, text, vars)
}

export function getActiveLanguage() {
  return activeLanguage
}

export function isLanguage(value: unknown): value is AppLanguage {
  return languages.some((language) => language.value === value)
}

function readStoredLanguage(): AppLanguage | null {
  try {
    const stored = localStorage.getItem(storageKey)
    return isLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

function detectBrowserLanguage(): AppLanguage {
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  for (const entry of preferred) {
    const prefix = entry.toLowerCase().slice(0, 2)
    if (prefix === 'pt') return 'pt-BR'
    if (prefix === 'en') return 'en-US'
    if (prefix === 'es') return 'es-ES'
  }
  return 'pt-BR'
}

type I18nContextValue = {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => void
  t: Translate
}

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * Visitantes: idioma salvo no navegador (ou o do sistema). Com login, vale a preferência da conta,
 * informada por `accountLanguage`; trocar o idioma chama `onPersist` para salvá-la no servidor.
 */
export function I18nProvider({
  children,
  accountLanguage,
  onPersist,
}: {
  children: ReactNode
  accountLanguage?: AppLanguage | null
  onPersist?: (language: AppLanguage) => Promise<unknown> | void
}) {
  const [language, setLanguageState] = useState<AppLanguage>(() => readStoredLanguage() ?? detectBrowserLanguage())

  useEffect(() => {
    if (accountLanguage && isLanguage(accountLanguage)) setLanguageState(accountLanguage)
  }, [accountLanguage])

  activeLanguage = language

  useEffect(() => {
    document.documentElement.lang = language
    document.title = translate(language, 'ARGOS - Achados e perdidos')
    try {
      localStorage.setItem(storageKey, language)
    } catch {
      // Sem armazenamento local: o idioma vale só nesta aba.
    }
  }, [language])

  const setLanguage = useCallback(
    (next: AppLanguage) => {
      setLanguageState(next)
      void Promise.resolve(onPersist?.(next)).catch(() => undefined)
    },
    [onPersist],
  )

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t: (text, vars) => translate(language, text, vars) }),
    [language, setLanguage],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n deve ser usado dentro de I18nProvider')
  return context
}
