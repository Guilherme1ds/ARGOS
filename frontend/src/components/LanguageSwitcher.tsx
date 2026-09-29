import { Languages } from 'lucide-react'
import { languages, useI18n } from '../i18n'
import type { AppLanguage } from '../types/api'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { language, setLanguage, t } = useI18n()
  return (
    <label className={`language-switcher ${className}`}>
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t('Idioma')}</span>
      <select value={language} onChange={(event) => setLanguage(event.target.value as AppLanguage)} aria-label={t('Idioma')}>
        {languages.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
