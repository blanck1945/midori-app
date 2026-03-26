import { queryOne } from './db'
import { MAX_PLANT_PHOTOS } from './constants'

export function getPlantPhotoCount(plantId: string): number {
  const row = queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM plant_photos WHERE plant_id = ?',
    [plantId],
  )
  return Number(row?.n ?? 0)
}

export function canAddPlantPhotos(plantId: string, additional: number): boolean {
  return getPlantPhotoCount(plantId) + additional <= MAX_PLANT_PHOTOS
}
