import { useState, useEffect } from 'react';
import { Shield, Key, Database, Globe, Save, CheckCircle2, AlertCircle, User, Cpu, FlaskConical, Download, Trash2, Cloud, Target, Clock, FileJson, FileSpreadsheet, Bolt, ExternalLink, HelpCircle, Loader2, Info, Video, Link as LinkIcon, StickyNote, FileText, Camera, Image, X, ArrowUpCircle, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useUserSettings, useMaterials } from '../hooks/useLocalData';
import { useAuth } from '../contexts/AuthContext';
import { ipcService } from '../services/ipcService';
import ProfileAvatar from './ProfileAvatar';

export default function Settings() {
  const { user, updateProfile } = useAuth();
  const { settings, updateSettings } = useUserSettings();
  const { materials, reload, restoreMaterial, permanentlyDeleteMaterial } = useMaterials(undefined, true);
  const [localSettings, setLocalSettings] = useState({
    openaiKey: '',
    anthropicKey: '',
    geminiKey: '',
    openrouterKey: '',
    selectedModel: 'gemini' as 'openai' | 'anthropic' | 'gemini' | 'openrouter',
    googleDriveConfig: {
      rootFolderId: '',
      clientId: '',
      clientSecret: '',
      refreshToken: ''
    },
    supabaseConfig: {
      url: '',
      key: ''
    },
    studyTargetMinutes: 240,
    focusTimeMinutes: 25,
    trashRetentionDays: 30
  });
  const [localProfile, setLocalProfile] = useState({
    name: '',
    email: '',
    description: '',
    photoURL: ''
  });
  const [saving, setSaving] = useState(false);
  const [exportSaving, setExportSaving] = useState(false);
  const [trashSaving, setTrashSaving] = useState<string | null>(null); // Store ID of item being restored/deleted
  const [emptyTrashSaving, setEmptyTrashSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [trashMessage, setTrashMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [testingOpenAI, setTestingOpenAI] = useState(false);
  const [testingAnthropic, setTestingAnthropic] = useState(false);

  // Auto-updater state
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'ready' | 'error'>('idle');
  const [updateInfo, setUpdateInfo]  = useState<{ version?: string; percent?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.on) return;
    const off1 = window.electronAPI.on('updater:update-available',    (info: any) => { setUpdateStatus('available'); setUpdateInfo({ version: info?.version }); });
    const off2 = window.electronAPI.on('updater:up-to-date',          ()          => { setUpdateStatus('up-to-date'); setUpdateInfo(null); });
    const off3 = window.electronAPI.on('updater:download-progress',   (p: any)    => { setUpdateStatus('downloading'); setUpdateInfo({ percent: Math.round(p?.percent ?? 0) }); });
    const off4 = window.electronAPI.on('updater:update-downloaded',   (info: any) => { setUpdateStatus('ready'); setUpdateInfo({ version: info?.version }); });
    const off5 = window.electronAPI.on('updater:error',               (msg: any)  => { setUpdateStatus('error'); setUpdateInfo({ error: String(msg) }); });
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, []);

  const handlePhotoUpload = async () => {
    if (!window.electronAPI) {
      alert("Photo upload is only available in the desktop app.");
      return;
    }

    const { canceled, filePaths } = await window.electronAPI.openFileDialog({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    });

    if (!canceled && filePaths.length > 0) {
      try {
        const { localPath } = await window.electronAPI.copyFileToLocal(filePaths[0]);
        setLocalProfile({ ...localProfile, photoURL: localPath });
      } catch (err) {
        console.error("Failed to copy photo", err);
        setMessage({ type: 'error', text: 'Failed to upload photo.' });
      }
    }
  };

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        openaiKey: settings.openaiKey || '',
        anthropicKey: settings.anthropicKey || '',
        geminiKey: settings.geminiKey || '',
        openrouterKey: settings.openrouterKey || '',
        selectedModel: settings.selectedModel || 'gemini',
        googleDriveConfig: {
          rootFolderId: settings.googleDriveConfig?.rootFolderId || '',
          clientId: settings.googleDriveConfig?.clientId || '',
          clientSecret: settings.googleDriveConfig?.clientSecret || '',
          refreshToken: settings.googleDriveConfig?.refreshToken || ''
        },
        supabaseConfig: {
          url: settings.supabaseConfig?.url || '',
          key: settings.supabaseConfig?.key || ''
        },
        studyTargetMinutes: settings.studyTargetMinutes || 240,
        focusTimeMinutes: settings.focusTimeMinutes || 25,
        trashRetentionDays: settings.trashRetentionDays ?? 30
      });
    }
    if (user) {
      setLocalProfile({
        name: user.name || '',
        email: user.email || '',
        description: user.description || '',
        photoURL: user.photoURL || ''
      });
    }
  }, [settings, user]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      updateSettings(localSettings);
      if (user) {
        updateProfile({ ...user, ...localProfile });
      }
      setMessage({ type: 'success', text: 'All settings saved successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handlePurge = async () => {
    if (!user) return;
    if (confirm("Are you absolutely sure? This will delete ALL data and downloaded files for your CURRENT profile.")) {
      if (window.electronAPI?.invoke) {
        await window.electronAPI.invoke('vault:purgeProfile', user.id);
      }
      window.location.reload();
    }
  };

  const testSupabase = async () => {
    if (!localSettings.supabaseConfig.url || !localSettings.supabaseConfig.key) {
      setMessage({ type: 'error', text: 'Please enter Supabase URL and API Key first.' });
      return;
    }
    setTestingSupabase(true);
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(localSettings.supabaseConfig.url, localSettings.supabaseConfig.key);
      // Simple health check
      const { error } = await client.from('_test_connection').select('*').limit(1);
      // Even if table doesn't exist, if we don't get an auth error, connection works
      if (error && error.message.includes('Invalid API key')) {
        throw new Error('Invalid API key');
      }
      setMessage({ type: 'success', text: 'Supabase connection successful!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: `Supabase test failed: ${err.message}` });
    } finally {
      setTestingSupabase(false);
    }
  };

  const testGemini = async () => {
    const key = localSettings.geminiKey;
    if (!key) {
      setMessage({ type: 'error', text: 'Please enter a Gemini API key first.' });
      return;
    }
    setTestingGemini(true);
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: key });
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: 'Hello, respond with just "OK" to confirm connection.',
      });
      if (response.text) {
        setMessage({ type: 'success', text: 'Gemini API connection successful!' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `Gemini test failed: ${err.message}` });
    } finally {
      setTestingGemini(false);
    }
  };

  const testOpenRouter = async () => {
    const key = localSettings.openrouterKey;
    if (!key) {
      setMessage({ type: 'error', text: 'Please enter an OpenRouter API key first.' });
      return;
    }
    setTestingOpenRouter(true);
    try {
      const { generateAIResponse } = await import('../lib/ai');
      const response = await generateAIResponse({
        provider: 'openrouter',
        openrouterKey: key
      }, {
        prompt: 'Hello, respond with just "OK" to confirm connection.',
      });
      if (response) {
        setMessage({ type: 'success', text: 'OpenRouter connection successful!' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `OpenRouter test failed: ${err.message}` });
    } finally {
      setTestingOpenRouter(false);
    }
  };

  const testOpenAI = async () => {
    const key = localSettings.openaiKey;
    if (!key) {
      setMessage({ type: 'error', text: 'Please enter an OpenAI API key first.' });
      return;
    }
    setTestingOpenAI(true);
    try {
      const { generateAIResponse } = await import('../lib/ai');
      const response = await generateAIResponse({
        provider: 'openai',
        openaiKey: key
      }, {
        prompt: 'Hello, respond with just "OK" to confirm connection.',
      });
      if (response) {
        setMessage({ type: 'success', text: 'OpenAI connection successful!' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `OpenAI test failed: ${err.message}` });
    } finally {
      setTestingOpenAI(false);
    }
  };

  const testAnthropic = async () => {
    const key = localSettings.anthropicKey;
    if (!key) {
      setMessage({ type: 'error', text: 'Please enter an Anthropic API key first.' });
      return;
    }
    setTestingAnthropic(true);
    try {
      const { generateAIResponse } = await import('../lib/ai');
      const response = await generateAIResponse({
        provider: 'anthropic',
        anthropicKey: key
      }, {
        prompt: 'Hello, respond with just "OK" to confirm connection.',
      });
      if (response) {
        setMessage({ type: 'success', text: 'Anthropic connection successful!' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `Anthropic test failed: ${err.message}` });
    } finally {
      setTestingAnthropic(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Title', 'URL', 'Type', 'Created At'];
    const rows = materials.map(m => [m.title, m.url, m.boxType, m.createdAt]);
    const csvContent = [headers, ...rows].map(e => e.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "study_in_center_export.csv";
    link.click();
  };

  const exportJSON = async () => {
    if (!user) return;
    if (window.electronAPI?.invoke) {
      const dataObj = await window.electronAPI.invoke('vault:exportJSON', user.id);
      const data = JSON.stringify(dataObj, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `corvovault-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
    }
  };

  // --- Vault Section Handlers ---
  const [pinEnabled, setPinEnabled] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [integrityResults, setIntegrityResults] = useState<{ok: number, corrupted: number, missing: number} | null>(null);

  // Load pin state async from userData/pin_config.json via IPC
  useEffect(() => {
    if (!window.electronAPI) return;
    ipcService.pin.get().then(config => {
      setPinEnabled(!!(config?.enabled));
    }).catch(() => {
      setPinEnabled(false);
    });
  }, []);

  const trashCount = materials.filter(m => m.storageStatus === 'trashed').length;

  const handleExportVaultZip = async () => {
    if (!window.electronAPI?.isElectron) {
      alert('Vault export is only available in the desktop app.');
      return;
    }

    const { filePath } = await window.electronAPI.showSaveDialog({
      defaultPath: `CorvoVault_backup_${Date.now()}.zip`,
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
    });
    if (!filePath) return;

    if (!user) return;

    setMessage(null);
    setExportSaving(true);
    
    try {
      const fileMaterials = materials.filter(
        m => m.boxType === 'file' && m.localPath && m.storageStatus !== 'trashed' && m.storageStatus !== 'missing'
      );

      const files = fileMaterials.map(m => ({
        localPath: m.localPath!,
        archiveName: `${m.id}_${m.localPath!.split(/[\\/]/).pop()}`, 
      }));

      const manifest = {
        exportedAt: new Date().toISOString(),
        profileId: user.id,
        materials: fileMaterials.map(m => ({
          id: m.id,
          title: m.title,
          localPath: m.localPath,
          fileSizeBytes: m.fileSizeBytes,
          fileHash: m.fileHash,
          archiveName: files.find(f => f.localPath === m.localPath)?.archiveName,
          topicId: m.topicId,
          folderId: m.folderId,
          createdAt: m.createdAt,
        })),
      };

      const result = await window.electronAPI.exportZip(
        filePath,
        files,
        JSON.stringify(manifest, null, 2)
      );

      if (result.success) {
        setMessage({ type: 'success', text: `Vault exported successfully to ${filePath}` });
      } else {
        setMessage({ type: 'error', text: `Export failed: ${result.error}` });
      }
    } catch (err: any) {
        setMessage({ type: 'error', text: `Export failed: ${err.message}` });
    } finally {
      setExportSaving(false);
    }
  };

  const handleEmptyTrash = async () => {
    if (!user) return;
    if (confirm(`Permanently delete all ${trashCount} items in the trash for this profile? This cannot be undone.`)) {
      try {
        const trashedItems = materials.filter(m => m.storageStatus === 'trashed');
        for (const item of trashedItems) {
          await permanentlyDeleteMaterial(item.id);
        }
        setMessage({ type: 'success', text: 'Trash emptied for current profile.' });
      } catch (err) {
        setMessage({ type: 'error', text: 'Failed to empty trash.' });
      } finally {
        reload();
      }
    }
  };

  const runIntegrityCheck = async () => {
    if (!window.electronAPI?.isElectron) return;
    if (!user) return;
    setCheckingIntegrity(true);
    setIntegrityResults(null);

    try {
      const results = await window.electronAPI.invoke('vault:runIntegrityCheck', user.id);
      setIntegrityResults(results);
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const setupPin = async () => {
     if (pinEnabled) {
         if (confirm("Are you sure you want to disable the launch PIN?")) {
             await ipcService.pin.set(null);
             setPinEnabled(false);
             setNewPin('');
             setMessage({ type: 'success', text: 'PIN disabled.'});
         }
         return;
     }

    if (!newPin || newPin.length < 4) {
      setMessage({ type: 'error', text: 'PIN must be at least 4 characters.'});
      return;
    }

    try {
      await ipcService.pin.set(newPin);

      setPinEnabled(true);
      setNewPin('');
      setMessage({ type: 'success', text: 'Launch PIN enabled!'});
    } catch (err) {
        setMessage({ type: 'error', text: 'Failed to set PIN.'});
    }
  };

  return (
    <div className="p-10 max-w-6xl mx-auto space-y-10 pb-24">
      <section className="space-y-2">
        <h1 className="text-4xl font-extrabold font-headline text-primary tracking-tight">Settings</h1>
        <p className="text-on-surface-variant font-body">Configure your sanctuary, API keys, and study preferences.</p>
      </section>

      {message && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="text-sm font-bold">{message.text}</span>
        </motion.div>
      )}

      {/* Setup Guide Banner */}
      {!localSettings.geminiKey && !localSettings.supabaseConfig.url && (
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 flex gap-4 items-start">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Info className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-2">
            <h3 className="font-bold text-primary">Quick Setup Guide</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              To get started, you'll need to configure at least one AI provider. Here's what to do:
            </p>
            <ol className="text-sm text-on-surface-variant space-y-1 list-decimal list-inside">
              <li><strong>Gemini API Key</strong> — Get free at <span className="text-primary font-bold">aistudio.google.com</span></li>
              <li><strong>Supabase</strong> (optional) — Free account at <span className="text-primary font-bold">supabase.com</span> for cloud sync</li>
              <li><strong>Google Drive</strong> (optional) — Set up OAuth in Google Cloud Console for file backup</li>
            </ol>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          {/* Profile Section */}
          <section className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10">
            <div className="flex items-center gap-3 mb-8">
              <User className="text-primary w-6 h-6" />
              <h3 className="text-xl font-bold font-headline">Profile</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Username</label>
                <input 
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none" 
                  type="text" 
                  value={localProfile.name}
                  onChange={(e) => setLocalProfile({ ...localProfile, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Email</label>
                <input 
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none" 
                  type="email" 
                  value={localProfile.email}
                  onChange={(e) => setLocalProfile({ ...localProfile, email: e.target.value })}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Bio</label>
                <textarea 
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none h-20 resize-none" 
                  value={localProfile.description}
                  onChange={(e) => setLocalProfile({ ...localProfile, description: e.target.value })}
                />
              </div>
              <div className="md:col-span-2 space-y-4">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">Profile Picture</label>
                <div className="flex items-center gap-6 p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full overflow-hidden bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0">
                      <ProfileAvatar photoURL={localProfile.photoURL} name={localProfile.name} size="xl" />
                    </div>
                  </div>
                  
                  <div className="space-y-3 flex-1">
                    <p className="text-sm font-bold text-on-surface">Upload a custom profile photo</p>
                    <p className="text-[11px] text-outline leading-tight">Recommended: Square image, max 2MB. Stored locally in your vault.</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={handlePhotoUpload}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold hover:bg-primary/90 transition-all"
                      >
                        <Camera className="w-4 h-4" />
                        Upload from device
                      </button>
                      {localProfile.photoURL && (
                        <button 
                          onClick={() => setLocalProfile({ ...localProfile, photoURL: '' })}
                          className="flex items-center gap-2 px-4 py-2 bg-surface-container-high text-on-surface-variant rounded-lg text-xs font-bold hover:bg-red-50 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Study Targets */}
          <section className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10">
            <div className="flex items-center gap-3 mb-8">
              <Target className="text-primary w-6 h-6" />
              <h3 className="text-xl font-bold font-headline">Study Targets</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1 flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Daily Target (Minutes)
                </label>
                <input 
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none" 
                  type="number" 
                  value={localSettings.studyTargetMinutes}
                  onChange={(e) => setLocalSettings({ ...localSettings, studyTargetMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1 flex items-center gap-2">
                  <Bolt className="w-3 h-3" />
                  Focus Session (Minutes)
                </label>
                <input 
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none" 
                  type="number" 
                  value={localSettings.focusTimeMinutes}
                  onChange={(e) => setLocalSettings({ ...localSettings, focusTimeMinutes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-on-surface-variant uppercase tracking-widest ml-1 flex items-center gap-2">
                  <Trash2 className="w-3 h-3" />
                  Trash Retention
                </label>
                <select
                  id="trash-retention-days"
                  className="w-full bg-surface-container-low border border-outline/30 focus:border-primary rounded-xl p-4 text-on-surface focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  value={localSettings.trashRetentionDays ?? 30}
                  onChange={(e) => setLocalSettings({ ...localSettings, trashRetentionDays: parseInt(e.target.value) })}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days (default)</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
                <p className="text-[13px] text-outline ml-1">Trashed items are permanently removed from disk and database on next app launch after this period.</p>
              </div>
            </div>
          </section>

          {/* Intelligence Core */}
          <section className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <Cpu className="text-primary w-6 h-6" />
                <h3 className="text-xl font-bold font-headline">AI Provider</h3>
              </div>
              <select 
                value={localSettings.selectedModel}
                onChange={(e) => setLocalSettings({ ...localSettings, selectedModel: e.target.value as any })}
                className="bg-surface-container-high border-none rounded-lg px-4 py-2 text-xs font-bold text-primary focus:ring-2 focus:ring-primary focus:outline-none"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI GPT-4</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>
            <div className="space-y-4">
              <div className={`p-5 bg-surface-container-low border border-outline/15 rounded-xl border-l-4 ${localSettings.selectedModel === 'gemini' ? 'border-primary' : 'border-transparent opacity-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-on-surface">Google Gemini</h4>
                  <button 
                    onClick={testGemini}
                    disabled={testingGemini || !localSettings.geminiKey}
                    className="text-[13px] font-bold text-primary hover:underline disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  >
                    {testingGemini ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Test Connection
                  </button>
                </div>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-sm font-mono focus:ring-1 focus:ring-primary/30 focus:outline-none" 
                  type="password" 
                  placeholder="Enter Gemini API Key"
                  value={localSettings.geminiKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, geminiKey: e.target.value })}
                />
              </div>
              <div className={`p-5 bg-surface-container-low border border-outline/15 rounded-xl border-l-4 ${localSettings.selectedModel === 'openrouter' ? 'border-primary' : 'border-transparent opacity-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-on-surface">OpenRouter</h4>
                  <button 
                    onClick={testOpenRouter}
                    disabled={testingOpenRouter || !localSettings.openrouterKey}
                    className="text-[13px] font-bold text-primary hover:underline disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  >
                    {testingOpenRouter ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Test Connection
                  </button>
                </div>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-sm font-mono focus:ring-1 focus:ring-primary/30 focus:outline-none" 
                  type="password" 
                  placeholder="Enter OpenRouter API Key (sk-or-...)"
                  value={localSettings.openrouterKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, openrouterKey: e.target.value })}
                />
              </div>
              <div className={`p-5 bg-surface-container-low border border-outline/15 rounded-xl border-l-4 ${localSettings.selectedModel === 'openai' ? 'border-primary' : 'border-transparent opacity-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-on-surface">OpenAI</h4>
                  <button 
                    onClick={testOpenAI}
                    disabled={testingOpenAI || !localSettings.openaiKey}
                    className="text-[13px] font-bold text-primary hover:underline disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  >
                    {testingOpenAI ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Test Connection
                  </button>
                </div>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-sm font-mono focus:ring-1 focus:ring-primary/30 focus:outline-none" 
                  placeholder="sk-..." 
                  type="password"
                  value={localSettings.openaiKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, openaiKey: e.target.value })}
                />
              </div>
              <div className={`p-5 bg-surface-container-low border border-outline/15 rounded-xl border-l-4 ${localSettings.selectedModel === 'anthropic' ? 'border-primary' : 'border-transparent opacity-50'}`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-on-surface">Anthropic Claude</h4>
                  <button 
                    onClick={testAnthropic}
                    disabled={testingAnthropic || !localSettings.anthropicKey}
                    className="text-[13px] font-bold text-primary hover:underline disabled:opacity-30 flex items-center gap-1 cursor-pointer"
                  >
                    {testingAnthropic ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    Test Connection
                  </button>
                </div>
                <input 
                  className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-sm font-mono focus:ring-1 focus:ring-primary/30 focus:outline-none" 
                  placeholder="Enter API Key" 
                  type="password"
                  value={localSettings.anthropicKey}
                  onChange={(e) => setLocalSettings({ ...localSettings, anthropicKey: e.target.value })}
                />
              </div>
            </div>
          </section>

          {/* Data Export */}
          <section className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10">
            <div className="flex items-center gap-3 mb-8">
              <Download className="text-primary w-6 h-6" />
              <h3 className="text-xl font-bold font-headline">Data Export</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={exportCSV}
                className="flex items-center justify-center gap-3 p-6 bg-surface-container-low rounded-2xl border border-outline-variant/10 hover:bg-surface-container-high transition-all group"
              >
                <FileSpreadsheet className="w-8 h-8 text-green-600 group-hover:scale-110 transition-transform" />
                <div className="text-left">
                  <p className="text-sm font-bold">Export CSV</p>
                  <p className="text-[10px] text-outline">Materials list</p>
                </div>
              </button>
              <button 
                onClick={exportJSON}
                className="flex items-center justify-center gap-3 p-6 bg-surface-container-low rounded-2xl border border-outline-variant/10 hover:bg-surface-container-high transition-all group"
              >
                <FileJson className="w-8 h-8 text-amber-600 group-hover:scale-110 transition-transform" />
                <div className="text-left">
                  <p className="text-sm font-bold">Export Full Backup (JSON)</p>
                  <p className="text-[10px] text-outline">All data & settings</p>
                </div>
              </button>
            </div>
          </section>

          {/* Vault */}
          <section className="bg-surface-container-lowest rounded-xl p-8 border border-outline-variant/10">
            <div className="flex items-center gap-3 mb-8">
              <Shield className="text-primary w-6 h-6" />
              <h3 className="text-xl font-bold font-headline">Vault</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <button 
                  onClick={handleExportVaultZip}
                  disabled={exportSaving}
                  className="w-full bg-surface-container-low border border-outline-variant/20 hover:bg-surface-container-high text-on-surface py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                   <Download className="w-4 h-4" />
                   {exportSaving ? 'Exporting...' : 'Export vault backup (.zip)'}
                </button>
                <div className="space-y-2">
                   <button 
                    onClick={runIntegrityCheck}
                    disabled={checkingIntegrity}
                    className="w-full bg-surface-container-low border border-outline-variant/20 hover:bg-surface-container-high text-on-surface py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {checkingIntegrity ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                    Check file integrity
                  </button>
                  {integrityResults && (
                      <p className="text-xs text-center text-on-surface-variant bg-surface-container-high py-2 rounded-lg">
                          {integrityResults.ok} files OK, {integrityResults.missing} missing, {integrityResults.corrupted} corrupted.
                      </p>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                 <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 flex flex-col h-full">
                    <div className="flex items-center justify-between mb-3">
                         <p className="text-xs font-bold text-red-600">
                              Trash: {trashCount} items
                         </p>
                         <button 
                             onClick={async () => {
                                 setEmptyTrashSaving(true);
                                 await handleEmptyTrash();
                                 setEmptyTrashSaving(false);
                             }}
                             disabled={trashCount === 0 || emptyTrashSaving || trashSaving !== null}
                             className="text-[10px] font-black uppercase text-red-600 hover:underline disabled:opacity-30"
                         >
                              {emptyTrashSaving ? 'Emptying...' : 'Empty Trash'}
                         </button>
                    </div>

                    {trashMessage && (
                        <div className={`p-2 mb-2 rounded border text-xs font-bold leading-tight ${trashMessage.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                            {trashMessage.text}
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto min-h-[140px] max-h-[140px] space-y-2 pr-1 no-scrollbar">
                        {materials.filter(m => m.storageStatus === 'trashed').length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 py-4">
                                <Trash2 className="w-8 h-8 mb-1" />
                                <p className="text-[10px] font-bold">Trash is empty</p>
                            </div>
                        ) : (
                            materials.filter(m => m.storageStatus === 'trashed').map(item => {
                                const Icon = item.boxType === 'youtube' ? Video : item.boxType === 'link' ? LinkIcon : item.boxType === 'note' ? StickyNote : FileText;
                                return (
                                    <div key={item.id} className="flex items-center gap-3 p-2 bg-surface-container-lowest border border-red-500/10 rounded-lg group">
                                        <Icon className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold truncate text-on-surface">{item.title}</p>
                                            <p className="text-[8px] text-outline">{new Date(item.trashedAt || '').toLocaleDateString()}</p>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                onClick={async () => {
                                                    setTrashMessage(null);
                                                    setTrashSaving(item.id);
                                                    const result = await restoreMaterial(item.id);
                                                    
                                                    if (result && !result.success) {
                                                        setTrashMessage({ type: 'error', text: result.error || 'Restoration failed.' });
                                                    } else {
                                                        setTrashMessage({ type: 'success', text: 'Material restored.' });
                                                    }
                                                    
                                                    // Small delay to allow state and animations to settle
                                                    setTimeout(() => setTrashSaving(null), 100);
                                                }}
                                                disabled={trashSaving !== null}
                                                className="p-1 px-2 bg-primary/10 text-primary border border-primary/20 rounded text-[9px] font-bold hover:bg-primary hover:text-white transition-all disabled:opacity-50"
                                                title="Restore"
                                            >
                                                Restore
                                            </button>
                                            <button 
                                                onClick={async () => { 
                                                    if(confirm('Permanently delete this item?')) {
                                                        setTrashMessage(null);
                                                        setTrashSaving(item.id);
                                                        await permanentlyDeleteMaterial(item.id);
                                                        setTrashSaving(null);
                                                    }
                                                }}
                                                disabled={trashSaving !== null}
                                                className="p-1 px-2 bg-red-100 text-red-600 border border-red-200 rounded text-[9px] font-bold hover:bg-red-600 hover:text-white transition-all disabled:opacity-50"
                                                title="Delete Permanently"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                 </div>
                 <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                           <h4 className="font-bold text-sm flex items-center gap-2">
                               <Key className="w-4 h-4 text-primary" />
                               App Launch PIN
                           </h4>
                           {pinEnabled && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase">Enabled</span>}
                      </div>
                      <div className="flex gap-2">
                           <input 
                               type="password"
                               placeholder={pinEnabled ? "PIN active" : "Enter new 4+ digit PIN"}
                               disabled={pinEnabled}
                               value={newPin}
                               onChange={e => setNewPin(e.target.value)}
                               className="flex-1 bg-surface-container-lowest border border-outline/25 rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-primary/30 focus:outline-none disabled:opacity-50 text-on-surface"
                           />
                           <button
                               onClick={setupPin}
                               className={`px-4 py-2.5 rounded-lg text-xs font-bold text-white transition-all cursor-pointer ${pinEnabled ? 'bg-red-500 hover:bg-red-600' : 'bg-primary hover:bg-primary/90'}`}
                           >
                               {pinEnabled ? 'Disable' : 'Set PIN'}
                           </button>
                      </div>
                 </div>
              </div>
            </div>
          </section>
        </div>

        <div className="lg:col-span-4 space-y-8">
          {/* Supabase Config */}
          <section className="bg-surface-container-high rounded-xl p-6 border border-outline-variant/10">
            <h3 className="text-[13px] font-bold font-headline uppercase tracking-widest mb-4 flex items-center gap-2 text-on-surface">
              <FlaskConical className="w-4 h-4 text-primary" />
              Supabase (Cloud Sync)
            </h3>
            <div className="space-y-2">
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Supabase Project URL" 
                type="text"
                value={localSettings.supabaseConfig.url}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  supabaseConfig: { ...localSettings.supabaseConfig, url: e.target.value } 
                })}
              />
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Supabase Anon Key" 
                type="password"
                value={localSettings.supabaseConfig.key}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  supabaseConfig: { ...localSettings.supabaseConfig, key: e.target.value } 
                })}
              />
              <button 
                onClick={testSupabase}
                disabled={testingSupabase}
                className="w-full py-2.5 bg-surface-container-lowest border border-outline-variant/20 rounded-lg text-[13px] font-bold text-primary flex items-center justify-center gap-2 hover:bg-surface-container-low transition-all disabled:opacity-30 cursor-pointer"
              >
                {testingSupabase ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                Test Connection
              </button>
            </div>
          </section>

          {/* Google Drive Config */}
          <section className="bg-surface-container-high rounded-xl p-6 border border-outline-variant/10">
            <h3 className="text-[13px] font-bold font-headline uppercase tracking-widest mb-4 flex items-center gap-2 text-on-surface">
              <Cloud className="w-4 h-4 text-primary" />
              Google Drive (File Backup)
            </h3>
            <div className="space-y-2">
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Root Folder ID" 
                type="text"
                value={localSettings.googleDriveConfig.rootFolderId}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  googleDriveConfig: { ...localSettings.googleDriveConfig, rootFolderId: e.target.value } 
                })}
              />
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Client ID" 
                type="text"
                value={localSettings.googleDriveConfig.clientId}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  googleDriveConfig: { ...localSettings.googleDriveConfig, clientId: e.target.value } 
                })}
              />
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Client Secret" 
                type="password"
                value={localSettings.googleDriveConfig.clientSecret}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  googleDriveConfig: { ...localSettings.googleDriveConfig, clientSecret: e.target.value } 
                })}
              />
              <input 
                className="w-full bg-surface-container-lowest border border-outline/25 rounded-lg p-3 text-xs focus:ring-1 focus:ring-primary/30 focus:outline-none text-on-surface" 
                placeholder="Refresh Token" 
                type="password"
                value={localSettings.googleDriveConfig.refreshToken}
                onChange={(e) => setLocalSettings({ 
                  ...localSettings, 
                  googleDriveConfig: { ...localSettings.googleDriveConfig, refreshToken: e.target.value } 
                })}
              />
            </div>
          </section>

          {/* Actions */}
          <section className="bg-surface-container-high rounded-xl p-6 space-y-3">
            <button 
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Saving...' : 'Save All Settings'}
            </button>
            <button 
              onClick={handlePurge}
              className="w-full bg-red-500/10 text-red-500 py-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Clear Current Profile Data
            </button>
          </section>

          {/* Software Updates — only shown in Electron */}
          {window.electronAPI && (
            <section className="bg-surface-container-high rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpCircle className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-bold font-headline">Software Updates</h3>
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-3">
                {updateStatus === 'idle'        && <span className="text-xs text-on-surface-variant">No check run yet this session.</span>}
                {updateStatus === 'checking'    && <span className="flex items-center gap-2 text-xs text-on-surface-variant"><Loader2 className="w-3 h-3 animate-spin" />Checking for updates…</span>}
                {updateStatus === 'up-to-date'  && <span className="flex items-center gap-2 text-xs text-green-500"><CheckCircle2 className="w-3.5 h-3.5" />You're on the latest version.</span>}
                {updateStatus === 'available'   && <span className="flex items-center gap-2 text-xs text-primary"><ArrowUpCircle className="w-3.5 h-3.5" />Update v{updateInfo?.version} available.</span>}
                {updateStatus === 'downloading' && <span className="flex items-center gap-2 text-xs text-primary"><Loader2 className="w-3 h-3 animate-spin" />Downloading… {updateInfo?.percent ?? 0}%</span>}
                {updateStatus === 'ready'       && <span className="flex items-center gap-2 text-xs text-green-500"><CheckCircle2 className="w-3.5 h-3.5" />v{updateInfo?.version} ready — restart to apply.</span>}
                {updateStatus === 'error'       && <span className="flex items-center gap-2 text-xs text-red-500"><AlertCircle className="w-3.5 h-3.5" />{updateInfo?.error ?? 'Update check failed.'}</span>}
              </div>

              {/* Progress bar (download phase only) */}
              {updateStatus === 'downloading' && (
                <div className="w-full bg-surface-container-low rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${updateInfo?.percent ?? 0}%` }}
                  />
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                {/* Check / re-check */}
                {updateStatus !== 'downloading' && updateStatus !== 'ready' && (
                  <button
                    id="check-updates-btn"
                    onClick={() => { setUpdateStatus('checking'); window.electronAPI?.checkForUpdates?.(); }}
                    className="flex items-center gap-2 bg-primary/10 text-primary py-2 px-4 rounded-xl text-xs font-bold hover:bg-primary/20 transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Check for Updates
                  </button>
                )}

                {/* Download */}
                {updateStatus === 'available' && (
                  <button
                    id="download-update-btn"
                    onClick={() => { setUpdateStatus('downloading'); setUpdateInfo(prev => ({ ...prev, percent: 0 })); window.electronAPI?.downloadUpdate?.(); }}
                    className="flex items-center gap-2 bg-primary text-on-primary py-2 px-4 rounded-xl text-xs font-bold hover:opacity-90 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Update
                  </button>
                )}

                {/* Restart & install */}
                {updateStatus === 'ready' && (
                  <button
                    id="install-update-btn"
                    onClick={() => window.electronAPI?.quitAndInstall?.()}
                    className="flex items-center gap-2 bg-green-600 text-white py-2 px-4 rounded-xl text-xs font-bold hover:opacity-90 transition-all"
                  >
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                    Restart & Install
                  </button>
                )}
              </div>
            </section>
          )}

          {/* About */}
          <section className="bg-surface-container-high rounded-xl p-6">
            <h3 className="text-[10px] font-bold font-headline uppercase tracking-widest mb-3">About</h3>
            <div className="space-y-2 text-xs text-on-surface-variant">
              <p><span className="font-bold text-on-surface">CorvoVault</span> v1.0.0</p>
              <p>Open-source study sanctuary.</p>
              <p className="text-[10px]">Apache-2.0 License</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
