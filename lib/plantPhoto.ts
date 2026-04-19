import { queryOne } from './db'
import { MAX_PLANT_PHOTOS } from './constants'

export async function getPlantPhotoCount(plantId: string): Promise<number> {
  const row = await queryOne<{ n: number | bigint }>(
    'SELECT COUNT(*) AS n FROM plant_photos WHERE plant_id = ?',
    [plantId],
  )
  return Number(row?.n ?? 0)
}

export async function canAddPlantPhotos(plantId: string, additional: number): Promise<boolean> {
  const count = await getPlantPhotoCount(plantId)
  return count + additional <= MAX_PLANT_PHOTOS
}
