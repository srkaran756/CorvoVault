import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';

async function hashFile(filePath: string): Promise<string | null> {
  return new Promise(resolve => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

export class IntegrityApplicationService {
  constructor(private db: Database.Database) {}

  async runIntegrityCheck(profileId: string): Promise<{ ok: number; corrupted: number; missing: number }> {
    const rows = this.db.prepare(`
      SELECT id, local_path, file_hash
      FROM materials
      WHERE profile_id = ?
        AND box_type = 'file'
        AND storage_status != 'trashed'
        AND local_path IS NOT NULL
    `).all(profileId) as Array<{ id: string; local_path: string; file_hash: string | null }>;

    let ok = 0;
    let corrupted = 0;
    let missing = 0;

    for (const row of rows) {
      if (!fs.existsSync(row.local_path)) {
        missing++;
        this.db.prepare('UPDATE materials SET storage_status = ? WHERE id = ?').run('missing', row.id);
        continue;
      }

      const currentHash = await hashFile(row.local_path);
      if (!currentHash) {
        missing++;
        this.db.prepare('UPDATE materials SET storage_status = ? WHERE id = ?').run('missing', row.id);
        continue;
      }

      if (row.file_hash && row.file_hash !== currentHash) {
        corrupted++;
        continue;
      }

      ok++;
      const { size } = fs.statSync(row.local_path);
      this.db.prepare(`
        UPDATE materials
        SET storage_status = 'active',
            file_hash = COALESCE(file_hash, ?),
            file_size = COALESCE(file_size, ?)
        WHERE id = ?
      `).run(currentHash, size, row.id);
    }

    return { ok, corrupted, missing };
  }
}
