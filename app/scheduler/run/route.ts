import { NextResponse } from 'next/server'
import {
  markQueuedNotificationsAsSent,
  queueNotificationsForUpcomingTasks,
} from '../../../lib/services/schedulerService'

export async function POST() {
  const queued = queueNotificationsForUpcomingTasks()
  const sent = markQueuedNotificationsAsSent()
  return NextResponse.json({
    queued: queued.length,
    sent: sent.length,
  })
}
