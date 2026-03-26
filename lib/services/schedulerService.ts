import { randomUUID } from 'node:crypto'
import { queryAll, run } from '../db'

export function queueNotificationsForUpcomingTasks(): Array<{ id: string; task_id: string }> {
  const candidates = queryAll<{ id: string; scheduled_for: string }>(
    `SELECT t.id, t.scheduled_for
     FROM care_tasks t
     LEFT JOIN notifications n ON n.task_id = t.id
     WHERE t.status = 'pending'
       AND t.scheduled_for BETWEEN datetime('now', '+55 minutes') AND datetime('now', '+65 minutes')
       AND n.id IS NULL`,
  )

  const out: Array<{ id: string; task_id: string }> = []
  for (const c of candidates) {
    const nid = randomUUID()
    run(
      `INSERT INTO notifications (id, task_id, scheduled_for, status, channel) VALUES (?, ?, ?, 'queued', 'local')`,
      [nid, c.id, c.scheduled_for],
    )
    out.push({ id: nid, task_id: c.id })
  }
  return out
}

export function markQueuedNotificationsAsSent(): Array<{ id: string }> {
  return queryAll<{ id: string }>(
    `UPDATE notifications
     SET status = 'sent', sent_at = datetime('now')
     WHERE status = 'queued'
       AND scheduled_for <= datetime('now', '+65 minutes')
     RETURNING id`,
  )
}
