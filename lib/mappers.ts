export function mapPlant(row: {
  id: string
  user_id: string
  name: string
  species_guess: string
  location: string
  light_level: string
  color_rgb: string | null
  created_at: string
  updated_at: string
}) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    speciesGuess: row.species_guess,
    location: row.location,
    lightLevel: row.light_level,
    colorRgb: row.color_rgb ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapTask(row: {
  id: string
  plant_id: string
  title: string
  details: string
  scheduled_for: string
  status: string
  priority: number
  category: string
}) {
  return {
    id: row.id,
    plantId: row.plant_id,
    title: row.title,
    details: row.details,
    scheduledFor: row.scheduled_for,
    status: row.status as 'pending' | 'done' | 'skipped',
    priority: row.priority,
    category: row.category as 'watering' | 'inspection' | 'fertilizing' | 'recovery' | 'other',
  }
}

export function mapPlantPhoto(row: {
  id: string
  plant_id: string
  image_url: string
  note: string | null
  context: string | null
  captured_at: string
}) {
  return {
    id: row.id,
    plantId: row.plant_id,
    imageUrl: row.image_url,
    imageProxyPath: `/plants/${row.plant_id}/photos/${row.id}/file`,
    note: row.note,
    context: row.context,
    capturedAt: row.captured_at,
  }
}

export function mapDiagnosis(row: {
  id: string
  plant_id: string
  severity: string
  confidence: number
  summary: string
  detected_issues: string
  recommendations: string
  created_at: string
}) {
  return {
    id: row.id,
    plantId: row.plant_id,
    severity: row.severity as 'low' | 'medium' | 'high',
    confidence: Number(row.confidence),
    summary: row.summary,
    detectedIssues: JSON.parse(row.detected_issues) as string[],
    recommendations: JSON.parse(row.recommendations) as string[],
    createdAt: row.created_at,
  }
}
