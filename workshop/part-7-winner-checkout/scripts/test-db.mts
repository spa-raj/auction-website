import pg from 'pg';

// Deliberately fixed name: tests never run alongside the live close worker's data.
const client = new pg.Client({ connectionString: 'postgres://auction:auction@localhost:55432/postgres' });
await client.connect();
try {
  if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='auction_part_7_test'")).rowCount) {
    await client.query('CREATE DATABASE auction_part_7_test');
  }
} finally { await client.end(); }
