import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
export const database = (pool: pg.Pool) => drizzle(pool);
export type Database = ReturnType<typeof database>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
