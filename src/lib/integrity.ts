import { ipcService } from '../services/ipcService';

/**
 * Validates data integrity by querying SQLite via IPC.
 * Previously this checked localStorage arrays — which are empty post-migration.
 * Now it delegates to the SQLite-backed IntegrityApplicationService.
 *
 * Usage (browser dev console):
 *   await window.validateStorageIntegrity()
 */
export async function validateStorageIntegrity() {
  console.log('--- STRICT STORAGE INTEGRITY CHECK START ---');
  let errors = 0;

  try {
    // 1. Check localStorage keys — should only contain the minimal ephemeral set
    const validPrefixes = [
      'sic_uistate_',
      'sic_notifications_',
      'sic_activities_',
    ];

    console.log('Checking localStorage key hygiene...');
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !validPrefixes.some(p => key.startsWith(p))) {
        console.warn(`[!] Unexpected localStorage key found (possible legacy data): "${key}"`);
        errors++;
      }
    }

    // 2. Check SQLite integrity per profile
    const profiles = await ipcService.profiles.getAll();
    for (const p of (profiles ?? [])) {
      console.log(`Checking SQLite integrity for profile [${p.id}]...`);
      try {
        const result = await ipcService.vault.runIntegrityCheck(p.id);
        if (result && typeof result === 'object') {
          console.log(`[${p.id}] SQLite integrity result:`, result);
        }
      } catch (err) {
        console.warn(`[!] Could not run integrity check for profile ${p.id}:`, err);
        errors++;
      }
    }

    if (errors === 0) {
      console.log('✅ Integrity Check Passed!');
    } else {
      console.error(`❌ Integrity Check finished with ${errors} warning(s).`);
    }

  } catch (err) {
    console.error('Fatal error during integrity check:', err);
  }

  console.log('--- CHECK COMPLETE ---');
}

// Expose globally for dev manual running
if (typeof window !== 'undefined') {
  (window as any).validateStorageIntegrity = validateStorageIntegrity;
}
