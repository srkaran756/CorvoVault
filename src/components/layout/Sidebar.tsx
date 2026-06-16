import React, { useState } from 'react';
import { LayoutDashboard, Library, PlusCircle, Settings, Globe, ChevronUp, UserPlus, Palette, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../hooks/useTabs';
import { TabType } from '../../contexts/TabContext';
import ProfileAvatar from '../ProfileAvatar';

export default function Sidebar() {
  const { user, profiles, switchProfile, addProfile } = useAuth();
  const { activeTabId, openTab, sidebarCollapsed, toggleSidebar } = useTabs();

  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const handleAddAccount = () => {
    if (newName.trim()) {
      addProfile({ name: newName.trim(), email: newEmail.trim(), isGuest: false });
      setNewName('');
      setNewEmail('');
      setShowAddForm(false);
      setShowProfileMenu(false);
    }
  };

  // Nav item mapping: ID maps to TabType
  const navItems = [
    { id: 'today', label: 'Today', icon: LayoutDashboard },
    { id: 'vault', label: 'Vault', icon: Library },
    { id: 'clip', label: 'Clip', icon: PlusCircle },
    { id: 'browser', label: 'Browser', icon: Globe },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'customize', label: 'Customize Space', icon: Palette },
  ];

  // Map active Tab IDs to match Nav Items
  const getActiveState = (itemId: string) => {
    if (!activeTabId) return false;
    if (itemId === 'customize') return activeTabId === 'customize';
    if (itemId === 'vault') return activeTabId === 'vault' || activeTabId.startsWith('document-') || activeTabId.startsWith('note-');
    return activeTabId === itemId;
  };

  return (
    <aside 
      className={`h-full border-r border-outline-variant/10 bg-surface-container-low flex flex-col p-3 gap-2 shrink-0 transition-all duration-300 ease-out select-none sidebar-pane z-40 relative ${
        sidebarCollapsed ? 'w-16' : 'w-56'
      }`}
    >

      {/* Nav List */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = getActiveState(item.id);
          
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'customize') {
                  // Customizer opens customizable tab + theme lab
                  openTab('customize', 'Customize Space');
                  window.dispatchEvent(new Event('toggle-theme-lab'));
                } else {
                  openTab(item.id as TabType);
                }
              }}
              className={`w-full flex items-center rounded-lg font-headline font-semibold text-xs tracking-tight transition-all py-2 px-2.5 outline-none relative group ${
                isActive
                  ? 'text-primary bg-primary/5'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {/* Active sidebar left border indicator */}
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-md"></div>
              )}
              
              <Icon className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-105 ${sidebarCollapsed ? 'mx-auto' : 'mr-3'}`} />
              
              {!sidebarCollapsed && (
                <span className="truncate">{item.label}</span>
              )}

              {/* Tooltip for Collapsed Sidebar */}
              {sidebarCollapsed && (
                <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#2a2a2a] text-white text-[10px] rounded-lg font-bold whitespace-nowrap opacity-0 -translate-x-2 scale-95 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 transition-all duration-200 ease-out delay-150 z-50 shadow-2xl before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-3 before:border-[6px] before:border-transparent before:border-r-[#2a2a2a]">
                  {item.label}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      <button
        onClick={toggleSidebar}
        className="w-full flex items-center justify-center py-1.5 hover:bg-surface-container-high rounded-lg text-outline-variant hover:text-primary transition-colors mb-2 shrink-0 outline-none group relative"
      >
        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        {/* Tooltip for Collapse Sidebar */}
        <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#2a2a2a] text-white text-[10px] rounded-lg font-bold whitespace-nowrap opacity-0 -translate-x-2 scale-95 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 transition-all duration-200 ease-out delay-150 z-50 shadow-2xl before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-3 before:border-[6px] before:border-transparent before:border-r-[#2a2a2a]">
          {sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        </div>
      </button>

      {/* Bottom Profile Section */}
      <div className="space-y-1.5 mt-auto relative shrink-0">
        <AnimatePresence>
          {showProfileMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={`absolute bottom-full left-0 mb-2 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-2xl overflow-hidden z-50 ${
                sidebarCollapsed ? 'w-44' : 'w-full'
              }`}
            >
              <div className="p-2 space-y-1 max-h-60 overflow-y-auto no-scrollbar">
                <div className="px-2.5 py-1 text-[9px] font-bold text-outline uppercase tracking-wider">Profiles</div>
                {profiles.map(p => (
                  <button 
                    key={p.id}
                    onClick={() => {
                      switchProfile(p.id);
                      setShowProfileMenu(false);
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                      user?.id === p.id 
                        ? 'bg-primary/10 text-primary' 
                        : 'text-on-surface-variant hover:bg-surface-container-low'
                    }`}
                  >
                    <ProfileAvatar photoURL={p.photoURL} name={p.name} size="sm" />
                    <span className="truncate flex-1 text-left">{p.name}</span>
                  </button>
                ))}
                
                <div className="h-px bg-outline-variant/10 my-1" />
                
                {showAddForm ? (
                  <div className="p-1.5 space-y-2">
                    <input
                      className="w-full bg-surface-container-low rounded-lg px-2 py-1 text-[10px] border-none focus:ring-1 focus:ring-primary focus:outline-none"
                      placeholder="Name"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddAccount()}
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <button onClick={() => setShowAddForm(false)} className="flex-1 py-1 bg-surface-container-high rounded text-[9px] font-bold">Cancel</button>
                      <button onClick={handleAddAccount} className="flex-1 py-1 bg-primary text-on-primary rounded text-[9px] font-bold">Create</button>
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-on-surface-variant hover:bg-surface-container-low transition-all"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    New Profile
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button 
          onClick={() => {
            setShowProfileMenu(!showProfileMenu);
            setShowAddForm(false);
          }}
          className={`w-full flex items-center rounded-lg hover:bg-surface-container-low transition-all group outline-none relative ${
            sidebarCollapsed ? 'justify-center p-1' : 'p-2 bg-surface-container-lowest/40'
          }`}
        >
          <ProfileAvatar photoURL={user?.photoURL} name={user?.name} size={sidebarCollapsed ? "sm" : "md"} />
          
          {sidebarCollapsed && (
            <div className="absolute left-full ml-3 px-3 py-1.5 bg-[#2a2a2a] text-white text-[10px] rounded-lg font-bold whitespace-nowrap opacity-0 -translate-x-2 scale-95 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 transition-all duration-200 ease-out delay-150 z-50 shadow-2xl before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:-left-3 before:border-[6px] before:border-transparent before:border-r-[#2a2a2a]">
              Profiles
            </div>
          )}
          
          {!sidebarCollapsed && (
            <div className="overflow-hidden flex-1 text-left ml-2.5 leading-none pr-1">
              <p className="text-[10px] font-black truncate">{user?.name || "Curator"}</p>
              <p className="text-[8px] text-outline font-bold uppercase tracking-wider truncate mt-0.5">Profile</p>
            </div>
          )}
          
          {!sidebarCollapsed && (
            <ChevronUp className={`w-3.5 h-3.5 text-outline transition-transform shrink-0 ${showProfileMenu ? 'rotate-180' : ''}`} />
          )}
        </button>
      </div>
    </aside>
  );
}
