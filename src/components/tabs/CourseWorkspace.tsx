import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, Video, FileText, Layers, FileCheck, Briefcase, Globe, Bookmark, Download, MessageSquare, Cpu, Award, Trash2, Plus, Check, Loader2, ExternalLink, ChevronRight, BookmarkCheck, Search, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../hooks/useTabs';
import { useUserSettings } from '../../hooks/useLocalData';
import { generateAIResponse } from '../../lib/ai';
import { ipcService } from '../../services/ipcService';
import NoteEditor from './NoteEditor';
import AiTutorPanel from './AiTutorPanel';
import { useWebviewNavigation } from '../../hooks/useWebviewNavigation';

// ─── Course Content Model ─────────────────────────────────────────────────────
interface ContentItem {
  id: string;
  title: string;
  url?: string;
  type?: 'youtube' | 'pdf' | 'github' | 'link';
  duration?: string;
  addedBy: 'user';
  category?: string;
}

interface CourseContent {
  videos: ContentItem[];
  resources: ContentItem[];
  assignments: { id: string; title: string; url?: string }[];
  projects: { id: string; title: string; description?: string; url?: string; difficulty?: string }[];
  discussion: { id: string; platform: string; label: string; url: string }[];
}

const EMPTY_CONTENT: CourseContent = {
  videos: [], resources: [], assignments: [], projects: [], discussion: []
};

interface CourseWorkspaceProps {
  data: any; // The course metadata object loaded from SQLite
  isActive?: boolean;
}

