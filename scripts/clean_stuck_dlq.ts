import { DatabaseAdapter } from '../src/db/adapter.js';

async function main() {
  const db = DatabaseAdapter.getInstance();
  await db.execute("UPDATE dlq_jobs SET status = 'DEAD_LETTER' WHERE status = 'PENDING_RETRY';");
  console.log('Successfully cleaned stuck pending DLQ jobs');
}

main().catch(console.error);
