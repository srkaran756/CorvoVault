import { useState, useEffect, useRef } from 'react';
import { ProfessorSession } from '../types';

export function useProfessorSession(
  materialId: string,
  currentPage: number,
  onPageHydrated?: (page: number) => void
) {
  const [professorSession, setProfessorSession] = useState<ProfessorSession>({
    materialId,
    studentModel: {
      understood_concepts: [],
      confused_concepts: [],
      questions_asked: [],
    },
    teachingAgenda: [],
    currentPage: 1,
    boardStateSnapshot: null,
    conversationHistory: [],
  });

  const isFirstLoadRef = useRef(true);

  // 1. Hydrate/load session from SQLite on mount or material ID change
  useEffect(() => {
    isFirstLoadRef.current = true;
    const loadSession = async () => {
      if (!(window as any).electronAPI) return;
      try {
        const session = await (window as any).electronAPI.professorLoadSession(materialId);
        if (session) {
          setProfessorSession({
            materialId,
            studentModel: JSON.parse(session.student_model_json),
            teachingAgenda: JSON.parse(session.agenda_json),
            currentPage: session.last_page,
            boardStateSnapshot: JSON.parse(session.board_state_json),
            conversationHistory: JSON.parse(session.conversation_json),
          });

          if (session.last_page > 1 && onPageHydrated) {
            onPageHydrated(session.last_page);
          }
        } else {
          // Reset session state for new material with no saved session
          setProfessorSession({
            materialId,
            studentModel: {
              understood_concepts: [],
              confused_concepts: [],
              questions_asked: [],
            },
            teachingAgenda: [],
            currentPage: 1,
            boardStateSnapshot: null,
            conversationHistory: [],
          });
        }
      } catch (err) {
        console.warn('Failed to load professor session from SQLite:', err);
      } finally {
        isFirstLoadRef.current = false;
      }
    };
    loadSession();
  }, [materialId]);

  // 2. Save session on changes to session state or currentPage
  useEffect(() => {
    if (!(window as any).electronAPI) return;
    if (isFirstLoadRef.current) return;

    // Safety guard: only save if there is some activity (avoids overwriting with blank template)
    if (
      professorSession.conversationHistory.length > 0 ||
      professorSession.studentModel.questions_asked.length > 0
    ) {
      (window as any).electronAPI.professorSaveSession(materialId, {
        conversationHistory: professorSession.conversationHistory,
        studentModel: professorSession.studentModel,
        agenda: professorSession.teachingAgenda,
        boardState: professorSession.boardStateSnapshot,
        currentPage: currentPage,
      });
    }
  }, [professorSession, currentPage, materialId]);

  return {
    professorSession,
    setProfessorSession,
  };
}
