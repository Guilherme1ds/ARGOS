import { api } from '../services/api'

/** Push exige contexto seguro (https ou localhost), service worker e a API de notificações. */
export function pushSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string) {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js')
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null
  const existing = await navigator.serviceWorker.getRegistration('/sw.js')
  return existing ? existing.pushManager.getSubscription() : null
}

export async function enablePush(publicKey: string) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission-denied')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  await api.post('/push/subscribe', subscription.toJSON())
  return subscription
}

export async function disablePush() {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  await api.delete('/push/subscribe', { data: { endpoint: subscription.endpoint } })
  await subscription.unsubscribe()
}
