import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('argos_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (config.data instanceof FormData) delete config.headers['Content-Type']
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('argos_token')
      localStorage.removeItem('argos_user')
    }
    return Promise.reject(error)
  },
)

export function apiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.data?.message) return error.response.data.message
    return 'Erro de comunicação. Verifique se a API está rodando em http://localhost:3333/api.'
  }
  return 'Erro inesperado.'
}
