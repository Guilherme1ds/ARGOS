import { Bell, HandHelping, LifeBuoy, PackageSearch, PlusCircle, Search, ShieldCheck, Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n'
import { useAppConfig } from '../services/config'
import { hasPermission } from '../utils/permissions'

/** "Como funciona": o caminho de quem perdeu e de quem encontrou, com as regras que o ARGOS realmente aplica. */
export function HelpPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const config = useAppConfig()
  const canPublish = !user || hasPermission(user, 'items:create')

  return (
    <section className="help-page">
      <div className="panel help-intro">
        <p>
          {t('O ARGOS ajuda a devolver objetos perdidos: quem perdeu e quem encontrou publicam o caso, e o contato acontece pelo próprio ARGOS, sem expor e-mail ou telefone.')}
        </p>
        <div className="help-actions">
          <Link className="primary fit" to="/items"><Search size={18} /> {t('Buscar itens')}</Link>
          {canPublish && (
            <Link className="ghost light fit" to={user ? '/items/new' : '/login?next=/items/new'}>
              <PlusCircle size={18} /> {t('Publicar item')}
            </Link>
          )}
        </div>
      </div>

      <div className="help-grid">
        <article className="panel help-card">
          <h2><PackageSearch size={20} aria-hidden="true" /> {t('Perdi um objeto')}</h2>
          <ol>
            <li>{t('Procure primeiro na Consulta pública e no Mapa: talvez alguém já tenha publicado.')}</li>
            <li>{t('Se não achar, entre e publique um caso de perdido com categoria, local, data e uma descrição geral.')}</li>
            <li>{t('Use Salvar busca para ser avisado quando surgir um caso parecido. O ARGOS também avisa quando encontra um caso compatível com o seu.')}</li>
            <li>{t('Quando recuperar o objeto, registre a devolução no seu caso.')}</li>
          </ol>
        </article>

        <article className="panel help-card">
          <h2><HandHelping size={20} aria-hidden="true" /> {t('Encontrei um objeto')}</h2>
          <ol>
            <li>{t('Entre e publique um caso de encontrado com foto, local e data.')}</li>
            <li>{t('Descreva só o geral. Detalhes que só o dono saberia (conteúdo, marcas, números) servem de prova e não devem aparecer na publicação.')}</li>
            <li>{t('Quem reivindicar envia provas privadas, que só você e a administração veem.')}</li>
            <li>{t('Se as provas conferirem, entregue o objeto e confirme a devolução escolhendo a reivindicação da pessoa.')}</li>
          </ol>
        </article>

        <article className="panel help-card">
          <h2><ShieldCheck size={20} aria-hidden="true" /> {t('Privacidade e segurança')}</h2>
          <ul>
            <li>{t('Seu e-mail não aparece nos casos: o contato acontece pelas reivindicações e notificações do ARGOS.')}</li>
            <li>{t('Não escreva e-mail, telefone ou número de documento em campos públicos; o ARGOS avisa quando encontra esses dados.')}</li>
            <li>{t('Pistas públicas servem para informações gerais. Provas de posse vão sempre no envio privado.')}</li>
            <li>{t('Viu algo indevido? Use Denunciar no caso para a administração analisar.')}</li>
          </ul>
        </article>

        <article className="panel help-card">
          <h2><Bell size={20} aria-hidden="true" /> {t('Avisos')}</h2>
          <ul>
            <li>{t('Acompanhe um caso para receber as novidades dele nas Notificações.')}</li>
            <li>{t('Em Configurações você escolhe receber avisos por e-mail (na hora ou em resumo diário) e no navegador.')}</li>
          </ul>
        </article>

        <article className="panel help-card">
          <h2><Smartphone size={20} aria-hidden="true" /> {t('No celular')}</h2>
          <p>{t('Abra o menu do navegador e escolha Adicionar à tela inicial (ou Instalar app) para abrir o ARGOS como um aplicativo.')}</p>
        </article>

        <article className="panel help-card">
          <h2><LifeBuoy size={20} aria-hidden="true" /> {t('Precisa de ajuda?')}</h2>
          {config?.supportEmail ? (
            <p>
              {t('Escreva para')} <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a>.{' '}
              {t('Nunca envie senhas nem provas de posse por e-mail.')}
            </p>
          ) : (
            <p>{t('Fale com a administração do ARGOS na sua instituição.')}</p>
          )}
          <p>
            <Link to="/privacy">{t('Resumo de privacidade')}</Link>
          </p>
        </article>
      </div>
    </section>
  )
}
