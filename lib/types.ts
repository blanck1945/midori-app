export type Severity = 'low' | 'medium' | 'high'
export type TaskStatus = 'pending' | 'done' | 'skipped'

export interface User {
  id: string
  email: string
  name: string
}

export interface Plant {
  id: string
  userId: string
  name: string
  speciesGuess: string
  location: string
  lightLevel: 'low' | 'medium' | 'high'
  colorRgb: string | null
  createdAt: string
  updatedAt: string
}

export interface PlantPhoto {
  id: string
  plantId: string
  imageUrl: string
  /** GET autenticado; usar en cliente con Bearer en lugar de `imageUrl` directo si R2 no es público. */
  imageProxyPath: string
  note: string | null
  context: string | null
  capturedAt: string
}

export interface Diagnosis {
  id: string
  plantId: string
  severity: Severity
  confidence: number
  summary: string
  detectedIssues: string[]
  recommendations: string[]
  createdAt: string
}

export interface CareTask {
  id: string
  plantId: string
  title: string
  details: string
  scheduledFor: string
  status: TaskStatus
  priority: number
  category: 'watering' | 'inspection' | 'fertilizing' | 'recovery' | 'other'
}

export interface ProgressSnapshot {
  plantId: string
  adherenceRate: number
  tasksDoneLast7Days: number
  tasksTotalLast7Days: number
  trend: 'improving' | 'stable' | 'worsening'
}

export interface DashboardData {
  plants: Plant[]
  dueTasks: CareTask[]
  criticalAlerts: string[]
}
