export const CURRENT_SCHEMA_VERSION = 2;

export type Screen = 'dashboard' | 'library' | 'capture' | 'browser' | 'settings';

export interface AppProfile {
  id: string;
  name: string;
  email: string;
  description?: string;
  photoURL?: string;
  isGuest?: boolean;
}

export interface Topic {
  id: string;
  name: string;
  profileId: string;
  createdAt: string;
  resourceCount: number;
  activeNotes: number;
  icon?: string;
  colorClass?: string;
}

export interface Folder {
  id: string;
  name: string;
  topicId: string;
  profileId: string;
  createdAt: string;
}

export interface Material {
  id: string;
  title: string;
  folderId: string;
  topicId: string;
  profileId: string;
  boxType: 'file' | 'link' | 'youtube' | 'note';
  url: string;
  localPath?: string;
  thumbUrl?: string;
  createdAt: string;
  metadata?: {
    size?: string;
    summary?: string;
    duration?: string;
    author?: string;
    fileType?: string;
  };

  // NEW: real file size in bytes, populated after copy succeeds
  fileSizeBytes?: number;

  // NEW: SHA-256 hex digest of the file at time of import
  // Computed once. Never recomputed unless user explicitly triggers integrity check.
  fileHash?: string;

  // NEW: soft-delete state
  // 'active'   — normal, visible material (default when field is absent)
  // 'trashed'  — moved to .trash/ folder, hidden from library, awaiting purge
  // 'missing'  — file was expected on disk but not found at startup reconciliation
  storageStatus?: 'active' | 'trashed' | 'missing';

  // NEW: ISO timestamp of when this material was soft-deleted
  trashedAt?: string;

  // NEW: absolute path inside .trash/ folder (only set when storageStatus === 'trashed')
  trashPath?: string;
}

export interface MaterialNote {
  id: string;
  materialId: string;
  profileId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProgress {
  materialId: string;
  profileId: string;
  currentTime: number;
  duration: number;
  updatedAt: string;
}

export interface WellbeingEntry {
  id: string;
  title: string;
  type: string;
  minutes: number;
  color: string;
}

export interface UserStats {
  profileId: string;
  studyTimeMinutes: number;
  aiTokenUsage: number;
  lastActiveAt: string;
  lastFolderId?: string;
  wellbeingData: WellbeingEntry[];
}

export interface AppSettings {
  profileId: string;
  geminiKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
  openrouterKey?: string;
  selectedModel?: 'openai' | 'anthropic' | 'gemini' | 'openrouter';
  googleDriveConfig?: {
    rootFolderId?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };
  supabaseConfig?: {
    url?: string;
    key?: string;
  };
  studyTargetMinutes: number;
  focusTimeMinutes: number;
  /** How many days before a trashed material is permanently purged on app startup. Defaults to 30. */
  trashRetentionDays?: number;
}

export interface Activity {
  id: string;
  title: string;
  time: string;
  type: 'edit' | 'analyze' | 'save' | 'complete' | 'visit' | 'capture' | 'delete';
  icon: string;
  colorClass: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
  isLoading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface LibraryUIState {
  selectedTopicId: string | null;
  selectedFolderId: string | null;
  searchQuery: string;
}

// ─── Professor Architecture Types ────────────────────────────────────────

export type RetrievalMode = 'CHAPTER_SUMMARY' | 'PAGE_CONTEXT' | 'FACT_LOOKUP' | 'COMPARISON' | 'GENERAL_SEMANTIC';

export interface PdfAnnotation {
  type: 'highlight' | 'underline' | 'circle' | 'arrow';
  page: number;
  targetText: string;         // fuzzy-matched against chunk text
  bbox?: { x: number; y: number; w: number; h: number };
  color: string;              // CSS color e.g. '#fbbf24'
  callout?: string;           // label rendered near the annotation
}

export interface BoardAction {
  tool: 'chalk' | 'marker' | 'erase';
  content: string;
  position: { x: number; y: number };  // normalized [0..1] on canvas
  style: {
    color: 'white' | 'yellow' | 'red' | 'green' | 'blue';
    size: number;
    emphasis?: 'circle' | 'underline' | 'box';
  };
  timing: number;             // ms delay from start of response
}

export interface ProfessorResponse {
  thinking?: string;
  speech: string;
  pdf_annotations: PdfAnnotation[];
  board_actions: BoardAction[];
  agenda_update?: string[];
  student_model_delta?: {
    now_understood?: string[];
    now_confused?: string[];
  };
  navigate_to_page?: number;
  modelNameUsed?: string;
}

export interface ProfessorSession {
  materialId: string;
  studentModel: {
    understood_concepts: string[];
    confused_concepts: string[];
    questions_asked: string[];
  };
  teachingAgenda: string[];
  currentPage: number;
  boardStateSnapshot: any;
  conversationHistory: Array<{ role: string; content: string }>;
}
