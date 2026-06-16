import { useState, useEffect } from 'react';

export function useIngestionStatus(materialId: string) {
  const [ingestionStatus, setIngestionStatus] = useState<{ status: string; progress: number } | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      if (!(window as any).electronAPI) return;
      try {
        const status = await (window as any).electronAPI.professorGetIngestionStatus(materialId);
        setIngestionStatus({ status, progress: status === 'ready' ? 100 : 0 });
      } catch (e) {
        console.warn('Failed to fetch initial ingestion status:', e);
      }
    };
    fetchStatus();

    const unsubscribe = (window as any).electronAPI?.on('professor:ingestionProgress', (data: any) => {
      if (data.materialId === materialId) {
        setIngestionStatus({ status: data.status, progress: data.progress });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [materialId]);

  return ingestionStatus;
}
