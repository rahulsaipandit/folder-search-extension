import { z } from 'zod'
import { ActionDefinition } from '../types'

const inputSchema = z.object({})

const outputSchema = z.object({
  epochSeconds: z.number(),
  epochMs:      z.number(),
  humanUtc:     z.string(),
  humanLocal:   z.string(),
})

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pad = (n: number) => String(n).padStart(2, '0')

function fmtUtc(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

function fmtLocal(d: Date): string {
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (local)`
}

export const EpochTimeAction: ActionDefinition<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  id:          'org.page-agent.time.epoch',
  name:        'Current Epoch / Unix Timestamp',
  description: 'Returns the current Unix epoch timestamp in seconds and milliseconds, plus human-readable UTC and local date strings. Use this when the user asks for the current epoch time, unix timestamp, or seconds since 1970.',
  version:     '1.0.0',
  capabilities: ['system.time'],
  triggers: ['epoch time', 'unix timestamp', 'unix time', 'seconds since 1970', 'milliseconds since epoch', 'current timestamp'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  execute: async () => {
    const now = new Date()
    return {
      epochSeconds: Math.floor(now.getTime() / 1000),
      epochMs:      now.getTime(),
      humanUtc:     fmtUtc(now),
      humanLocal:   fmtLocal(now),
    }
  },
}
