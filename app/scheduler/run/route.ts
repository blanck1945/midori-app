import { NextResponse } from 'next/server'
import {
  markQueuedNotificationsAsSent,
  queueNotificationsForUpcomingTasks,
} from '../../../lib/services/schedulerService'

export async function POST() {
  const queued = await queueNotificationsForUpcomingTasks()
  const sent = await markQueuedNotificationsAsSent()
  return NextResponse.json({
    queued: queued.length,
    sent: sent.length,
  })
}
