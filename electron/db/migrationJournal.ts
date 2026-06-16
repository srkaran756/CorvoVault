import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type MigrationState = 'NOT_STARTED' | 'EXPORTING' | 'IMPORTING' | 'VALIDATING' | 'COMPLETE' | 'ROLLED_BACK';

export interface MigrationJournal {
  state: MigrationState;
  started_at?: number;
  completed_at?: number;
  source_counts?: Record<string, number>;
  validated?: boolean;
}

export function getJournalPath(): string {
  return path.join(app.getPath('userData'), 'migration_journal.json');
}

export function readJournal(): MigrationJournal {
  const p = getJournalPath();
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return { state: 'NOT_STARTED' };
}

export function writeJournal(journal: MigrationJournal): void {
  fs.writeFileSync(getJournalPath(), JSON.stringify(journal, null, 2), 'utf8');
}
