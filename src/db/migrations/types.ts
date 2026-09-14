import { DatabaseAdapter, TransactionClient } from '../adapter.js';

export interface Migration {
  id: string;
  name: string;
  checksum: string;
  up: (db: DatabaseAdapter | TransactionClient) => Promise<void>;
  down: (db: DatabaseAdapter | TransactionClient) => Promise<void>;
}

export interface AppliedMigrationRecord {
  id: string;
  name: string;
  checksum: string;
  applied_at: string;
  execution_time_ms: number;
}
