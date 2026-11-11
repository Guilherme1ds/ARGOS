import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useI18n } from '../i18n'

export type Feedback = { type: 'success' | 'error'; text: string } | null

/**
 * Aviso fixo na parte de baixo da tela: em listas longas (mural, grade) o resultado da ação aparece perto de
 * onde a pessoa está, e não no topo da página. A região viva existe sempre, para o leitor de tela anunciar.
 */
export function FloatingFeedback({ feedback, onClose }: { feedback: Feedback; onClose: () => void }) {
  const { t } = useI18n()

  useEffect(() => {
    if (feedback?.type !== 'success') return
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [feedback, onClose])

  return (
    <div className="floating-feedback-region" aria-live="polite">
      {feedback && (
        <div className={`floating-feedback message ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
          <span>{feedback.text}</span>
          <button type="button" aria-label={t('Fechar aviso')} title={t('Fechar aviso')} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
