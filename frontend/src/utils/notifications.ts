/** Disparado quando notificações são lidas, para o menu atualizar o contador sem esperar a próxima navegação. */
export const notificationsChangedEvent = 'argos:notifications-changed'

export function announceNotificationsChanged() {
  window.dispatchEvent(new Event(notificationsChangedEvent))
}
