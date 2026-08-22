import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

/**
 * Timestamped `pg_dump` of the whole database.
 *
 *   npm run db:backup                          # local development database
 *   DATABASE_URL="<railway url>" npm run db:backup   # production
 *
 * Order history is the one thing in this system that cannot be recreated from
 * anywhere else, so this exists alongside whatever the host's own backups do
 * rather than instead of them.
 */

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const RETAIN = 14

/* Windows installs pg_dump outside PATH; fall back to the standard location so
   the script works on this machine without extra setup. */
function resolvePgDump() {
  const candidates = [
    'pg_dump',
    'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe',
    'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
    '/usr/bin/pg_dump',
    '/usr/local/bin/pg_dump',
  ]

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {
      continue
    }
  }

  console.error('pg_dump was not found. Install the PostgreSQL client tools.')
  process.exit(1)
}

const dir = join(process.cwd(), 'backups')
mkdirSync(dir, { recursive: true })

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = join(dir, `kaizr-${stamp}.dump`)

console.log(`Dumping to ${target}…`)

execFileSync(
  resolvePgDump(),
  ['--dbname', url, '--format', 'custom', '--no-owner', '--file', target],
  { stdio: 'inherit' },
)

const size = statSync(target).size
console.log(`Wrote ${(size / 1024 / 1024).toFixed(2)} MB`)

/* Prune old dumps so a nightly job doesn't fill the disk. */
const dumps = readdirSync(dir)
  .filter((name) => name.startsWith('kaizr-') && name.endsWith('.dump'))
  .sort()
  .reverse()

for (const stale of dumps.slice(RETAIN)) {
  unlinkSync(join(dir, stale))
  console.log(`Pruned ${stale}`)
}

if (existsSync(target)) {
  console.log('\nRestore with:')
  console.log(`  pg_restore --dbname "$DATABASE_URL" --clean --no-owner "${target}"`)
}
