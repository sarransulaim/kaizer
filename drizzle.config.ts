import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Next.js reads .env.local; point drizzle-kit at the same file so the CLI and
// the running app can never drift onto different databases.
config({ path: '.env.local' })

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. See .env.example.')
}

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
})
