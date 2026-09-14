import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

export interface PoolMetrics {
  engine: 'PostgreSQL' | 'SQLite';
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  database: string;
}

export interface TransactionClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>;
}

export class DatabaseAdapter {
  private static instance: DatabaseAdapter | null = null;
  private pgPool: pg.Pool | null = null;
  private sqliteDb: DatabaseSync | null = null;
  private engine: 'PostgreSQL' | 'SQLite' = 'SQLite';
  private dbName: string = 'ctrl.db';

  private initSqlite(cleanUrl: string): void {
    this.engine = 'SQLite';
    const cleanPath = cleanUrl.replace(/^sqlite:\/\/\/?/, '');
    const dbPath = process.env.DATABASE_PATH || (() => {
      const defaultName = cleanPath || 'ctrl.db';
      return path.isAbsolute(defaultName) ? defaultName : path.resolve(process.cwd(), defaultName);
    })();

    try {
      const dir = path.dirname(dbPath);
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.sqliteDb = new DatabaseSync(dbPath);
    } catch (err: any) {
      console.warn(`⚠️ DatabaseAdapter: SQLite file '${dbPath}' could not be opened (${err.message}). Falling back to /tmp/ctrl.db...`);
      try {
        this.sqliteDb = new DatabaseSync('/tmp/ctrl.db');
      } catch {
        this.sqliteDb = new DatabaseSync(':memory:');
      }
    }

    try {
      this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
      this.sqliteDb.exec('PRAGMA busy_timeout = 5000;');
      this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
    } catch {}
    this.dbName = path.basename(dbPath);
    console.log(`🔌 DatabaseAdapter: Initialized SQLite engine (WAL mode, foreign_keys: ON, file: ${this.dbName})`);
  }

