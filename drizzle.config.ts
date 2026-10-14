import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs src/main/db/schema.ts against drizzle/meta and writes a new
// migration. Migrations are bundled into the app and applied by src/main/db/migrations.ts.
export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
});
