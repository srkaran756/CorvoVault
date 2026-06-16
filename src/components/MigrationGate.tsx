import React, { useEffect, useState } from 'react';

export function MigrationGate({ children }: { children: React.ReactNode }) {
  const [migrationState, setMigrationState] = useState<string | null>(null);
  
  useEffect(() => {
    let active = true;

    async function checkMigration() {
      if (!window.electronAPI) {
        // Not running in Electron (e.g., dev browser) — skip migration
        setMigrationState('COMPLETE');
        return;
      }

      try {
        const journal = await window.electronAPI.invoke('migration:getStatus');
        if (!active) return;
        
        if (journal?.state === 'NOT_STARTED') {
          const profilesRaw = localStorage.getItem('sic_profiles');
          if (!profilesRaw) {
            // Fresh install — no legacy data, proceed
            setMigrationState('COMPLETE');
            return;
          }
          
          setMigrationState('STARTING');
          
          let profiles: any[] = [];
          try {
            profiles = JSON.parse(profilesRaw);
          } catch {
            setMigrationState('COMPLETE');
            return;
          }

          // FIX: Collect data from ALL profiles, not just the first one
          const allTopics: any[] = [];
          const allFolders: any[] = [];
          const allMaterials: any[] = [];
          const allNotes: any[] = [];
          const allBookmarks: any[] = [];

          for (const profile of profiles) {
            const pid = profile.id;
            try { allTopics.push(...JSON.parse(localStorage.getItem(`sic_topics_${pid}`) || '[]')); } catch {}
            try { allFolders.push(...JSON.parse(localStorage.getItem(`sic_folders_${pid}`) || '[]')); } catch {}
            try { allMaterials.push(...JSON.parse(localStorage.getItem(`sic_materials_${pid}`) || '[]')); } catch {}
            try { allNotes.push(...JSON.parse(localStorage.getItem(`sic_notes_${pid}`) || '[]')); } catch {}
            try { allBookmarks.push(...JSON.parse(localStorage.getItem(`sic_bookmarks_${pid}`) || '[]')); } catch {}
          }

          const snapshot = {
            profiles,
            topics: allTopics,
            folders: allFolders,
            materials: allMaterials,
            notes: allNotes,
            bookmarks: allBookmarks,
          };

          const result = await window.electronAPI.invoke('migration:exportComplete', snapshot);
          if (!active) return;
          
          if (result?.success) {
            // Migrate launch PIN if present in localStorage
            const pinRaw = localStorage.getItem('sic_launch_pin_config');
            if (pinRaw) {
              try {
                const parsedPin = JSON.parse(pinRaw);
                await window.electronAPI.invoke('pin:set', parsedPin);
                localStorage.removeItem('sic_launch_pin_config');
              } catch (pinErr) {
                console.warn('[Migration] Failed to migrate launch PIN:', pinErr);
              }
            }

            // Scrub the old localStorage data-entity keys — they now live in SQLite
            for (const profile of profiles) {
              const pid = profile.id;
              const legacyKeys = [
                `sic_topics_${pid}`, `sic_folders_${pid}`, `sic_materials_${pid}`,
                `sic_notes_${pid}`, `sic_bookmarks_${pid}`, `sic_vidprogress_${pid}`,
                `sic_stats_${pid}`, `sic_activities_${pid}`, `sic_notifications_${pid}`,
                `sic_settings_${pid}`, `sic_theme_${pid}`, `sic_css_overrides_${pid}`,
              ];
              for (const key of legacyKeys) localStorage.removeItem(key);
            }
            setMigrationState('COMPLETE');
          } else {
            setMigrationState('ROLLED_BACK');
          }
        } else {
          setMigrationState(journal?.state || 'COMPLETE');
        }
      } catch (err) {
        console.warn('[MigrationGate] getStatus failed, retrying in 250ms...', err);
        if (active) {
          setTimeout(checkMigration, 250);
        }
      }
    }
    checkMigration();
    return () => { active = false; };
  }, []);

  if (migrationState === 'STARTING' || migrationState === 'IMPORTING') {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-6 font-body">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold">Upgrading Sanctuary</h1>
          <p className="text-sm text-on-surface-variant">Building a new foundation. This only takes a moment.</p>
        </div>
      </div>
    );
  }

  if (migrationState === 'ROLLED_BACK') {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-6 font-body">
        <div className="text-red-500">
          <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2 text-center max-w-md">
          <h1 className="text-2xl font-bold">Migration Failed Safely</h1>
          <p className="text-sm text-on-surface-variant">We encountered an issue during the upgrade, but don't worry—your data was untouched and is completely safe.</p>
          <button onClick={() => setMigrationState('COMPLETE')} className="mt-4 px-6 py-2 bg-primary text-on-primary rounded-lg font-bold">Continue in Legacy Mode</button>
        </div>
      </div>
    );
  }

  if (migrationState === null) {
    // Still loading — show nothing to prevent flash
    return null;
  }

  return <>{children}</>;
}
