import React, { useState, useEffect, useCallback } from 'react';
import { Search, Star, BookOpen, Clock, Globe, Languages, Award, ChevronDown, Check, Loader2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTabs } from '../../hooks/useTabs';
import { useAuth } from '../../contexts/AuthContext';

interface CourseMetadata {
  id: string;
  title: string;
  provider: string;
  providerCourseId: string;
  officialUrl: string;
  thumbnail: string;
  description: string;
  language: string;
  duration: string;
  isFree: boolean;
  rating?: number;
  instructor?: string;
  university?: string;
  popularity?: number;
  certificateAvailable?: boolean;
  lastUpdated?: string;
}

export default function CourseExplorer() {
  const { openTab } = useTabs();
  const { user } = useAuth();
  const profileId = user?.id || '';

  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [courses, setCourses] = useState<CourseMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  
  // Save status tracking
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Filter states
  const [filters, setFilters] = useState({
    free: false,
    paid: false,
    language: '',
    duration: '',
    provider: '',
    university: '',
    rating: '',
    certificateAvailable: undefined as boolean | undefined
  });

  const [showFilters, setShowFilters] = useState(false);

  // Load configured providers on mount
  useEffect(() => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.invoke('courses:getProviders').then((list: string[]) => {
        if (list) setProviders(list);
      });
    }
  }, []);

  // Fetch results based on query and filters
  const performSearch = useCallback(async (queryToSearch: string) => {
    setLoading(true);
    try {
      if ((window as any).electronAPI) {
        // Run curated catalog search immediately
        const curatedPromise = (window as any).electronAPI.invoke('courses:search', queryToSearch, filters);

        // Run YouTube scraper in parallel only if user typed a query
        const youtubePromise = queryToSearch.trim()
          ? (window as any).electronAPI.invoke('courses:searchYouTube', queryToSearch)
          : Promise.resolve([]);

        const [curated, youtube] = await Promise.all([curatedPromise, youtubePromise]);

        // Merge: curated first, then YouTube results not already in curated
        const curatedIds = new Set((curated || []).map((c: CourseMetadata) => c.id));
        const mergedYt = (youtube || []).filter((r: CourseMetadata) => !curatedIds.has(r.id));

        setCourses([...(curated || []), ...mergedYt]);
      }
    } catch (e) {
      console.error('Failed to search courses', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Initial load
  useEffect(() => {
    performSearch('');
  }, []);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActiveQuery(searchQuery);
    performSearch(searchQuery);
  };

  const handleExampleClick = (term: string) => {
    setSearchQuery(term);
    setActiveQuery(term);
    // Directly run search for the example term
    setLoading(true);
    if ((window as any).electronAPI) {
      (window as any).electronAPI.invoke('courses:search', term, filters).then((results: any) => {
        setCourses(results || []);
        setLoading(false);
      });
    }
  };

  const handleOpenCourse = async (course: CourseMetadata) => {
    try {
      if ((window as any).electronAPI) {
        // Upsert course and get full metadata
        const fullCourse = await (window as any).electronAPI.invoke('courses:open', course, profileId);
        openTab('course-workspace', course.title, fullCourse);
      }
    } catch (e) {
      console.error('Failed to open course', e);
    }
  };

  const handleSaveToVault = async (course: CourseMetadata) => {
    setSavingId(course.id);
    try {
      if ((window as any).electronAPI) {
        const result = await (window as any).electronAPI.invoke('courses:saveToVault', course, profileId, activeQuery || "Computer Science");
        if (result && result.success) {
          setSavedIds(prev => new Set(prev).add(course.id));
          // Notify the vault that it needs to refresh
          window.dispatchEvent(new Event('vault:reconciled'));
        }
      }
    } catch (e) {
      console.error('Failed to save course to vault', e);
    } finally {
      setSavingId(null);
    }
  };

  // Unique lists for filtering dropdowns (extracted from currently loaded courses/curated list)
  const languagesList = ["English", "Spanish", "French", "German"];
  const durationOptions = ["Short", "Medium", "Long"];
  const ratingOptions = ["4.0", "4.5", "4.8"];

  const exampleSearches = [
    "Machine Learning",
    "React",
    "DSA",
    "Python",
    "Docker",
    "AWS",
    "Operating System"
  ];

  return (
    <div className="h-full flex flex-col bg-surface font-body overflow-hidden">
      {/* Header & Search Area */}
      <div className="p-8 shrink-0 bg-surface-container-low border-b border-outline-variant/10">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-primary animate-pulse" />
            <div>
              <h1 className="text-3xl font-extrabold font-headline tracking-tight text-on-surface">Course Explorer</h1>
              <p className="text-xs text-outline font-medium uppercase tracking-wider">Discover premium learning resources inside sanctuary</p>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-outline" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search any course..."
                className="w-full bg-surface-container-lowest border border-outline/35 focus:border-primary rounded-2xl py-4 pl-12 pr-4 text-sm font-bold text-on-surface placeholder:text-outline focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all shadow-inner"
              />
            </div>
            <button
              type="submit"
              className="bg-primary text-on-primary px-8 rounded-2xl font-bold text-sm shadow-md hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`px-5 rounded-2xl font-bold text-sm border flex items-center gap-2 hover:bg-surface-container-high transition-all cursor-pointer ${
                showFilters ? 'bg-primary/5 border-primary text-primary' : 'bg-surface-container-lowest border-outline/30 text-on-surface'
              }`}
            >
              Filters
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </form>

          {/* Examples */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-bold text-outline">Examples:</span>
            {exampleSearches.map((term) => (
              <button
                key={term}
                onClick={() => handleExampleClick(term)}
                className="bg-surface-container-lowest border border-outline-variant/10 text-on-surface-variant hover:bg-primary/5 hover:text-primary hover:border-primary/20 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters Drawer */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 bg-surface-container-lowest border-b border-outline-variant/10 overflow-hidden"
          >
            <div className="max-w-4xl mx-auto p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Free / Paid Toggle */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Price Model</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const next = { ...filters, free: !filters.free };
                      setFilters(next);
                      // Auto-apply change
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      filters.free ? 'bg-primary/5 border-primary text-primary' : 'bg-surface-container-low border-outline/25 text-on-surface-variant'
                    }`}
                  >
                    Free
                  </button>
                  <button
                    onClick={() => {
                      const next = { ...filters, paid: !filters.paid };
                      setFilters(next);
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      filters.paid ? 'bg-primary/5 border-primary text-primary' : 'bg-surface-container-low border-outline/25 text-on-surface-variant'
                    }`}
                  >
                    Paid
                  </button>
                </div>
              </div>

              {/* Language */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Language</label>
                <select
                  value={filters.language}
                  onChange={(e) => setFilters({ ...filters, language: e.target.value })}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any Language</option>
                  {languagesList.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                </select>
              </div>

              {/* Duration */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Duration</label>
                <select
                  value={filters.duration}
                  onChange={(e) => setFilters({ ...filters, duration: e.target.value })}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any Duration</option>
                  {durationOptions.map(opt => <option key={opt} value={opt}>{opt} Courses</option>)}
                </select>
              </div>

              {/* Provider */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Learning Provider</label>
                <select
                  value={filters.provider}
                  onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any Provider</option>
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              {/* Rating */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Minimum Rating</label>
                <select
                  value={filters.rating}
                  onChange={(e) => setFilters({ ...filters, rating: e.target.value })}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any Rating</option>
                  {ratingOptions.map(opt => <option key={opt} value={opt}>{opt}+ Stars</option>)}
                </select>
              </div>

              {/* University */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">University</label>
                <select
                  value={filters.university}
                  onChange={(e) => setFilters({ ...filters, university: e.target.value })}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any University</option>
                  <option value="MIT">MIT</option>
                  <option value="Harvard University">Harvard University</option>
                  <option value="Stanford University">Stanford University</option>
                </select>
              </div>

              {/* Certificate toggle */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-outline uppercase tracking-wider block">Certificate Available</label>
                <select
                  value={filters.certificateAvailable === undefined ? '' : String(filters.certificateAvailable)}
                  onChange={(e) => {
                    const val = e.target.value === '' ? undefined : e.target.value === 'true';
                    setFilters({ ...filters, certificateAvailable: val });
                  }}
                  className="w-full bg-surface-container-low border-none rounded-xl p-2.5 text-xs font-bold text-on-surface focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="">Any</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>

              {/* Filter Actions */}
              <div className="flex items-end justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setFilters({
                      free: false,
                      paid: false,
                      language: '',
                      duration: '',
                      provider: '',
                      university: '',
                      rating: '',
                      certificateAvailable: undefined
                    });
                  }}
                  className="py-2.5 px-4 rounded-xl bg-surface-container-low hover:bg-surface-container-high text-xs font-bold text-on-surface transition-all cursor-pointer"
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  onClick={() => performSearch(activeQuery)}
                  className="py-2.5 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold hover:opacity-90 shadow-md transition-all cursor-pointer"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Results View */}
      <div className="flex-1 overflow-y-auto p-8 min-h-0 bg-surface">
        <div className="max-w-6xl mx-auto space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <p className="text-sm font-bold text-outline uppercase tracking-widest animate-pulse">Scanning Courses...</p>
            </div>
          ) : courses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4 text-center">
              <BookOpen className="w-16 h-16 text-outline-variant opacity-25" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-on-surface">No Courses Found</h3>
                <p className="text-sm text-on-surface-variant max-w-sm">
                  We couldn't find any courses matching your search and filter criteria. Try resetting filters or changing the query.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map((course) => {
                const isSaved = savedIds.has(course.id);
                return (
                  <motion.div
                    key={course.id}
                    layout
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col bg-surface-container-lowest border border-outline-variant/10 rounded-2xl shadow-sm overflow-hidden hover:shadow-xl hover:border-primary/20 hover:scale-[1.01] transition-all duration-300"
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video w-full bg-surface-container-low overflow-hidden relative border-b border-outline-variant/5">
                      <img
                        src={course.thumbnail}
                        alt={course.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          // Fallback gradient in case URL load fails
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      {/* Provider Badge */}
                      <span className="absolute top-3 left-3 bg-surface-container-lowest/90 backdrop-blur px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider text-primary border border-primary/10 shadow-sm">
                        {course.provider}
                      </span>
                      {/* Price Badge */}
                      <span className={`absolute top-3 right-3 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white shadow-sm ${
                        course.isFree ? 'bg-emerald-600' : 'bg-blue-600'
                      }`}>
                        {course.isFree ? 'Free' : 'Paid'}
                      </span>
                    </div>

                    {/* Metadata Content */}
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        {/* Rating, University & Last Updated */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-outline">
                          {course.university && (
                            <span className="text-primary truncate">{course.university}</span>
                          )}
                          {course.rating && (
                            <span className="flex items-center gap-0.5 text-amber-500">
                              <Star className="w-3 h-3 fill-amber-500" />
                              {course.rating.toFixed(1)}
                            </span>
                          )}
                          {course.lastUpdated && (
                            <span>Updated {course.lastUpdated}</span>
                          )}
                        </div>

                        {/* Title */}
                        <h3 className="font-headline font-bold text-sm text-on-surface leading-tight line-clamp-2 hover:text-primary transition-colors cursor-pointer" onClick={() => handleOpenCourse(course)}>
                          {course.title}
                        </h3>

                        {/* Instructor & Language & Duration */}
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-outline-variant py-1">
                          <div className="flex items-center gap-1">
                            <Languages className="w-3.5 h-3.5" />
                            <span className="truncate">{course.language}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            <span className="truncate">{course.duration}</span>
                          </div>
                        </div>

                        {/* Short Description */}
                        <p className="text-xs text-on-surface-variant font-body leading-relaxed line-clamp-3">
                          {course.description}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-2 border-t border-outline-variant/5">
                        <button
                          onClick={() => handleOpenCourse(course)}
                          className="flex-1 py-2.5 bg-primary text-on-primary hover:bg-primary/95 text-xs font-bold rounded-xl shadow-md hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          Open Course
                        </button>
                        <button
                          onClick={() => handleSaveToVault(course)}
                          disabled={savingId === course.id}
                          className={`px-3 py-2.5 rounded-xl text-xs font-bold border flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-30 cursor-pointer ${
                            isSaved 
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-600' 
                              : 'bg-surface border-outline/35 text-on-surface-variant hover:bg-surface-container-high'
                          }`}
                        >
                          {savingId === course.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isSaved ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Award className="w-3.5 h-3.5" />
                          )}
                          {isSaved ? 'Saved' : 'Save to Vault'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
