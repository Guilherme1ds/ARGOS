import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <section className="panel access-denied">
      <h2>{t('Página não encontrada')}</h2>
      <p>{t('O endereço acessado não existe ou foi removido.')}</p>
      <Link className="primary" to="/">{t('Voltar ao início')}</Link>
    </section>
  )
}
