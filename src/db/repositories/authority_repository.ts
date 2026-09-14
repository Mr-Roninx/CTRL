import { DatabaseSync } from 'node:sqlite';
import { AuthorityCheck } from '../../types/index.js';

export class AuthorityRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public insert(check: AuthorityCheck): void {
    const stmt = this.db.prepare(`
      INSERT INTO authority_checks (
        opportunity_id, check_name, passed, reason
      ) VALUES (
        ?, ?, ?, ?
      )
    `);
    stmt.run(
      check.opportunity_id,
      check.check_name,
      check.passed ? 1 : 0,
      check.reason
    );
  }

  public getByOpportunityId(oppId: string): AuthorityCheck[] {
    const stmt = this.db.prepare('SELECT * FROM authority_checks WHERE opportunity_id = ? ORDER BY id ASC');
    const rows = stmt.all(oppId) as any[];
    return rows.map((r) => ({
      id: r.id,
      opportunity_id: r.opportunity_id,
      check_name: r.check_name,
      passed: Boolean(r.passed),
      reason: r.reason,
    }));
  }

  public clearForOpportunity(oppId: string): void {
    const stmt = this.db.prepare('DELETE FROM authority_checks WHERE opportunity_id = ?');
    stmt.run(oppId);
  }

  public clearAll(): void {
    this.db.exec('DELETE FROM authority_checks;');
  }
}
