import type { CareTask, DashboardData, Diagnosis, Plant, PlantPhoto, ProgressSnapshot, User } from './types'

export type PlantDetailResponse = {
  plant: Plant
  diagnoses: Diagnosis[]
  tasks: CareTask[]
  photos: PlantPhoto[]
}

function getClientApiBaseUrl(): string {
  const fromVite =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_PUBLIC_API_URL ?? import.meta.env.NEXT_PUBLIC_API_URL ?? '')
      : ''
  if (fromVite) return String(fromVite).replace(/\/$/, '')
  if (typeof process !== 'undefined' && process.env) {
    const legacy = process.env.VITE_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''
    return String(legacy).replace(/\/$/, '')
  }
  return ''
}

const API_BASE_URL = getClientApiBaseUrl()

/** Base del API para `fetch` desde el cliente (mismo origen o `VITE_PUBLIC_API_URL`). */
export function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`
}

type LoginResponse = {
  token: string
  user: User
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    const payload = await res.text()
    let msg = payload || `HTTP ${res.status}`
    try {
      const j = JSON.parse(payload) as { message?: string }
      if (typeof j.message === 'string') msg = j.message
    } catch {
      /* texto plano */
    }
    throw new Error(msg)
  }

  return (await res.json()) as T
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },
  register(email: string, name: string, password: string) {
    return request<LoginResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, password }),
    })
  },
  forgotPassword(email: string) {
    return request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
  },
  resetPassword(token: string, password: string) {
    return request<{ ok: true }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    })
  },
  getDashboard(token: string) {
    return request<DashboardData>('/dashboard', {}, token)
  },
  getPlants(token: string) {
    return request<Plant[]>('/plants', {}, token)
  },
  createPlant(
    token: string,
    data: Pick<Plant, 'name' | 'speciesGuess' | 'location' | 'lightLevel'>,
  ) {
    return request<Plant>(
      '/plants',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      token,
    )
  },
  getPlant(token: string, plantId: string) {
    return request<PlantDetailResponse>(`/plants/${plantId}`, {}, token)
  },
  deletePlant(token: string, plantId: string) {
    return request<{ ok: true }>(`/plants/${plantId}`, { method: 'DELETE' }, token)
  },
  diagnosePlant(
    token: string,
    plantId: string,
    payload: { imageUrl: string; note?: string; context: string; language?: string },
  ) {
    return request<{ diagnosis: Diagnosis; generatedTasks: CareTask[] }>(
      `/plants/${plantId}/diagnose`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    )
  },
  uploadPlantPhoto(
    token: string,
    plantId: string,
    payload: { imageUrl: string; note?: string; context?: string },
  ) {
    return request<PlantPhoto>(
      `/plants/${plantId}/photos`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token,
    )
  },
  getTasksToday(token: string) {
    return request<CareTask[]>('/tasks/today', {}, token)
  },
  updateTaskStatus(token: string, taskId: string, status: CareTask['status']) {
    return request<CareTask>(
      `/tasks/${taskId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      token,
    )
  },
  getProgress(token: string) {
    return request<ProgressSnapshot[]>('/progress', {}, token)
  },
  updatePlantColor(token: string, plantId: string, colorRgb: string) {
    return request<Plant>(`/plants/${plantId}/color`, {
      method: 'PATCH',
      body: JSON.stringify({ colorRgb }),
    }, token)
  },
}
