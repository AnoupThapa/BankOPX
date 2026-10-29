import { migrate } from './migrate';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
migrate(url, process.argv[2] === 'down' ? 'down' : 'up')
  .then((names) => process.stdout.write(`migrations ${process.argv[2] ?? 'up'}: ${names.join(', ') || 'none'}\n`))
  .catch((e) => {
    process.stderr.write(`migration failed: ${(e as Error).message}\n`);
    process.exit(1);
  });