export default function CourseWorkspace({ data, isActive = true }: CourseWorkspaceProps) {
  const { user } = useAuth();
  const { openTab } = useTabs();
  const { settings } = useUserSettings();
  const profileId = user?.id || '';
  const courseId = data?.id || '';

  // Current active left section
  const [activeSection, setActiveSection] = useState<string>('overview');

  // Right panel tab — proper React state (not window global)
  const [rightTab, setRightTab] = useState<'progress' | 'tutor' | 'notes'>('progress');
  
  // Loaded course state (with progress)
  const [course, setCourse] = useState<any>(data);
  const [progress, setProgress] = useState<any>(data?.progress || {});

  // Course content — user-curated, stored in DB as JSON
  const [content, setContent] = useState<CourseContent>(
    data?.content ? (typeof data.content === 'string' ? JSON.parse(data.content) : data.content) : EMPTY_CONTENT
  );

  const [downloadedMaterials, setDownloadedMaterials] = useState<any[]>([]);
  const [loadingDownloads, setLoadingDownloads] = useState(false);
  const [vaultFolderId, setVaultFolderId] = useState<string | null>(null);
  const [materialPage, setMaterialPage] = useState(0);
  const [hasMoreMaterials, setHasMoreMaterials] = useState(false);
  const [trimWarning, setTrimWarning] = useState<{ trimmed: boolean; originalCount: number } | null>(null);

  // Active playing video URL (embedded)
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);

  // "Add" form states
  const [addVideoUrl, setAddVideoUrl] = useState('');
  const [addVideoTitle, setAddVideoTitle] = useState('');
  const [addResourceUrl, setAddResourceUrl] = useState('');
  const [addResourceTitle, setAddResourceTitle] = useState('');
  const [addAssignmentTitle, setAddAssignmentTitle] = useState('');
  const [ytSearchQuery, setYtSearchQuery] = useState('');
  const [ytSearchResults, setYtSearchResults] = useState<any[]>([]);
  const [ytSearchLoading, setYtSearchLoading] = useState(false);

  // Syllabus Extractor states
  const [extractorUrl, setExtractorUrl] = useState(course?.officialUrl || '');
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState('');
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractedGroups, setExtractedGroups] = useState<any[]>([]);
  const [editableGroups, setEditableGroups] = useState<any[]>([]);
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['Other', 'General Resources']));
  const [importSuccess, setImportSuccess] = useState(false);
  const [autoDownloadPdfs, setAutoDownloadPdfs] = useState(true);

  // Notes state (personal notes linked to this course)
  const [notes, setNotes] = useState<any[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  // Bookmarks state (global bookmarks)
  const [bookmarks, setBookmarks] = useState<any[]>([]);

  // AI Tutor states
  const [selectedTutorMaterial, setSelectedTutorMaterial] = useState<any | null>(null);
  const [tutorSession, setTutorSession] = useState<any>({
    studentModel: { understood_concepts: [], confused_concepts: [], questions_asked: [] },
    teachingAgenda: [],
    currentPage: 1,
    boardStateSnapshot: null,
    conversationHistory: []
  });
  const [professorAnnotations, setProfessorAnnotations] = useState<any[]>([]);
  const [boardActionQueue, setBoardActionQueue] = useState<any[]>([]);

  // Download processing state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Webview refs — intercept new-window events to open in in-app Browser tab
  const videoWebviewRef = useWebviewNavigation();
  const websiteWebviewRef = useWebviewNavigation();

  // Fetch / Sync Course state from DB
  const reloadCourse = useCallback(async () => {
    if (!courseId) return;
    try {
      if ((window as any).electronAPI) {
        const dbCourse = await (window as any).electronAPI.invoke('courses:getSavedCourse', courseId);
        if (dbCourse) {
          setCourse(dbCourse);
          setProgress(dbCourse.progress || {});
        }
      }
    } catch (e) {
      console.error('Failed to reload course details', e);
    }
  }, [courseId]);

  // Load bookmarks
  const reloadBookmarks = useCallback(async () => {
    try {
      if ((window as any).electronAPI) {
        const bList = await (window as any).electronAPI.invoke('bookmarks:getAll', profileId);
        setBookmarks(bList || []);
      }
    } catch (e) {
      console.error('Failed to load bookmarks', e);
    }
  }, [profileId]);

  // Load vault folder association — loads ALL material types (videos, files, links)
  const reloadDownloadedMaterials = useCallback(async (page = 0) => {
    if (!course) return;
    setLoadingDownloads(true);
    try {
      if ((window as any).electronAPI) {
        const folders = await (window as any).electronAPI.invoke('folders:getAllByProfile', profileId);
        const topics = await (window as any).electronAPI.invoke('topics:getAll', profileId);
        const vaultTopic = topics?.find((t: any) => t.name === 'Course Vault');
        const folder = folders?.find((f: any) => f.name === course.provider && (!vaultTopic || f.topicId === vaultTopic.id));
        if (folder) {
          setVaultFolderId(folder.id);
          // Load paginated materials (150 per page) — ALL box types
          const PAGE_SIZE = 150;
          const mats = await (window as any).electronAPI.invoke('vault:getMaterials', folder.id, profileId, PAGE_SIZE, page * PAGE_SIZE);
          const newMats = mats || [];
          if (page === 0) {
            setDownloadedMaterials(newMats);
          } else {
            setDownloadedMaterials(prev => [...prev, ...newMats]);
          }
          setHasMoreMaterials(newMats.length === PAGE_SIZE);
          setMaterialPage(page);

          // Also load notes
          const notesList = await (window as any).electronAPI.invoke('notes:getAll', course.id);
          setNotes(notesList || []);
        }
      }
    } catch (e) {
      console.error('Failed to load downloaded materials', e);
    } finally {
      setLoadingDownloads(false);
    }
  }, [course, profileId]);

  useEffect(() => {
    reloadCourse();
    reloadBookmarks();
  }, [courseId]);

  useEffect(() => {
    if (course) {
      reloadDownloadedMaterials();
    }
  }, [course]);

  useEffect(() => {
    if ((window as any).electronAPI) {
      const unsubscribe = (window as any).electronAPI.on('courses:extractSyllabusProgress', (data: { step: string; progress: number }) => {
        setExtractionStatus(data.step);
        setExtractionProgress(data.progress);
      });
      return unsubscribe;
    }
  }, []);

  useEffect(() => {
    if (course?.officialUrl && !extractorUrl) {
      setExtractorUrl(course.officialUrl);
    }
  }, [course?.officialUrl]);

  // Save progress changes
  const saveProgress = async (newProgress: any) => {
    setProgress(newProgress);
    try {
      if ((window as any).electronAPI) {
        await (window as any).electronAPI.invoke('courses:updateProgress', courseId, newProgress);
      }
    } catch (e) {
      console.error('Failed to update progress in SQLite', e);
    }
  };

  // Helper to check if a specific page/video/resource is marked complete
  const isCompleted = (type: string, id: string) => {
    return !!progress[`${type}_${id}`];
  };

  const toggleCompleted = (type: string, id: string) => {
    const key = `${type}_${id}`;
    const nextProgress = { ...progress, [key]: !progress[key] };
    
    // Auto track 'Course opened' progress if not done
    if (!nextProgress['course_opened']) {
      nextProgress['course_opened'] = true;
    }
    
    saveProgress(nextProgress);
  };

  // Calculate completion percentage — derived from actual course content
  const calculateCompletion = () => {
    const totalItems =
      content.videos.length +
      content.resources.length +
      content.assignments.length +
      (content.videos.length > 0 || content.assignments.length > 0 ? 1 : 0); // course_opened milestone
    if (totalItems === 0) return progress['course_opened'] ? 100 : 0;

    let completedCount = 0;
    Object.keys(progress).forEach(key => {
      if (progress[key] === true && !key.startsWith('last_viewed')) completedCount++;
    });
    return Math.min(100, Math.round((completedCount / totalItems) * 100));
  };

  // Save content to DB and update local state
  const saveContent = useCallback(async (newContent: CourseContent) => {
    setContent(newContent);
    try {
      if ((window as any).electronAPI) {
        await (window as any).electronAPI.invoke('courses:updateContent', courseId, newContent);
      }
    } catch (e) {
      console.error('Failed to save course content', e);
    }
  }, [courseId]);

  // Add a video manually
  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addVideoUrl.trim()) return;
    const url = addVideoUrl.trim();
    const title = addVideoTitle.trim() || url;
    const isYt = url.includes('youtube.com') || url.includes('youtu.be');
    const newItem: ContentItem = {
      id: crypto.randomUUID(),
      title,
      url,
      type: isYt ? 'youtube' : 'link',
      addedBy: 'user'
    };
    const next = { ...content, videos: [...content.videos, newItem] };
    await saveContent(next);
    setAddVideoUrl('');
    setAddVideoTitle('');
  };

  // Add YouTube search result as video
  const handleAddYtResult = async (result: any) => {
    const newItem: ContentItem = {
      id: crypto.randomUUID(),
      title: result.title,
      url: result.officialUrl,
      type: 'youtube',
      duration: result.duration,
      addedBy: 'user'
    };
    const next = { ...content, videos: [...content.videos, newItem] };
    await saveContent(next);
    setYtSearchResults([]);
    setYtSearchQuery('');
  };

  // Remove a video
  const handleRemoveVideo = async (id: string) => {
    const next = { ...content, videos: content.videos.filter(v => v.id !== id) };
    await saveContent(next);
  };

  // Add a resource
  const handleAddResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addResourceUrl.trim()) return;
    const url = addResourceUrl.trim();
    const title = addResourceTitle.trim() || url;
    const type = url.includes('github.com') ? 'github' : url.endsWith('.pdf') ? 'pdf' : 'link';
    const newItem: ContentItem = {
      id: crypto.randomUUID(), title, url, type: type as any, addedBy: 'user'
    };
    const next = { ...content, resources: [...content.resources, newItem] };
    await saveContent(next);
    setAddResourceUrl('');
    setAddResourceTitle('');
  };

  // Remove a resource
  const handleRemoveResource = async (id: string) => {
    const next = { ...content, resources: content.resources.filter(r => r.id !== id) };
    await saveContent(next);
  };

  // Syllabus Extractor Functions
  const handleRunExtractor = async () => {
    if (!extractorUrl.trim()) return;
    setExtractionLoading(true);
    setExtractionStatus('Initializing extraction...');
    setExtractionProgress(0);
    setExtractedGroups([]);
    setEditableGroups([]);
    setSelectedResources(new Set());
    setImportSuccess(false);
    setTrimWarning(null);

    try {
      const result = await (window as any).electronAPI.invoke('courses:extractSyllabus', extractorUrl.trim(), profileId);

      if (result && result.success) {
        setExtractedGroups(result.groups || []);
        setEditableGroups(result.groups || []);
        
        // Smart default selection: select only high-value non-Other links
        const smartSelected = new Set<string>();
        (result.groups || []).forEach((g: any) => {
          g.resources.forEach((r: any) => {
            if (r.category !== 'Other' && (r.confidence > 0 || !r.needsReview)) {
              smartSelected.add(r.url);
            }
          });
        });
        setSelectedResources(smartSelected);
        // Show trim warning if extractor capped the results
        if (result.meta?.trimmed) {
          setTrimWarning({ trimmed: true, originalCount: result.meta.originalCount || 0 });
        }
        setExtractionStatus('');
      } else {
        setExtractionStatus(`Extraction failed: ${result?.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      setExtractionStatus(`Extraction failed: ${e.message || String(e)}`);
    } finally {
      setExtractionLoading(false);
    }
  };

  const handleRunAIExtractor = async () => {
    if (!extractorUrl.trim()) return;

    const apiKey = settings?.openrouterKey || settings?.openaiKey || settings?.geminiKey || settings?.anthropicKey;
    if (!apiKey) {
      setExtractionStatus('Missing API Key. Please configure your OpenRouter, Gemini, or OpenAI API key in Settings.');
      return;
    }

    setExtractionLoading(true);
    setExtractionStatus('Crawling & extracting raw course link dataset...');
    setExtractionProgress(20);
    setExtractedGroups([]);
    setEditableGroups([]);
    setSelectedResources(new Set());
    setImportSuccess(false);

    try {
      const result = await (window as any).electronAPI.invoke('courses:extractSyllabus', extractorUrl.trim(), profileId);

      if (!result || !result.success || !result.groups) {
        setExtractionStatus(`Extraction failed: ${result?.error || 'Unknown error'}`);
        return;
      }

      setExtractionStatus('Sending JSON link dataset to AI model for intelligent curriculum & box structuring...');
      setExtractionProgress(60);

      // Collect raw links from extracted groups
      const rawLinks: any[] = [];
      result.groups.forEach((g: any) => {
        (g.resources || []).forEach((r: any) => {
          rawLinks.push({
            url: r.url,
            anchorText: r.anchorText,
            nearbyHeading: r.nearbyHeading,
            surroundingText: r.surroundingText ? r.surroundingText.slice(0, 150) : ''
          });
        });
      });

      const systemPrompt = `You are an elite AI Syllabus Architect and CorvoVault Knowledge Curator.
Your job is to analyze extracted web links from an educational course site and organize every resource into structured curriculum modules and precise target Vault Box categories.

MANDATORY VAULT BOX TARGET TYPES:
1. "file" (Downloadable File Box):
   - PDFs (Lecture notes, slide decks, assignments, exam papers, readings).
   - Code files & archives (.py, .ipynb, .zip, .tar.gz, .java, .cpp, script files, docdist, bst, avl).
2. "website" (Web Resource Box):
   - Web pages, documentation links, HTML readings, interactive guides, external reference pages.
3. "youtube" (YouTube / Video Box):
   - YouTube video links, YouTube playlists, embedded lecture recordings, video walkthroughs.
   - For YouTube playlists or multiple video recordings, organize each video into an explicit YouTube box.

CATEGORY BOX TYPES:
- Video (Lecture recordings, YouTube videos, playlists)
- Notes (Typed lecture notes, handwritten notes, slide decks, handouts)
- Assignment (Homework problem sets, coding exercises, theory questions)
- Quiz (Quizzes, exams, midterm, final, solution keys, blank exams)
- Reading (Textbooks, CLRS, articles, reference guides, recitation problem sets)
- Project (Coding projects, lab scripts, python implementations, repos)
- Other (General info, syllabus overview, staff, tools)

JSON OUTPUT STRUCTURE:
Return strictly valid JSON matching this schema:
{
  "groups": [
    {
      "groupName": "Unit 1: Introduction",
      "resources": [
        {
          "url": "https://...",
          "anchorText": "Lec 1: Algorithmic Thinking Video",
          "nearbyHeading": "Unit 1: Introduction",
          "surroundingText": "...",
          "category": "Video",
          "boxType": "youtube",
          "confidence": 0.95,
          "needsReview": false
        }
      ]
    }
  ]
}`;

      const userPrompt = `Here is the extracted course link dataset for URL ${extractorUrl}:\n\n${JSON.stringify(rawLinks.slice(0, 150), null, 2)}\n\nOrganize all resources into structured curriculum modules and target Vault box categories. Return ONLY valid JSON.`;

      const provider = (settings?.openrouterKey ? 'openrouter' : settings?.openaiKey ? 'openai' : settings?.geminiKey ? 'gemini' : 'anthropic') as any;

      const config = {
        provider,
        openaiKey: settings?.openaiKey,
        anthropicKey: settings?.anthropicKey,
        geminiKey: settings?.geminiKey,
        openrouterKey: settings?.openrouterKey
      };

      const aiResponseText = await generateAIResponse(
        config,
        {
          systemInstruction: systemPrompt,
          prompt: userPrompt,
          model: provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct:free' : undefined
        }
      );

      setExtractionProgress(90);
      let parsedJson: any = null;
      try {
        const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedJson = JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        console.warn('[CourseWorkspace] Failed to parse AI JSON response, falling back to raw groups:', err);
      }

      const finalGroups = parsedJson?.groups || result.groups;
      setExtractedGroups(finalGroups);
      setEditableGroups(finalGroups);

      const smartSelected = new Set<string>();
      finalGroups.forEach((g: any) => {
        (g.resources || []).forEach((r: any) => {
          if (r.category !== 'Other') smartSelected.add(r.url);
        });
      });
      setSelectedResources(smartSelected);
      setExtractionStatus('');
    } catch (e: any) {
      setExtractionStatus(`AI Organization failed: ${e.message || String(e)}`);
    } finally {
      setExtractionLoading(false);
    }
  };

  const handleCancelExtraction = async () => {
    if ((window as any).electronAPI) {
      await (window as any).electronAPI.invoke('courses:cancelExtraction');
    }
    setExtractionLoading(false);
    setExtractionStatus('Extraction cancelled by user');
  };

  const handleClearCourseMaterials = async () => {
    if (!confirm('Are you sure you want to clear all imported Vault materials for this course? This will remove bulk items from your Vault sidebar.')) return;
    if ((window as any).electronAPI) {
      try {
        await (window as any).electronAPI.invoke('courses:clearCourseMaterials', courseId, profileId);
        await reloadDownloadedMaterials();
        alert('Vault materials for this course cleared successfully!');
      } catch (err) {
        console.error('[CourseWorkspace] Failed to clear course materials:', err);
      }
    }
  };

  const toggleCollapseGroup = (groupName: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  const handleUpdateItemCategory = (groupIndex: number, resIndex: number, newCat: string) => {
    setEditableGroups(prev => {
      const next = JSON.parse(JSON.stringify(prev)); // deep copy
      next[groupIndex].resources[resIndex].category = newCat;
      next[groupIndex].resources[resIndex].needsReview = false;
      return next;
    });
  };

  const handleUpdateItemTitle = (groupIndex: number, resIndex: number, newTitle: string) => {
    setEditableGroups(prev => {
      const next = JSON.parse(JSON.stringify(prev)); // deep copy
      next[groupIndex].resources[resIndex].anchorText = newTitle;
      next[groupIndex].resources[resIndex].needsReview = false;
      return next;
    });
  };

  const toggleSelectLink = (url: string) => {
    setSelectedResources(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const toggleSelectAllInGroup = (groupIndex: number) => {
    const groupResources = editableGroups[groupIndex]?.resources || [];
    const groupUrls = groupResources.map((r: any) => r.url);
    const allSelected = groupUrls.every((url: string) => selectedResources.has(url));

    setSelectedResources(prev => {
      const next = new Set(prev);
      groupUrls.forEach((url: string) => {
        if (allSelected) {
          next.delete(url);
        } else {
          next.add(url);
        }
      });
      return next;
    });
  };

  const handleSelectAllGlobal = () => {
    const allUrls = new Set<string>();
    editableGroups.forEach(g => {
      g.resources.forEach((r: any) => allUrls.add(r.url));
    });
    setSelectedResources(allUrls);
  };

  const handleDeselectAllGlobal = () => {
    setSelectedResources(new Set());
  };

  const handleImportSelected = async () => {
    const nextContent = JSON.parse(JSON.stringify(content));
    let importCount = 0;
    const pdfsToDownload: { id: string; title: string; url: string }[] = [];
    const itemsToImport: { id: string; title: string; url: string; category: string; type: string }[] = [];

    editableGroups.forEach(g => {
      g.resources.forEach((r: any) => {
        if (selectedResources.has(r.url)) {
          importCount++;
          const id = crypto.randomUUID();
          const title = r.anchorText.trim() || r.url;
          const url = r.url;
          const cat = r.category;

          const isPdf = url.toLowerCase().endsWith('.pdf');
          if (autoDownloadPdfs && isPdf) {
            pdfsToDownload.push({ id, title, url });
          }

          let itemType = 'link';

          if (cat === 'Video') {
            const isYt = url.includes('youtube.com') || url.includes('youtu.be');
            itemType = isYt ? 'youtube' : 'link';
            nextContent.videos.push({
              id,
              title,
              url,
              type: itemType as any,
              addedBy: 'user'
            });
          } else if (cat === 'Assignment' || cat === 'Quiz') {
            nextContent.assignments.push({
              id,
              title,
              url
            });
          } else if (cat === 'Project') {
            nextContent.projects.push({
              id,
              title,
              url,
              description: `Imported from syllabus group: ${g.groupName}`
            });
          } else {
            const isGit = url.includes('github.com');
            itemType = isGit ? 'github' : isPdf ? 'pdf' : 'link';
            nextContent.resources.push({
              id,
              title,
              url,
              type: itemType as any,
              addedBy: 'user',
              category: cat
            });
          }

          itemsToImport.push({ id, title, url, category: cat, type: itemType });
        }
      });
    });

    if (importCount > 0) {
      // 1. Save to CourseWorkspace content
      await saveContent(nextContent);

      // 2. Save directly into Vault materials database so the Vault sidebar tree updates!
      if ((window as any).electronAPI) {
        try {
          await (window as any).electronAPI.invoke('courses:saveSelectedToVault', courseId, profileId, itemsToImport);
          await reloadDownloadedMaterials();
        } catch (err) {
          console.error('[CourseWorkspace] Failed to save items to Vault materials:', err);
        }
      }

      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
      setEditableGroups([]);
      setExtractedGroups([]);

      // Trigger sequential background downloads for PDFs
      if (pdfsToDownload.length > 0) {
        (async () => {
          console.log(`[CourseWorkspace] Auto-downloading ${pdfsToDownload.length} PDFs...`);
          for (const pdf of pdfsToDownload) {
            const cleanTitle = pdf.title.replace(/[\\/:*?"<>|]/g, '_');
            const filename = `${cleanTitle}.pdf`;
            await handleDownloadFile(pdf.url, filename, pdf.id);
          }
        })().catch(err => {
          console.error('[CourseWorkspace] Auto-downloading PDFs failed:', err);
        });
      }
    }
  };

  // Add an assignment
  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addAssignmentTitle.trim()) return;
    const newItem = { id: crypto.randomUUID(), title: addAssignmentTitle.trim() };
    const next = { ...content, assignments: [...content.assignments, newItem] };
    await saveContent(next);
    setAddAssignmentTitle('');
  };

  // Remove an assignment
  const handleRemoveAssignment = async (id: string) => {
    const next = { ...content, assignments: content.assignments.filter(a => a.id !== id) };
    await saveContent(next);
  };

  // Search YouTube for this course
  const handleYtSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytSearchQuery.trim() && !course?.title) return;
    const q = ytSearchQuery.trim() || course?.title || '';
    setYtSearchLoading(true);
    try {
      if ((window as any).electronAPI) {
        const results = await (window as any).electronAPI.invoke('courses:searchYouTube', q);
        setYtSearchResults(results || []);
      }
    } catch (e) {
      console.error('YouTube search failed', e);
    } finally {
      setYtSearchLoading(false);
    }
  };

  // Bookmark toggler
  const handleToggleBookmark = async (title: string, url: string) => {
    const existing = bookmarks.find(b => b.url === url);
    try {
      if ((window as any).electronAPI) {
        if (existing) {
          await (window as any).electronAPI.invoke('bookmarks:delete', existing.id);
        } else {
          await (window as any).electronAPI.invoke('bookmarks:add', profileId, title, url);
        }
        reloadBookmarks();
      }
    } catch (e) {
      console.error('Failed to toggle bookmark', e);
    }
  };

  const isBookmarked = (url: string) => {
    return bookmarks.some(b => b.url === url);
  };

  // File download flow: Download -> Local -> Vault -> Ingestion -> Indexing
  const handleDownloadFile = async (url: string, filename: string, resourceId: string) => {
    setDownloadingId(resourceId);
    setErrorMsg(null);
    try {
      if (!(window as any).electronAPI) {
        throw new Error('Download is only supported in the desktop application.');
      }

      // 1. Ensure course is saved in Vault topic/folder to get a folder ID
      let folderId = vaultFolderId;
      if (!folderId) {
        const saveRes = await (window as any).electronAPI.invoke('courses:saveToVault', course, profileId, 'Course Vault');
        if (saveRes && saveRes.success) {
          // Folder created, reload to capture the ID
          const folders = await (window as any).electronAPI.invoke('folders:getAllByProfile', profileId);
          const topics = await (window as any).electronAPI.invoke('topics:getAll', profileId);
          const vaultTopic = topics?.find((t: any) => t.name === 'Course Vault');
          const folder = folders?.find((f: any) => f.name === course.provider && (!vaultTopic || f.topicId === vaultTopic.id));
          if (folder) {
            folderId = folder.id;
            setVaultFolderId(folder.id);
          }
        }
      }

      if (!folderId) {
        throw new Error('Failed to create/resolve Vault folder structure for this course.');
      }

      // 2. Call backend download pipeline (handles downloading, encrypting, hashing, upserting & indexing)
      const downloadRes = await (window as any).electronAPI.invoke('courses:downloadResource', {
        url,
        filename,
        folderId,
        profileId,
        materialId: resourceId
      });

      if (!downloadRes.success) {
        throw new Error(downloadRes.error || 'Failed to download resource file.');
      }

      // 3. Toggle progress check for completed resources
      toggleCompleted('resource', resourceId);

      // Reload downloads list
      reloadDownloadedMaterials();
      
      // Update activity logs
      window.dispatchEvent(new Event('vault:reconciled'));

    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Unable to download this resource.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Notes actions
  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim()) return;
    try {
      if ((window as any).electronAPI) {
        // Ensure course exists as a material
        const saveRes = await (window as any).electronAPI.invoke('courses:saveToVault', course, profileId, course.title || "Computer Science");
        if (saveRes && saveRes.success) {
          const note = await (window as any).electronAPI.invoke('notes:add', course.id, newNoteContent.trim());
          setNotes(prev => [...prev, note]);
          setNewNoteContent('');
        }
      }
    } catch (e) {
      console.error('Failed to add note', e);
    }
  };

  const handleUpdateNote = async (id: string) => {
    if (!editingContent.trim()) return;
    try {
      if ((window as any).electronAPI) {
        await (window as any).electronAPI.invoke('notes:update', id, editingContent.trim());
        setNotes(prev => prev.map(n => n.id === id ? { ...n, content: editingContent.trim() } : n));
        setEditingNoteId(null);
      }
    } catch (e) {
      console.error('Failed to update note', e);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      if ((window as any).electronAPI) {
        await (window as any).electronAPI.invoke('notes:delete', id);
        setNotes(prev => prev.filter(n => n.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete note', e);
    }
  };

  // All content is now data-driven from `content` state (CourseContent model)
  // No hardcoded arrays — users curate their own workspace content

  return (
    <div className="h-full flex bg-surface font-body overflow-hidden">
      {/* LEFT NAVIGATION PANEL */}
      <div className="w-56 shrink-0 bg-surface-container-low border-r border-outline-variant/10 flex flex-col p-3 gap-1 select-none">
        <div className="px-3 py-2 border-b border-outline-variant/10 mb-2">
          <p className="text-[10px] font-black text-primary uppercase tracking-widest truncate">{course?.provider}</p>
          <h2 className="text-xs font-black text-on-surface truncate leading-tight mt-0.5" title={course?.title}>{course?.title}</h2>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto no-scrollbar">
          {(() => {
            const customCats = Array.from(
              new Set(
                (content.resources || [])
                  .map(r => (r as any).category)
                  .filter((c): c is string => typeof c === 'string' && !!c.trim() && !['Video', 'Notes', 'Assignment', 'Quiz', 'Reading', 'Project', 'Other'].includes(c))
              )
            );

            const sections = [
              { id: 'overview', label: 'Overview', icon: BookOpen },
              { id: 'extractor', label: 'Syllabus Extractor', icon: Sparkles },
              { id: 'videos', label: 'Videos', icon: Video },
              { id: 'notes', label: 'Notes', icon: FileText },
              { id: 'resources', label: 'Resources', icon: Layers },
            ];

            // Dynamic Custom Category Boxes
            customCats.forEach(cat => {
              sections.push({ id: `custom_${cat}`, label: cat, icon: Layers });
            });

            sections.push(
              { id: 'assignments', label: 'Assignments', icon: FileCheck },
              { id: 'projects', label: 'Projects', icon: Briefcase },
              { id: 'website', label: 'Official Website', icon: Globe },
              { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
              { id: 'downloads', label: 'Downloads', icon: Download },
              { id: 'discussion', label: 'Discussion', icon: MessageSquare }
            );

            return sections.map(section => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center rounded-lg font-headline font-bold text-xs tracking-tight transition-all py-2 px-3 outline-none relative group ${
                    isActive
                      ? 'text-primary bg-primary/5'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-md"></div>
                  )}
                  <Icon className="w-4 h-4 shrink-0 mr-3" />
                  <span className="truncate">{section.label}</span>
                </button>
              );
            });
          })()}
        </nav>
      </div>

      {/* CENTER WORKSPACE DISPLAY PANEL */}
      <div className="flex-1 min-w-0 bg-surface flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-y-auto min-h-0 relative p-6">
          <AnimatePresence mode="wait">
            {/* Overview Section */}
            {activeSection === 'overview' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 max-w-3xl">
                <div className="space-y-3">
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider">{course?.provider}</span>
                  <h1 className="text-3xl font-extrabold font-headline tracking-tight text-on-surface">{course?.title}</h1>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-y border-outline-variant/10">
                  {course?.university && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold text-outline uppercase tracking-wider">University</span>
                      <p className="text-xs font-black text-on-surface">{course?.university}</p>
                    </div>
                  )}
                  {course?.instructor && (
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Instructor</span>
                      <p className="text-xs font-black text-on-surface">{course?.instructor}</p>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Duration</span>
                    <p className="text-xs font-black text-on-surface">{course?.duration}</p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Language</span>
                    <p className="text-xs font-black text-on-surface">{course?.language}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-bold font-headline text-outline uppercase tracking-widest">Course Description</h3>
                  <p className="text-sm text-on-surface-variant leading-relaxed font-body">{course?.description}</p>
                </div>

                <div className="flex gap-3 pt-4">
                  <a
                    href={course?.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-primary text-on-primary py-3 px-6 rounded-xl text-xs font-bold hover:opacity-95 shadow-md flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <Globe className="w-4 h-4" />
                    Open Official Website
                  </a>
                  <button
                    onClick={() => handleToggleBookmark(course.title, course.officialUrl)}
                    className={`py-3 px-6 rounded-xl text-xs font-bold border flex items-center gap-2 transition-all cursor-pointer ${
                      isBookmarked(course.officialUrl)
                        ? 'bg-primary/5 border-primary text-primary'
                        : 'bg-surface border-outline/35 text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {isBookmarked(course.officialUrl) ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                    {isBookmarked(course.officialUrl) ? 'Bookmarked' : 'Bookmark Course'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Videos Section */}
            {activeSection === 'videos' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="h-full flex flex-col space-y-4">
                {activeVideoUrl ? (
                  <div className="flex-1 flex flex-col space-y-3 min-h-0">
                    <div className="flex justify-between items-center bg-surface-container-low p-3 rounded-xl border border-outline-variant/10 shrink-0">
                      <span className="text-xs font-bold text-on-surface truncate flex-1 pr-4">
                        Streaming: {content.videos.find(v => v.url === activeVideoUrl)?.title || activeVideoUrl}
                      </span>
                      <button onClick={() => setActiveVideoUrl(null)} className="text-xs font-bold text-red-500 hover:underline cursor-pointer">Close Stream</button>
                    </div>
                    <div className="flex-1 bg-black rounded-xl overflow-hidden shadow-lg border border-outline-variant/15 relative min-h-0">
                      <webview
                        ref={videoWebviewRef}
                        src={activeVideoUrl}
                        className="w-full h-full"
                        // @ts-ignore
                        partition="persist:browser"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5 max-w-3xl">
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold font-headline">Course Videos</h2>
                      <p className="text-xs text-outline font-medium">Add video links manually, or search YouTube to find real course lectures.</p>
                    </div>

                    {/* YouTube Search */}
                    <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-4 space-y-3">
                      <p className="text-xs font-black text-outline uppercase tracking-wider">🔍 Find on YouTube</p>
                      <form onSubmit={handleYtSearch} className="flex gap-2">
                        <input
                          type="text"
                          placeholder={`Search "${course?.title || 'course'}" on YouTube...`}
                          value={ytSearchQuery}
                          onChange={e => setYtSearchQuery(e.target.value)}
                          className="flex-1 bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                        <button type="submit" disabled={ytSearchLoading}
                          className="bg-primary text-on-primary px-4 rounded-xl text-xs font-bold hover:opacity-90 flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                          {ytSearchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          Search
                        </button>
                      </form>
                      {ytSearchResults.length > 0 && (
                        <div className="space-y-2">
                          {ytSearchResults.map(r => (
                            <div key={r.id} className="flex items-center gap-3 p-2.5 bg-surface-container-low rounded-xl border border-outline-variant/10">
                              <img src={r.thumbnail} className="w-16 h-10 rounded object-cover shrink-0" onError={e => (e.target as HTMLElement).style.display = 'none'} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-on-surface truncate">{r.title}</p>
                                <p className="text-[10px] text-outline truncate">{r.instructor} · {r.duration}</p>
                              </div>
                              <button onClick={() => handleAddYtResult(r)}
                                className="bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-bold hover:opacity-90 shrink-0 cursor-pointer">
                                + Add
                              </button>
                            </div>
                          ))}
                          <button onClick={() => setYtSearchResults([])} className="text-[10px] text-outline hover:text-on-surface cursor-pointer">Clear results</button>
                        </div>
                      )}
                    </div>

                    {/* Manual Add Form */}
                    <form onSubmit={handleAddVideo} className="flex flex-col gap-2 bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-4">
                      <p className="text-xs font-black text-outline uppercase tracking-wider">➕ Add Video Link Manually</p>
                      <input type="url" placeholder="Video URL (YouTube, Vimeo, etc.)" value={addVideoUrl} onChange={e => setAddVideoUrl(e.target.value)}
                        className="bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                      <div className="flex gap-2">
                        <input type="text" placeholder="Title (optional)" value={addVideoTitle} onChange={e => setAddVideoTitle(e.target.value)}
                          className="flex-1 bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                        <button type="submit" className="bg-primary text-on-primary px-4 rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer">Add</button>
                      </div>
                    </form>

                    {/* Video List */}
                    {content.videos.length > 0 && (
                      <div className="grid grid-cols-1 gap-3">
                        {content.videos.map(video => {
                          const isWatched = isCompleted('video', video.id);
                          const isDownloadable = video.url && /\.(mp4|webm|ogg|mkv|mov|m4v|avi)$/i.test(video.url);
                          const savedMaterial = downloadedMaterials.find(m => m.url === video.url);
                          const isDownloaded = !!(savedMaterial && (savedMaterial.localPath || !isDownloadable));
                          const fileSizeStr = savedMaterial?.fileSizeBytes 
                            ? `${(savedMaterial.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` 
                            : '';

                          return (
                            <div key={video.id} className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 flex items-center justify-between hover:border-primary/20 transition-all">
                              <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                                <button onClick={() => toggleCompleted('video', video.id)}
                                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                                    isWatched ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-outline/40 text-transparent hover:border-primary'
                                  }`}>
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <Video className="w-5 h-5 text-outline opacity-40 shrink-0" />
                                <div className="min-w-0">
                                  <span className="text-sm font-bold text-on-surface truncate block cursor-pointer" onClick={() => {
                                    if (savedMaterial) {
                                      openTab('document', savedMaterial.title, savedMaterial);
                                    } else {
                                      setActiveVideoUrl(video.url!);
                                    }
                                  }}>
                                    {video.title}
                                  </span>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {video.duration && <span className="text-[10px] text-outline">{video.duration}</span>}
                                    {fileSizeStr && (
                                      <>
                                        <span className="text-[10px] text-outline opacity-40">·</span>
                                        <span className="text-[10px] text-outline font-medium">{fileSizeStr}</span>
                                      </>
                                    )}
                                    {savedMaterial && (
                                      <>
                                        <span className="text-[10px] text-outline opacity-40">·</span>
                                        <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">AI Ready</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {video.url && <button onClick={() => handleToggleBookmark(video.title, video.url!)}
                                  className="p-2 hover:bg-surface-container-high rounded-lg text-outline-variant transition-all cursor-pointer">
                                  {isBookmarked(video.url) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                                </button>}

                                {isDownloadable ? (
                                  <button disabled={downloadingId !== null}
                                    onClick={() => {
                                      if (isDownloaded && savedMaterial) {
                                        openTab('document', savedMaterial.title, savedMaterial);
                                      } else {
                                        const filename = video.url!.split('/').pop() || 'video.mp4';
                                        handleDownloadFile(video.url!, filename, video.id);
                                      }
                                    }}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold shadow flex items-center gap-1.5 transition-all cursor-pointer ${
                                      isDownloaded ? 'bg-emerald-600 text-white hover:opacity-90' : 'bg-primary text-on-primary hover:opacity-90'
                                    }`}>
                                    {downloadingId === video.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : isDownloaded ? (
                                      <Cpu className="w-3.5 h-3.5" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5" />
                                    )}
                                    {isDownloaded ? 'Study with AI' : 'Download'}
                                  </button>
                                ) : (
                                  <button onClick={() => {
                                    if (savedMaterial) {
                                      openTab('document', savedMaterial.title, savedMaterial);
                                    } else {
                                      setActiveVideoUrl(video.url!);
                                    }
                                  }}
                                    className="bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 shadow transition-all cursor-pointer flex items-center gap-1.5">
                                    {savedMaterial ? <Cpu className="w-3.5 h-3.5" /> : '▶'}
                                    {savedMaterial ? 'Study with AI' : 'Play'}
                                  </button>
                                )}

                                <button onClick={() => handleRemoveVideo(video.id)}
                                  className="p-2 hover:bg-red-50 text-red-400 rounded-lg transition-all cursor-pointer">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {content.videos.length === 0 && ytSearchResults.length === 0 && (
                      <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-2">
                        <Video className="w-10 h-10 text-outline-variant opacity-30 mx-auto" />
                        <p className="text-xs font-bold text-outline italic">No videos yet. Search YouTube above or add a link manually.</p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* Notes Section — personal notes (resources with PDFs are in Resources tab) */}
            {activeSection === 'notes' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold font-headline">Course Resources & PDFs</h2>
                  <p className="text-xs text-outline font-medium">Add PDF links or resource URLs. Downloaded PDFs can be studied with the AI Tutor.</p>
                </div>

                {errorMsg && (
                  <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-3.5 text-xs font-bold">
                    {errorMsg}
                  </div>
                )}

                <form onSubmit={handleAddResource} className="flex flex-col gap-2 bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-4">
                  <p className="text-xs font-black text-outline uppercase tracking-wider">➕ Add a Resource Link</p>
                  <input type="url" placeholder="PDF or resource URL" value={addResourceUrl} onChange={e => setAddResourceUrl(e.target.value)}
                    className="bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                  <div className="flex gap-2">
                    <input type="text" placeholder="Title (optional)" value={addResourceTitle} onChange={e => setAddResourceTitle(e.target.value)}
                      className="flex-1 bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                    <button type="submit" className="bg-primary text-on-primary px-4 rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer">Add</button>
                  </div>
                </form>

                {content.resources.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-2">
                    <FileText className="w-10 h-10 text-outline-variant opacity-30 mx-auto" />
                    <p className="text-xs font-bold text-outline italic">No resources added yet. Paste a PDF link or GitHub URL above.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {content.resources.map(res => {
                      const isGit = res.type === 'github';
                      const isFile = res.type === 'pdf' || (res.url && /\.(pdf|docx|doc|txt|ipynb|py|zip)$/i.test(res.url));
                      const isDownloaded = isFile && downloadedMaterials.some(m => m.url === res.url);
                      const isDone = isCompleted('resource', res.id);
                      return (
                        <div key={res.id} className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 flex items-center justify-between hover:border-primary/20 transition-all">
                          <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                            <button onClick={() => toggleCompleted('resource', res.id)}
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                                isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-outline/40 text-transparent hover:border-primary'
                              }`}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <Layers className="w-5 h-5 text-outline opacity-40 shrink-0" />
                            <span className="text-sm font-bold text-on-surface truncate">{res.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {res.url && <button onClick={() => handleToggleBookmark(res.title, res.url!)}
                              className="p-2 hover:bg-surface-container-high rounded-lg text-outline-variant transition-all cursor-pointer">
                              {isBookmarked(res.url) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                            </button>}
                            {isFile && res.url ? (
                              <button disabled={downloadingId !== null}
                                onClick={() => {
                                  const m = downloadedMaterials.find(m => m.url === res.url);
                                  if (isDownloaded && m) {
                                    const ext = (m.localPath || m.url || '').split('.').pop()?.toLowerCase() || '';
                                    if (ext === 'pdf') {
                                      setSelectedTutorMaterial(m);
                                    } else {
                                      openTab('document', m.title, m);
                                    }
                                  } else {
                                    const filename = res.url!.split('/').pop() || 'resource.pdf';
                                    handleDownloadFile(res.url!, filename, res.id);
                                  }
                                }}
                                className={`px-4 py-2 rounded-lg text-xs font-bold shadow flex items-center gap-1.5 transition-all cursor-pointer ${
                                  isDownloaded ? 'bg-emerald-600 text-white hover:opacity-90' : 'bg-primary text-on-primary hover:opacity-90'
                                }`}>
                                {downloadingId === res.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : isDownloaded ? (
                                  (downloadedMaterials.find(m => m.url === res.url)?.localPath || '').toLowerCase().endsWith('.pdf') ? (
                                    <Cpu className="w-3.5 h-3.5" />
                                  ) : (
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  )
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                                {isDownloaded ? (
                                  (downloadedMaterials.find(m => m.url === res.url)?.localPath || '').toLowerCase().endsWith('.pdf') ? 'Study with AI' : 'Open'
                                ) : 'Download'}
                              </button>
                            ) : res.url ? (
                              <a href={res.url} target="_blank" rel="noopener noreferrer"
                                className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/15 flex items-center gap-1.5 transition-all">
                                <ExternalLink className="w-3.5 h-3.5" /> Open
                              </a>
                            ) : null}
                            <button onClick={() => handleRemoveResource(res.id)}
                              className="p-2 hover:bg-red-50 text-red-400 rounded-lg transition-all cursor-pointer">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* Resources Section — redirects to Notes tab which now handles resources */}
            {activeSection === 'resources' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <div className="p-8 text-center space-y-3">
                  <Layers className="w-12 h-12 text-primary opacity-30 mx-auto" />
                  <h2 className="text-lg font-bold font-headline">Resources merged into Notes tab</h2>
                  <p className="text-sm text-on-surface-variant">PDFs, GitHub repos, and other links are now managed under the <strong>Notes</strong> section for a unified view.</p>
                  <button onClick={() => setActiveSection('notes')}
                    className="bg-primary text-on-primary py-2.5 px-6 rounded-xl text-xs font-bold hover:opacity-90 shadow cursor-pointer">
                    Go to Notes & Resources
                  </button>
                </div>
              </motion.div>
            )}

            {/* Dynamic Custom Category Sections */}
            {activeSection.startsWith('custom_') && (
              (() => {
                const activeCategory = activeSection.replace('custom_', '');
                const filteredResources = (content.resources || []).filter(r => (r as any).category === activeCategory);
                
                const handleAddCustomResource = async (e: React.FormEvent) => {
                  e.preventDefault();
                  if (!addResourceUrl.trim()) return;
                  const url = addResourceUrl.trim();
                  const title = addResourceTitle.trim() || url;
                  const type = url.includes('github.com') ? 'github' : url.endsWith('.pdf') ? 'pdf' : 'link';
                  const newItem: ContentItem = {
                    id: crypto.randomUUID(),
                    title,
                    url,
                    type: type as any,
                    addedBy: 'user',
                    category: activeCategory
                  };
                  const next = { ...content, resources: [...(content.resources || []), newItem] };
                  await saveContent(next);
                  setAddResourceUrl('');
                  setAddResourceTitle('');
                };

                return (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold font-headline">{activeCategory}</h2>
                      <p className="text-xs text-outline font-medium">Resources and materials categorized under {activeCategory}.</p>
                    </div>

                    {errorMsg && (
                      <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl p-3.5 text-xs font-bold">
                        {errorMsg}
                      </div>
                    )}

                    <form onSubmit={handleAddCustomResource} className="flex flex-col gap-2 bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-4">
                      <p className="text-xs font-black text-outline uppercase tracking-wider">➕ Add a {activeCategory} Link</p>
                      <input type="url" placeholder="Resource URL" value={addResourceUrl} onChange={e => setAddResourceUrl(e.target.value)}
                        className="bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                      <div className="flex gap-2">
                        <input type="text" placeholder="Title (optional)" value={addResourceTitle} onChange={e => setAddResourceTitle(e.target.value)}
                          className="flex-1 bg-surface-container-low border border-outline/20 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                        <button type="submit" className="bg-primary text-on-primary px-4 rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer">Add</button>
                      </div>
                    </form>

                    {filteredResources.length === 0 ? (
                      <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-2">
                        <FileText className="w-10 h-10 text-outline-variant opacity-30 mx-auto" />
                        <p className="text-xs font-bold text-outline italic">No materials in this box yet.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {filteredResources.map(res => {
                          const isGit = res.type === 'github';
                           const isFile = res.type === 'pdf' || (res.url && /\.(pdf|docx|doc|txt|ipynb|py|zip)$/i.test(res.url));
                           const isDownloaded = isFile && downloadedMaterials.some(m => m.url === res.url);
                           const isDone = isCompleted('resource', res.id);
                           return (
                             <div key={res.id} className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 flex items-center justify-between hover:border-primary/20 transition-all">
                               <div className="flex items-start gap-3 min-w-0 flex-1 mr-4">
                                 <button onClick={() => toggleCompleted('resource', res.id)}
                                   className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0 mt-0.5 ${
                                     isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-outline/40 text-transparent hover:border-primary'
                                   }`}>
                                   <Check className="w-3.5 h-3.5" />
                                 </button>
                                 <Layers className="w-5 h-5 text-outline opacity-40 shrink-0 mt-0.5" />
                                 <div className="min-w-0 flex-1">
                                   <span className="text-sm font-bold text-on-surface block truncate">{res.title}</span>
                                   {res.url && <span className="text-[10px] text-outline block truncate mt-0.5 font-mono">{res.url}</span>}
                                 </div>
                               </div>
                               <div className="flex items-center gap-2 shrink-0">
                                 {res.url && <button onClick={() => handleToggleBookmark(res.title, res.url!)}
                                   className="p-2 hover:bg-surface-container-high rounded-lg text-outline-variant transition-all cursor-pointer">
                                   {isBookmarked(res.url) ? <BookmarkCheck className="w-4 h-4 text-primary" /> : <Bookmark className="w-4 h-4" />}
                                 </button>}
                                 {isFile && res.url ? (
                                   <button disabled={downloadingId !== null}
                                     onClick={() => {
                                       const m = downloadedMaterials.find(m => m.url === res.url);
                                       if (isDownloaded && m) {
                                         const ext = (m.localPath || m.url || '').split('.').pop()?.toLowerCase() || '';
                                         if (ext === 'pdf') {
                                           setSelectedTutorMaterial(m);
                                         } else {
                                           openTab('document', m.title, m);
                                         }
                                       } else {
                                         const filename = res.url!.split('/').pop() || 'resource.pdf';
                                         handleDownloadFile(res.url!, filename, res.id);
                                       }
                                     }}
                                     className={`px-4 py-2 rounded-lg text-xs font-bold shadow flex items-center gap-1.5 transition-all cursor-pointer ${
                                       isDownloaded ? 'bg-emerald-600 text-white hover:opacity-90' : 'bg-primary text-on-primary hover:opacity-90'
                                     }`}>
                                     {downloadingId === res.id ? (
                                       <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                     ) : isDownloaded ? (
                                       (downloadedMaterials.find(m => m.url === res.url)?.localPath || '').toLowerCase().endsWith('.pdf') ? (
                                         <Cpu className="w-3.5 h-3.5" />
                                       ) : (
                                         <ExternalLink className="w-3.5 h-3.5" />
                                       )
                                     ) : (
                                       <Download className="w-3.5 h-3.5" />
                                     )}
                                     {isDownloaded ? (
                                       (downloadedMaterials.find(m => m.url === res.url)?.localPath || '').toLowerCase().endsWith('.pdf') ? 'Study with AI' : 'Open'
                                     ) : 'Download'}
                                   </button>
                                 ) : res.url ? (
                                   <a href={res.url} target="_blank" rel="noopener noreferrer"
                                     className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-xs font-bold hover:bg-primary/15 flex items-center gap-1.5 transition-all">
                                     <ExternalLink className="w-3.5 h-3.5" /> Open
                                   </a>
                                 ) : null}
                                <button onClick={() => handleRemoveResource(res.id)}
                                  className="p-2 hover:bg-red-50 text-red-400 rounded-lg transition-all cursor-pointer">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                );
              })()
            )}

            {/* Assignments Section */}
            {activeSection === 'assignments' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold font-headline">Assignments</h2>
                  <p className="text-xs text-outline font-medium">Add assignments to track. Mark them complete to update your course progress.</p>
                </div>

                <form onSubmit={handleAddAssignment} className="flex gap-2">
                  <input type="text" placeholder="Assignment title..." value={addAssignmentTitle} onChange={e => setAddAssignmentTitle(e.target.value)}
                    className="flex-1 bg-surface-container-lowest border border-outline/25 rounded-xl p-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none" />
                  <button type="submit" className="bg-primary text-on-primary px-4 rounded-xl text-xs font-bold hover:opacity-90 cursor-pointer">Add</button>
                </form>

                {content.assignments.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-2">
                    <FileCheck className="w-10 h-10 text-outline-variant opacity-30 mx-auto" />
                    <p className="text-xs font-bold text-outline italic">No assignments yet. Add them above to track your completion.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {content.assignments.map(ass => {
                      const isDone = isCompleted('assignment', ass.id);
                      return (
                        <div key={ass.id} className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 flex items-center justify-between hover:border-primary/20 transition-all">
                          <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
                            <button onClick={() => toggleCompleted('assignment', ass.id)}
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                                isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-outline/40 text-transparent hover:border-primary'
                              }`}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <FileCheck className="w-5 h-5 text-outline opacity-40 shrink-0" />
                            <span className="text-sm font-bold text-on-surface truncate">{ass.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${isDone ? 'bg-green-50 text-green-700' : 'bg-surface-container-low text-outline'}`}>
                              {isDone ? 'Completed' : 'Pending'}
                            </span>
                            <button onClick={() => handleRemoveAssignment(ass.id)}
                              className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-all cursor-pointer">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* Projects Section */}
            {activeSection === 'projects' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold font-headline">Course Projects</h2>
                  <p className="text-xs text-outline font-medium">Visit the official course website to find project briefs and submission guidelines.</p>
                </div>
                <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-3">
                  <Briefcase className="w-12 h-12 text-outline-variant opacity-30 mx-auto" />
                  <p className="text-xs font-bold text-outline italic">Project details are available on the official course website.</p>
                  <button onClick={() => setActiveSection('website')}
                    className="bg-primary text-on-primary py-2.5 px-6 rounded-xl text-xs font-bold hover:opacity-90 shadow cursor-pointer">
                    Open Official Website
                  </button>
                </div>
              </motion.div>
            )}

            {/* Official Website WebView — primary learning surface */}
            {activeSection === 'website' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col p-4">
                <div className="flex-1 bg-surface-container-low border border-outline-variant/10 rounded-2xl overflow-hidden shadow-inner">
                  <webview
                    ref={websiteWebviewRef}
                    src={course?.officialUrl}
                    className="w-full h-full"
                    // @ts-ignore
                    partition="persist:browser"
                  />
                </div>
              </motion.div>
            )}

            {/* Bookmarks list */}
            {activeSection === 'bookmarks' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <h2 className="text-xl font-bold font-headline">Course Bookmarks</h2>
                <div className="grid grid-cols-1 gap-2">
                  {bookmarks.filter(b => b.url.includes(course?.provider.toLowerCase()) || b.title.includes(course?.title.slice(0, 10))).length === 0 && (
                    <p className="text-xs font-bold text-outline italic p-6 text-center">No bookmarks saved for this course yet.</p>
                  )}
                  {bookmarks.filter(b => b.url.includes(course?.provider.toLowerCase()) || b.title.includes(course?.title.slice(0, 10))).map(b => (
                    <div key={b.id} className="bg-surface-container-lowest p-3.5 rounded-xl border border-outline-variant/10 flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0 mr-4">
                        <Bookmark className="w-4 h-4 text-primary opacity-60" />
                        <div className="truncate">
                          <p className="text-sm font-bold text-on-surface truncate">{b.title}</p>
                          <p className="text-[10px] text-outline truncate">{b.url}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {b.url.startsWith('https://www.youtube.com') ? (
                          <button
                            onClick={() => {
                              setActiveVideoUrl(b.url);
                              setActiveSection('videos');
                            }}
                            className="bg-primary/10 text-primary px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-primary/15 transition-all cursor-pointer"
                          >
                            Watch
                          </button>
                        ) : (
                          <a
                            href={b.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-primary/10 text-primary px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-primary/15 flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open
                          </a>
                        )}
                        <button
                          onClick={() => handleToggleBookmark(b.title, b.url)}
                          className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Imported Materials — shows ALL types: YouTube, Files, Website Links */}
            {activeSection === 'downloads' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5 max-w-3xl">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold font-headline">Imported Course Materials</h2>
                    <p className="text-xs text-outline font-medium">
                      All resources imported into your Vault — Videos, Files, and Website Links.
                      {downloadedMaterials.length > 0 && (
                        <span className="ml-2 bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full text-[10px]">
                          {downloadedMaterials.length} loaded
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearCourseMaterials}
                    className="px-3.5 py-2 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors flex items-center gap-2 cursor-pointer select-none"
                    title="Clear all imported materials for this course from Vault sidebar"
                  >
                    <Trash2 className="w-4 h-4" />
                    Purge All
                  </button>
                </div>

                {loadingDownloads && downloadedMaterials.length === 0 ? (
                  <div className="flex justify-center p-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : downloadedMaterials.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-2">
                    <Download className="w-10 h-10 text-outline-variant opacity-40 mx-auto" />
                    <p className="text-xs font-bold text-outline italic">No materials imported yet. Use the Syllabus Extractor above to import course resources.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* 🎥 YouTube Videos */}
                    {downloadedMaterials.filter(m => m.boxType === 'youtube').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
                          <Video className="w-3.5 h-3.5 text-rose-500" />
                          YouTube Videos ({downloadedMaterials.filter(m => m.boxType === 'youtube').length})
                        </h3>
                        <div className="grid grid-cols-1 gap-2">
                          {downloadedMaterials.filter(m => m.boxType === 'youtube').map((mat) => (
                            <div key={mat.id} className="bg-rose-50/30 border border-rose-200/40 p-3.5 rounded-xl flex items-center justify-between hover:border-rose-300/60 transition-all">
                              <div className="flex items-center gap-3 min-w-0 mr-3">
                                <div className="w-8 h-8 bg-rose-100 rounded-lg flex items-center justify-center shrink-0">
                                  <Video className="w-4 h-4 text-rose-500" />
                                </div>
                                <p className="text-sm font-semibold text-on-surface truncate">{mat.title}</p>
                              </div>
                              <a href={mat.url} target="_blank" rel="noreferrer"
                                className="shrink-0 px-3 py-1.5 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 transition-colors flex items-center gap-1">
                                <ExternalLink className="w-3 h-3" /> Watch
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 📄 Downloadable Files */}
                    {downloadedMaterials.filter(m => m.boxType === 'file').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-blue-500" />
                          Files & Documents ({downloadedMaterials.filter(m => m.boxType === 'file').length})
                        </h3>
                        <div className="grid grid-cols-1 gap-2">
                          {downloadedMaterials.filter(m => m.boxType === 'file').map((mat) => (
                            <div key={mat.id} className="bg-blue-50/30 border border-blue-200/40 p-3.5 rounded-xl flex items-center justify-between hover:border-blue-300/60 transition-all">
                              <div className="flex items-center gap-3 min-w-0 mr-3">
                                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                                  <FileText className="w-4 h-4 text-blue-500" />
                                </div>
                                <div className="truncate">
                                  <p className="text-sm font-semibold text-on-surface truncate">{mat.title}</p>
                                  {mat.fileSizeBytes && <p className="text-[10px] text-outline">{Math.round(mat.fileSizeBytes / 1024)} KB</p>}
                                </div>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button onClick={() => setSelectedTutorMaterial(mat)}
                                  className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1 cursor-pointer">
                                  <Cpu className="w-3 h-3" /> Tutor
                                </button>
                                <button onClick={() => openTab('document', mat.title, mat)}
                                  className="px-3 py-1.5 bg-primary/10 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors cursor-pointer">
                                  Open
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 🌐 Website Links */}
                    {downloadedMaterials.filter(m => m.boxType === 'link').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-outline uppercase tracking-wider flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-emerald-500" />
                          Website Links ({downloadedMaterials.filter(m => m.boxType === 'link').length})
                        </h3>
                        <div className="grid grid-cols-1 gap-2">
                          {downloadedMaterials.filter(m => m.boxType === 'link').map((mat) => (
                            <div key={mat.id} className="bg-emerald-50/30 border border-emerald-200/40 p-3.5 rounded-xl flex items-center justify-between hover:border-emerald-300/60 transition-all">
                              <div className="flex items-center gap-3 min-w-0 mr-3">
                                <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                                  <Globe className="w-4 h-4 text-emerald-500" />
                                </div>
                                <p className="text-sm font-semibold text-on-surface truncate">{mat.title}</p>
                              </div>
                              <a href={mat.url} target="_blank" rel="noreferrer"
                                className="shrink-0 px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1">
                                <ExternalLink className="w-3 h-3" /> Open
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Load More */}
                    {hasMoreMaterials && (
                      <div className="flex justify-center pt-2">
                        <button
                          onClick={() => reloadDownloadedMaterials(materialPage + 1)}
                          disabled={loadingDownloads}
                          className="px-6 py-2.5 bg-surface-container-high text-on-surface text-xs font-bold rounded-xl border border-outline-variant/20 hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {loadingDownloads ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          Load More Materials
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}


            {/* Discussion links */}
            {activeSection === 'discussion' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4 max-w-3xl">
                <div className="space-y-1">
                  <h2 className="text-xl font-bold font-headline">Discussion & Community</h2>
                  <p className="text-xs text-outline font-medium">Find the community on the official course website, or open the course platform directly.</p>
                </div>
                <div className="p-8 text-center border border-dashed border-outline-variant/20 rounded-2xl space-y-3">
                  <MessageSquare className="w-12 h-12 text-outline-variant opacity-30 mx-auto" />
                  <p className="text-xs font-bold text-outline italic">Community and discussion links are available on the official course website.</p>
                  <button onClick={() => setActiveSection('website')}
                    className="bg-primary text-on-primary py-2.5 px-6 rounded-xl text-xs font-bold hover:opacity-90 shadow cursor-pointer">
                    Open Official Website
                  </button>
                </div>
              </motion.div>
            )}

            {/* Syllabus Extractor View */}
            {activeSection === 'extractor' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6 max-w-4xl pb-12">
                <div className="space-y-1">
                  <h2 className="text-2xl font-black font-headline text-on-surface flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-primary" />
                    Syllabus & Resource Extractor
                  </h2>
                  <p className="text-xs font-medium text-outline">
                    Automatically crawl, extract, classify, and group course materials (videos, notes, assignments, quizzes, readings, projects) from any course page.
                  </p>
                </div>

                {/* URL INPUT & ACTION CARD */}
                <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-black text-outline uppercase tracking-wider">Course Syllabus / Page URL</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        placeholder="Paste course page URL here..."
                        value={extractorUrl}
                        onChange={e => setExtractorUrl(e.target.value)}
                        disabled={extractionLoading}
                        className="flex-1 bg-surface-container-low border border-outline/20 rounded-xl p-3 text-xs focus:ring-1 focus:ring-primary focus:outline-none disabled:opacity-50 font-mono"
                      />
                      <button
                        onClick={handleRunExtractor}
                        disabled={extractionLoading || !extractorUrl.trim()}
                        className="bg-surface-container-high hover:bg-surface-container-highest text-on-surface border border-outline-variant/20 px-5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40 transition-all select-none"
                      >
                        {extractionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
                        {extractionLoading ? 'Extracting...' : 'Crawl & Parse'}
                      </button>
                      <button
                        onClick={handleRunAIExtractor}
                        disabled={extractionLoading || !extractorUrl.trim()}
                        className="bg-primary text-on-primary px-5 rounded-xl text-xs font-bold hover:opacity-95 shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-40 transition-all select-none"
                        title={!(settings?.openrouterKey || settings?.openaiKey || settings?.geminiKey || settings?.anthropicKey) ? "Requires API Key in Settings" : "Send raw link JSON dataset to AI System Prompt"}
                      >
                        <Cpu className="w-4 h-4 text-emerald-300" />
                        Organize with AI (OpenRouter)
                      </button>
                    </div>
                  </div>

                  {/* LOADING STATUS PANEL */}
                  {extractionLoading && (
                    <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-primary flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {extractionStatus}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-outline italic hidden md:inline">Headless Electron window sandbox enabled</span>
                          <button
                            type="button"
                            onClick={handleCancelExtraction}
                            className="px-2.5 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden flex">
                        <div className="bg-primary h-full transition-all duration-300 ease-out" style={{ width: `${extractionProgress}%` }}></div>
                      </div>
                    </div>
                  )}

                  {/* IMPORT SUCCESS TOAST */}
                  {importSuccess && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl p-4 flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" />
                      Successfully imported selected materials into your Vault & Workspace!
                    </div>
                  )}
                </div>

                {/* EXTRACTED MATERIALS VIEW */}
                {editableGroups.length > 0 && (
                  <div className="space-y-6">
                    {/* Trim Warning Banner */}
                    {trimWarning?.trimmed && (
                      <div className="bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold rounded-xl p-3.5 flex items-start gap-2.5">
                        <span className="text-lg leading-none shrink-0">⚠️</span>
                        <div>
                          Showing the top <strong>120 high-value resources</strong> out of <strong>{trimWarning.originalCount}</strong> total links found.
                          {' '}For all resources, use <strong>Organize with AI</strong> which processes a curated 150-link dataset with full context.
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-surface-container-low border border-outline-variant/10 rounded-xl p-4 gap-4 shrink-0">
                      <div className="space-y-0.5">
                        <h3 className="text-sm font-bold text-on-surface">Extracted Curriculum</h3>
                        <p className="text-[10px] text-outline">
                          Found {editableGroups.reduce((acc, g) => acc + g.resources.length, 0)} links grouped into {editableGroups.length} sections.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <button
                            type="button"
                            onClick={handleSelectAllGlobal}
                            className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                          >
                            Select All
                          </button>
                          <span className="text-outline">·</span>
                          <button
                            type="button"
                            onClick={handleDeselectAllGlobal}
                            className="text-xs font-semibold text-outline hover:text-on-surface hover:underline cursor-pointer"
                          >
                            Deselect All
                          </button>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-on-surface font-medium">
                          <input
                            type="checkbox"
                            checked={autoDownloadPdfs}
                            onChange={e => setAutoDownloadPdfs(e.target.checked)}
                            className="w-4 h-4 rounded text-primary focus:ring-primary border-outline/30"
                          />
                          Auto-download PDFs
                        </label>
                        <button
                          onClick={handleImportSelected}
                          disabled={selectedResources.size === 0}
                          className="bg-primary text-on-primary px-5 py-2.5 rounded-xl text-xs font-bold hover:opacity-90 shadow-md disabled:opacity-40 transition-all flex items-center gap-2 cursor-pointer select-none"
                        >
                          <Check className="w-4 h-4" />
                          Import Selected ({selectedResources.size})
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {editableGroups.map((group, gIdx) => {
                        const groupUrls = group.resources.map((r: any) => r.url);
                        const groupSelectedCount = groupUrls.filter((url: string) => selectedResources.has(url)).length;
                        const isAllSelected = groupSelectedCount === groupUrls.length;
                        const isSomeSelected = groupSelectedCount > 0 && !isAllSelected;
                        const isCollapsed = collapsedGroups.has(group.groupName);

                        return (
                          <div key={group.groupName} className="border border-outline-variant/10 rounded-2xl overflow-hidden bg-surface-container-lowest shadow-sm">
                            {/* Group Header */}
                            <div className="flex items-center justify-between bg-surface-container-low/40 px-4 py-3 border-b border-outline-variant/10 select-none">
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isAllSelected}
                                  ref={el => {
                                    if (el) el.indeterminate = isSomeSelected;
                                  }}
                                  onChange={() => toggleSelectAllInGroup(gIdx)}
                                  className="w-4 h-4 rounded text-primary focus:ring-primary border-outline/30 cursor-pointer"
                                />
                                <span className="text-xs font-black text-on-surface uppercase tracking-wider">{group.groupName}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-outline bg-surface-container-high px-2.5 py-0.5 rounded-full">
                                  {groupSelectedCount}/{group.resources.length} selected
                                </span>
                                <button
                                  type="button"
                                  onClick={() => toggleCollapseGroup(group.groupName)}
                                  className="px-2.5 py-1 bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-[10px] font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                  {isCollapsed ? 'Expand' : 'Collapse'}
                                </button>
                              </div>
                            </div>

                            {/* Group Items */}
                            {!isCollapsed && (
                              <div className="divide-y divide-outline-variant/10">
                              {group.resources.map((res: any, rIdx: number) => {
                                const isSelected = selectedResources.has(res.url);
                                return (
                                  <div
                                    key={res.url}
                                    className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                                      isSelected ? 'bg-primary/[0.01]' : 'opacity-85'
                                    }`}
                                  >
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleSelectLink(res.url)}
                                        className="w-4 h-4 mt-1 rounded text-primary focus:ring-primary border-outline/30 cursor-pointer shrink-0"
                                      />
                                      <div className="space-y-1.5 flex-1 min-w-0">
                                        {/* Title Input */}
                                        <input
                                          type="text"
                                          value={res.anchorText}
                                          onChange={e => handleUpdateItemTitle(gIdx, rIdx, e.target.value)}
                                          className="text-sm font-bold text-on-surface bg-transparent border-b border-transparent hover:border-outline/20 focus:border-primary focus:outline-none w-full py-0.5 truncate"
                                        />
                                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-outline">
                                          <span className="font-mono truncate max-w-xs md:max-w-md block" title={res.url}>
                                            {res.url}
                                          </span>
                                          <span>·</span>
                                          <span className="italic truncate" title={res.surroundingText}>
                                            Context: "{res.surroundingText ? res.surroundingText.slice(0, 60) + '...' : 'None'}"
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Select Box and Info */}
                                    <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                                      {/* Confidence Meter */}
                                      {res.needsReview ? (
                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full select-none bg-rose-50 text-rose-700 border border-rose-100 flex items-center gap-1">
                                          ⚠️ Needs Review
                                        </span>
                                      ) : (
                                        <span
                                          className={`text-[9px] font-bold px-2 py-0.5 rounded-full select-none ${
                                            res.confidence >= 0.8
                                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                              : res.confidence >= 0.4
                                              ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                              : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                          }`}
                                        >
                                          {res.confidence >= 1.0
                                            ? 'Deterministic'
                                            : `${Math.round(res.confidence * 100)}% conf`}
                                        </span>
                                      )}

                                      {/* Category Dropdown */}
                                      <select
                                        value={res.category}
                                        onChange={e => {
                                          if (e.target.value === 'custom') {
                                            const customCat = prompt('Enter custom category name:');
                                            if (customCat && customCat.trim()) {
                                              handleUpdateItemCategory(gIdx, rIdx, customCat.trim());
                                            }
                                          } else {
                                            handleUpdateItemCategory(gIdx, rIdx, e.target.value);
                                          }
                                        }}
                                        className={`text-[10px] font-black rounded-lg py-1.5 px-2.5 border focus:outline-none cursor-pointer tracking-tight ${
                                          res.category === 'Video'
                                            ? 'bg-red-50/70 text-red-700 border-red-200'
                                            : res.category === 'Notes'
                                            ? 'bg-blue-50/70 text-blue-700 border-blue-200'
                                            : res.category === 'Assignment'
                                            ? 'bg-emerald-50/70 text-emerald-700 border-emerald-200'
                                            : res.category === 'Quiz'
                                            ? 'bg-orange-50/70 text-orange-700 border-orange-200'
                                            : res.category === 'Reading'
                                            ? 'bg-purple-50/70 text-purple-700 border-purple-200'
                                            : res.category === 'Project'
                                            ? 'bg-indigo-50/70 text-indigo-700 border-indigo-200'
                                            : 'bg-slate-100 text-slate-700 border-slate-300'
                                        }`}
                                      >
                                        <option value="Video">Video</option>
                                        <option value="Notes">Notes</option>
                                        <option value="Assignment">Assignment</option>
                                        <option value="Quiz">Quiz</option>
                                        <option value="Reading">Reading</option>
                                        <option value="Project">Project</option>
                                        <option value="Other">Other</option>
                                        {!['Video', 'Notes', 'Assignment', 'Quiz', 'Reading', 'Project', 'Other'].includes(res.category) && (
                                          <option value={res.category}>{res.category}</option>
                                        )}
                                        <option value="custom">+ Custom...</option>
                                      </select>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* RIGHT SIDEBAR PANEL */}
      <div className="w-80 shrink-0 bg-surface-container-low border-l border-outline-variant/10 flex flex-col min-h-0 overflow-hidden">
        {/* Right Panel Tabs — proper React state, not window global */}
        <div className="flex border-b border-outline-variant/10 shrink-0 p-1 bg-surface-container-lowest">
          {[
            { id: 'progress' as const, label: 'Progress' },
            { id: 'tutor' as const, label: 'AI Tutor' },
            { id: 'notes' as const, label: 'My Notes' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setRightTab(tab.id)}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider text-center rounded-lg transition-all cursor-pointer ${
                rightTab === tab.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-outline hover:bg-surface-container-high'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content areas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
          {/* Progress Tab */}
          {rightTab === 'progress' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-outline">Course Completion</h3>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-surface-container-high rounded-full h-3 overflow-hidden border border-outline-variant/5">
                    <div
                      className="bg-primary h-3 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${calculateCompletion()}%` }}
                    />
                  </div>
                  <span className="text-xs font-black text-primary">{calculateCompletion()}%</span>
                </div>
              </div>

              {/* Milestones — derived from real course content */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-outline">Milestones</h3>
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-3 space-y-2">
                  {[
                    { id: 'course_opened', label: 'Course Opened' },
                    ...content.videos.map(v => ({ id: `video_${v.id}`, label: `Watched: ${v.title.slice(0, 30)}${v.title.length > 30 ? '…' : ''}` })),
                    ...content.resources.map(r => ({ id: `resource_${r.id}`, label: `Reviewed: ${r.title.slice(0, 30)}${r.title.length > 30 ? '…' : ''}` })),
                    ...content.assignments.map(a => ({ id: `assignment_${a.id}`, label: a.title.slice(0, 35) }))
                  ].map(milestone => {
                    const isDone = progress[milestone.id] === true;
                    return (
                      <div key={milestone.id} className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => {
                            const next = { ...progress, [milestone.id]: !progress[milestone.id] };
                            saveProgress(next);
                          }}
                          className={`w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                            isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-outline/40 text-transparent hover:border-primary'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <span className={`font-semibold ${isDone ? 'text-outline line-through' : 'text-on-surface'}`}>{milestone.label}</span>
                      </div>
                    );
                  })}
                  {content.videos.length === 0 && content.assignments.length === 0 && (
                    <p className="text-[10px] text-outline italic text-center py-2">Add videos or assignments to track milestones.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI Tutor Tab */}
          {rightTab === 'tutor' && (
            <div className="h-full flex flex-col min-h-[400px]">
              {selectedTutorMaterial ? (
                <div className="flex-1 flex flex-col min-h-0 relative">
                  <div className="flex justify-between items-center bg-surface-container-high p-2 rounded-lg mb-3 shrink-0">
                    <span className="text-[10px] font-black text-primary uppercase truncate flex-1 mr-2">Tutor: {selectedTutorMaterial.title}</span>
                    <button
                      onClick={() => setSelectedTutorMaterial(null)}
                      className="text-[10px] font-bold text-red-500 hover:underline cursor-pointer"
                    >
                      Exit Tutor
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    <AiTutorPanel
                      material={selectedTutorMaterial}
                      currentPage={1}
                      numPages={1}
                      pdfDoc={null}
                      isAiPaneOpen={true}
                      setIsAiPaneOpen={() => {}}
                      professorSession={tutorSession}
                      setProfessorSession={setTutorSession}
                      onAnnotations={setProfessorAnnotations}
                      onBoardActions={setBoardActionQueue}
                      jumpToPage={() => {}}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-center items-center text-center p-6 space-y-4">
                  <Cpu className="w-12 h-12 text-outline-variant opacity-30 animate-pulse text-primary" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-black uppercase tracking-wider text-on-surface">AI Tutor Ready</h4>
                    <p className="text-[11px] text-outline leading-normal max-w-[200px]">
                      The AI Tutor works strictly on downloaded PDFs, official notes, or personal notes.
                    </p>
                  </div>
                  {downloadedMaterials.length > 0 ? (
                    <div className="w-full space-y-2 pt-2">
                      <p className="text-[10px] font-bold text-outline text-left">Select a downloaded file to chat:</p>
                      <div className="max-h-36 overflow-y-auto space-y-1 border border-outline-variant/10 rounded-lg p-1">
                        {downloadedMaterials.map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedTutorMaterial(m)}
                            className="w-full text-left p-2 rounded hover:bg-surface-container-high text-[11px] font-bold truncate block text-primary cursor-pointer"
                          >
                            {m.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setActiveSection('notes')}
                      className="bg-primary text-on-primary py-2 px-4 rounded-lg text-[10px] font-black uppercase tracking-wider hover:opacity-90 shadow transition-all cursor-pointer"
                    >
                      Go Download Notes
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Personal Notes Tab */}
          {rightTab === 'notes' && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a study note..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  className="flex-1 bg-surface-container-lowest border border-outline/25 rounded-lg p-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                />
                <button
                  type="submit"
                  className="bg-primary text-on-primary px-3 rounded-lg text-xs font-bold hover:opacity-95 cursor-pointer"
                >
                  Add
                </button>
              </form>

              <div className="space-y-2 max-h-[350px] overflow-y-auto no-scrollbar">
                {notes.length === 0 && (
                  <p className="text-[10px] text-outline text-center py-6 italic">No notes created yet. Take notes above!</p>
                )}
                {notes.map(note => (
                  <div key={note.id} className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/10 space-y-2">
                    {editingNoteId === note.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          className="w-full bg-surface-container-low rounded-lg p-2 text-xs focus:ring-1 focus:ring-primary focus:outline-none h-16 resize-none"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setEditingNoteId(null)} className="py-1 px-2.5 bg-surface-container-high rounded text-[10px] font-bold cursor-pointer">Cancel</button>
                          <button onClick={() => handleUpdateNote(note.id)} className="py-1 px-2.5 bg-primary text-on-primary rounded text-[10px] font-bold cursor-pointer">Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-on-surface leading-relaxed font-body">{note.content}</p>
                        <div className="flex justify-between items-center text-[9px] font-bold text-outline pt-1">
                          <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setEditingContent(note.content);
                              }}
                              className="hover:text-primary cursor-pointer"
                            >
                              Edit
                            </button>
                            <button onClick={() => handleDeleteNote(note.id)} className="hover:text-red-500 cursor-pointer">Delete</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
