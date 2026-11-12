import { Component, type ReactNode } from 'react'
import { t } from '../i18n'

// As telas são carregadas sob demanda. Sem esta barreira, uma tela que não carregava (sem conexão ao abrir
// uma tela nova, ou versão nova publicada com uma aba antiga aberta) derrubava o app inteiro: página em branco.
// Com ela, o menu continua disponível e a pessoa recebe a explicação e a ação de recarregar.
type Props = { children: ReactNode; resetKey: string }
type State = { error: Error | null }

// Mensagens de falha de import dinâmico: Chromium, Firefox, Safari/WebKit e o pré-carregamento do Vite.
const chunkFailure = /dynamically imported module|importing a module script failed|unable to preload/i

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(previous: Props) {
    // Trocar de tela limpa o erro: outras telas já carregadas continuam funcionando.
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = chunkFailure.test(`${error.name} ${error.message}`)
    return (
      <section className="panel page-error" role="alert">
        <h2>{chunk ? t('Não foi possível abrir esta tela') : t('Algo deu errado nesta tela')}</h2>
        <p>
          {chunk
            ? t('Verifique sua conexão. Se o ARGOS acabou de ser atualizado, recarregue a página para usar a versão nova.')
            : t('Recarregue a página. Se o problema continuar, tente novamente mais tarde.')}
        </p>
        <button className="primary fit" type="button" onClick={() => window.location.reload()}>{t('Recarregar a página')}</button>
      </section>
    )
  }
}
