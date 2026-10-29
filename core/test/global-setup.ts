import { Client } from 'pg';
import { migrate } from '../src/platform/migrate';

// Fresh schema for every run; the app connects as the restricted bbjp_app role.
export default async function setup() {
  const url = 'postgres://bbjp_owner:dev_owner_pw@localhost:5432/bbjp_test';
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bbjp_owner;');
  await c.end();
  await migrate(url, 'up');
}
