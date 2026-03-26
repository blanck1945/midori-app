function getTrend(adherenceRate: number): 'improving' | 'stable' | 'worsening' {
  if (adherenceRate >= 80) return 'improving'
  if (adherenceRate >= 50) return 'stable'
  return 'worsening'
}

export function mapProgressRow(row: {
  plant_id: string
  tasks_total_last_7_days: number | null
  tasks_done_last_7_days: number | null
}) {
  const total = Number(row.tasks_total_last_7_days ?? 0)
  const done = Number(row.tasks_done_last_7_days ?? 0)
  const adherenceRate = total ? Math.round((done / total) * 100) : 0

  return {
    plantId: row.plant_id,
    adherenceRate,
    tasksDoneLast7Days: done,
    tasksTotalLast7Days: total,
    trend: getTrend(adherenceRate),
  }
}