  private constructor() {
    let dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';

    // If DATABASE_URL is docker internal placeholder or SQLite url, initialize SQLite
    if (dbUrl.startsWith('sqlite://') || !dbUrl || dbUrl.includes('@postgres:5432')) {
      this.initSqlite(dbUrl || 'sqlite:///ctrl.db');
      return;
    }

    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
      try {
        const poolSize = Number(process.env.DATABASE_POOL_SIZE) || 20;
        this.pgPool = new pg.Pool({
          connectionString: dbUrl,
          max: poolSize,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
          ssl: { rejectUnauthorized: false },
        });
        this.engine = 'PostgreSQL';
        this.dbName = 'supabase_postgres';
        console.log(`🔌 DatabaseAdapter: Initialized Supabase PostgreSQL connection pool (max: ${poolSize})`);
      } catch (err: any) {
        console.warn('⚠️ Failed to initialize Supabase PostgreSQL pool, falling back to SQLite:', err.message);
        this.initSqlite('sqlite:///ctrl.db');
      }
    } else {
      this.initSqlite(dbUrl);
    }
  }

  public static getInstance(): DatabaseAdapter {
    if (!DatabaseAdapter.instance) {
      DatabaseAdapter.instance = new DatabaseAdapter();
    }
    return DatabaseAdapter.instance;
  }

  public getEngine(): 'PostgreSQL' | 'SQLite' {
    return this.engine;
  }

  public async setTenantContext(tenantId: string): Promise<void> {
    if (this.engine === 'PostgreSQL' && tenantId) {
      await this.execute(`SET LOCAL app.current_tenant_id = ?;`, [tenantId]);
    }
  }

  public getPoolMetrics(): PoolMetrics {
    if (this.engine === 'PostgreSQL' && this.pgPool) {
      return {
        engine: 'PostgreSQL',
        totalCount: this.pgPool.totalCount,
        idleCount: this.pgPool.idleCount,
        waitingCount: this.pgPool.waitingCount,
        database: this.dbName,
      };
    }

    return {
      engine: 'SQLite',
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      database: this.dbName,
    };
  }

  /**
   * Normalizes SQL queries across PostgreSQL ($1, $2, ...) and SQLite (?, ?, ...)
   */
  private normalizeSql(sql: string): string {
    if (this.engine === 'PostgreSQL') {
      let pgSql = sql
        .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
        .replace(/PRAGMA\s+[^;]+;?/gi, '');

      // Normalize SQLite INSERT OR IGNORE to Postgres ON CONFLICT DO NOTHING if no conflict clause
      if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(pgSql)) {
        pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
        if (!/ON\s+CONFLICT/i.test(pgSql)) {
          pgSql = pgSql.trim().replace(/;?$/, ' ON CONFLICT DO NOTHING;');
        }
      }

      // Normalize SQLite INSERT OR REPLACE to Postgres ON CONFLICT DO UPDATE
      if (/INSERT\s+OR\s+REPLACE\s+INTO/i.test(pgSql)) {
        pgSql = pgSql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
        if (!/ON\s+CONFLICT/i.test(pgSql)) {
          if (/auth_otps/i.test(pgSql)) {
            pgSql = pgSql.trim().replace(/;?$/, ' ON CONFLICT (email) DO UPDATE SET otp = EXCLUDED.otp, expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at;');
          } else if (/tenants/i.test(pgSql)) {
            pgSql = pgSql.trim().replace(/;?$/, ' ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, capacity_limit = EXCLUDED.capacity_limit;');
          }
        }
      }
      
      let index = 1;
      return pgSql.replace(/\?/g, () => `$${index++}`);
    } else {
      // Normalize PostgreSQL $1, $2 to SQLite ?
      return sql.replace(/\$\d+/g, '?');
    }
  }

  private sqliteTxMutex: Promise<void> = Promise.resolve();

  /**
   * Executes a parameterized query and returns an array of result rows.
   */
  public async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const normalizedSql = this.normalizeSql(sql);

    if (this.engine === 'PostgreSQL' && this.pgPool) {
      const res = await this.pgPool.query(normalizedSql, params);
      return res.rows as T[];
    }

    if (!this.sqliteDb) this.initSqlite('sqlite:///ctrl.db');
    const stmt = this.sqliteDb!.prepare(this.normalizeSql(sql));
    return stmt.all(...params) as unknown as T[];
  }

  /**
   * Executes an INSERT/UPDATE/DELETE statement and returns affected row count.
   */
  public async execute(sql: string, params: any[] = []): Promise<{ rowCount: number }> {
    const normalizedSql = this.normalizeSql(sql);

    if (this.engine === 'PostgreSQL' && this.pgPool) {
      const res = await this.pgPool.query(normalizedSql, params);
      return { rowCount: res.rowCount || 0 };
    }

    if (!this.sqliteDb) this.initSqlite('sqlite:///ctrl.db');
    const stmt = this.sqliteDb!.prepare(this.normalizeSql(sql));
    const res = stmt.run(...params);
    return { rowCount: Number(res.changes || 0) };
  }

  /**
   * Runs a series of operations atomically inside a database transaction.
   * Automatically commits on success and rolls back on error.
   */
  public async withTransaction<T>(callback: (client: TransactionClient) => Promise<T>): Promise<T> {
    if (this.engine === 'PostgreSQL' && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const txClient: TransactionClient = {
          query: async (sql, params = []) => {
            const normalized = this.normalizeSql(sql);
            const res = await client.query(normalized, params);
            return res.rows;
          },
          execute: async (sql, params = []) => {
            const normalized = this.normalizeSql(sql);
            const res = await client.query(normalized, params);
            return { rowCount: res.rowCount || 0 };
          },
        };
        const result = await callback(txClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Queue SQLite transactions to prevent "cannot start a transaction within a transaction"
    return new Promise<T>((resolve, reject) => {
      this.sqliteTxMutex = this.sqliteTxMutex.then(async () => {
        if (!this.sqliteDb) this.initSqlite('sqlite:///ctrl.db');
        this.sqliteDb!.exec('BEGIN TRANSACTION;');
        try {
          const txClient: TransactionClient = {
            query: async (sql, params = []) => {
              const normalized = this.normalizeSql(sql);
              const stmt = this.sqliteDb!.prepare(normalized);
              return stmt.all(...params) as any;
            },
            execute: async (sql, params = []) => {
              const normalized = this.normalizeSql(sql);
              const stmt = this.sqliteDb!.prepare(normalized);
              const res = stmt.run(...params);
              return { rowCount: Number(res.changes || 0) };
            },
          };
          const result = await callback(txClient);
          this.sqliteDb!.exec('COMMIT;');
          resolve(result);
        } catch (err) {
          try {
            this.sqliteDb!.exec('ROLLBACK;');
          } catch {}
          reject(err);
        }
      }).catch(reject);
    });
  }

  /**
   * Cleanly closes database connections.
   */
  public async close(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.sqliteDb) {
      this.sqliteDb.close();
      this.sqliteDb = null;
    }
    DatabaseAdapter.instance = null;
  }
}
