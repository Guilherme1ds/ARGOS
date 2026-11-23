/** Disparado quando notificações são lidas, para o menu atualizar o contador sem esperar a próxima navegação. */
export const notificationsChangedEvent = 'argos:notifications-changed'

export function announceNotificationsChanged() {
  window.dispatchEvent(new Event(notificationsChangedEvent))
}

/** Disparado quando mensagens de conversa são lidas ou recebidas, para o menu atualizar o contador. */
export const chatChangedEvent = 'argos:chat-changed'

export function announceChatChanged() {
  window.dispatchEvent(new Event(chatChangedEvent))
}
