import cron from 'node-cron'
import {
  markQueuedNotificationsAsSent,
  queueNotificationsForUpcomingTasks,
} from './services/schedulerService'

let started = false

export function ensureScheduler() {
  if (started) return
  if (process.env.NODE_ENV === 'test') return
  started = true

  cron.schedule('*/5 * * * *', () => {
    try {
      queueNotificationsForUpcomingTasks()
      markQueuedNotificationsAsSent()
    } catch (error) {
      console.error('Scheduler error:', (error as Error).message)
    }
  })
}
