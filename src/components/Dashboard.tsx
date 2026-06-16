import { useState, useEffect, useCallback } from 'react';
import { Bolt, ArrowRight, Brain, Film, Landmark, History, FileText, Mic, Link as LinkIcon, CheckCircle, ShoppingBag, BarChart3, Clock, Target } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { ipcService } from '../services/ipcService';

import { useUserStats, useMaterialCounts, useUserSettings } from '../hooks/useLocalData';
import { Screen } from '../types';
import { ephemeral } from '../lib/ephemeral';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const iconMap: any = {
  Brain, Film, Landmark, History, FileText, Mic, LinkIcon, CheckCircle
};

export default function Dashboard({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const { user } = useAuth();
  const { stats, updateStats } = useUserStats();
  const counts = useMaterialCounts();
  const { settings } = useUserSettings();

  // Focus session timer state
  const [focusSessionActive, setFocusSessionActive] = useState(false);
  const [focusTimeRemaining, setFocusTimeRemaining] = useState(0);
  const [focusSessionMinutes, setFocusSessionMinutes] = useState(0);

  const handleFocusSession = useCallback(() => {
    // Do not start a new session if one is already running
    if (focusSessionActive) return;

    const focusMinutes = settings?.focusTimeMinutes || 25;

    setFocusSessionMinutes(focusMinutes);
    setFocusTimeRemaining(focusMinutes * 60);
    setFocusSessionActive(true);

    // Notify user that session STARTED — not completed
    if (user) {
      ephemeral.addNotification(user.id, {
        title: 'Focus Started',
        message: `A ${focusMinutes} minute focus session has started. Stay focused!`,
        type: 'info',
      });
    }
  }, [focusSessionActive, settings, user]);

  const handleFocusSessionComplete = useCallback(async (completedMinutes: number) => {
    if (!stats) return;

    // Only NOW do we add real minutes — after the timer actually finished
    await updateStats({
      studyTimeMinutes: stats.studyTimeMinutes + completedMinutes,
      focusSessionsCompleted: ((stats as any).focusSessionsCompleted || 0) + 1,
    } as any);

    // Log the completed activity safely to prevent runtime type errors
    if ((ipcService.analytics as any).logActivity) {
      await (ipcService.analytics as any).logActivity(
        user?.id || '',
        'focus_session_completed',
      );
    }

    // Notify user that session COMPLETED
    if (user) {
      ephemeral.addActivity(user.id, {
        title: `Completed ${completedMinutes}m focus session`,
        type: 'complete',
        icon: 'Bolt',
        colorClass: 'bg-primary-container',
      });
      ephemeral.addNotification(user.id, {
        title: 'Focus Complete',
        message: `Great job! You completed a ${completedMinutes} minute focus session.`,
        type: 'success',
      });
    }
  }, [stats, updateStats, user]);

  // Countdown timer for focus sessions
  useEffect(() => {
    if (!focusSessionActive) return;

    const tick = setInterval(() => {
      setFocusTimeRemaining(prev => {
        if (prev <= 1) {
          // Timer finished — credit the real minutes NOW
          clearInterval(tick);
          setFocusSessionActive(false);
          handleFocusSessionComplete(focusSessionMinutes);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [focusSessionActive, focusSessionMinutes, handleFocusSessionComplete]);


  const handleJumpBack = () => {
    if (stats?.lastFolderId) {
      onNavigate('library');
    } else {
      onNavigate('capture');
    }
  };

  // Get real activities from storage
  const recentActivities = user ? ephemeral.getActivities(user.id).slice(0, 6) : [];

  const formatTime = (minutes: number) => {
    const totalSeconds = Math.round(minutes * 60);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const parts = [];
    if (hrs > 0) parts.push(`${hrs}h`);
    if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
  };

  const wellbeingData = stats?.wellbeingData?.map(d => ({
    name: d.title,
    value: d.minutes,
    color: d.color
  })) || [
    { name: 'YouTube', value: 0, color: '#ef4444' },
    { name: 'Documents', value: 0, color: '#22c55e' },
    { name: 'Web Browser', value: 0, color: '#3b82f6' },
    { name: 'Notes', value: 0, color: '#f59e0b' },
  ];

  const totalMinutes = wellbeingData.reduce((acc, curr) => acc + curr.value, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-10 py-8 px-6">
      {/* Welcome Section */}
      <section className="flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1 space-y-4">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl font-extrabold font-headline tracking-tight text-primary"
          >
            Welcome back, {user?.name?.split(' ')[0] || 'Curator'}
          </motion.h2>
          <p className="text-on-surface-variant text-lg leading-relaxed max-w-xl">
            <span className="font-bold text-primary">{counts.total}</span> pieces saved
            {(() => { const linked = 0; return null; })()}
            {totalMinutes > 0 && <> · <span className="font-bold text-primary">{formatTime(totalMinutes)}</span> clocked</>}
          </p>
          <div className="flex gap-3 pt-2">
            {focusSessionActive ? (
              <button 
                disabled 
                className="build-sprint-btn px-6 py-2.5 flex items-center gap-2 shadow-lg hover:opacity-90 active:scale-95 font-semibold"
              >
                <Bolt className="w-5 h-5 fill-on-primary" />
                {Math.floor(focusTimeRemaining / 60)}:{String(focusTimeRemaining % 60).padStart(2, '0')} remaining
              </button>
            ) : (
              <button 
                onClick={handleFocusSession}
                className="build-sprint-btn px-6 py-2.5 flex items-center gap-2 shadow-lg hover:opacity-90 active:scale-95"
              >
                <Bolt className="w-5 h-5 fill-on-primary" />
                Build Sprint {settings?.focusTimeMinutes || 25}m
              </button>
            )}

            <button 
              onClick={() => onNavigate('browser')}
              className="bg-surface-container-high text-primary px-6 py-2.5 rounded-full font-semibold flex items-center gap-2 transition-all hover:bg-surface-container-highest active:scale-95"
            >
              <LinkIcon className="w-5 h-5" />
              Open Workbench
            </button>
          </div>
        </div>

        {/* Resume Activity Card */}
        <motion.div 
          whileHover={{ y: -4 }}
          onClick={handleJumpBack}
          className="w-full md:w-80 stage-card h-48 flex flex-col justify-between cursor-pointer group"
        >
          <div>
            <span className="text-[10px] font-bold text-primary tracking-widest uppercase mb-2 block">Resume Activity</span>
            <h3 className="text-xl font-bold font-headline leading-tight group-hover:text-primary transition-colors">
              {stats?.lastFolderId ? 'Open workbench' : 'Start a new build'}
            </h3>
          </div>
          <button className="flex items-center justify-between">
            <span className="text-sm font-semibold text-on-surface-variant group-hover:text-primary transition-colors">Resume build</span>
            <ArrowRight className="w-5 h-5 text-primary group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </section>

      {/* Stats & Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-lg font-bold font-headline flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Attention &amp; Focus
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Wellbeing Circle Chart */}
            <div className="bg-surface-container-low rounded-xl p-6 border border-outline-variant/15 flex flex-col items-center">
              <div className="w-full flex justify-between items-start mb-4">
                <span className="text-sm font-semibold text-on-surface-variant">Where attention went this week</span>
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div className="w-full h-48 relative">
                {totalMinutes > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={wellbeingData.filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        stroke="none"
                      >
                        {wellbeingData.filter(d => d.value > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                        formatter={(value: number) => [formatTime(value), '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-outline italic">No sprints yet — start a build sprint</p>
                  </div>
                )}
                {totalMinutes > 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
                    <span className="text-xl font-black font-headline text-on-surface leading-tight">
                      {formatTime(totalMinutes)}
                    </span>
                    <span className="text-[10px] font-bold text-outline uppercase mt-0.5">Total</span>
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 w-full">
                {wellbeingData.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></div>
                    <span className="text-[10px] font-bold text-on-surface-variant truncate">{entry.name}</span>
                    <span className="text-[10px] text-outline ml-auto">{formatTime(entry.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Ideas captured chart removed per request */}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="space-y-6">
          <h3 className="text-lg font-bold font-headline">Recent Clips &amp; Connections</h3>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-sm divide-y divide-outline-variant/10 overflow-hidden">
            {recentActivities.length > 0 ? recentActivities.map((activity) => {
              const Icon = iconMap[activity.icon] || FileText;
              return (
                <div key={activity.id} className="p-4 flex items-center gap-4 hover:bg-surface-container-low transition-colors cursor-pointer group">
                  <div className={`w-10 h-10 rounded-lg ${activity.colorClass || 'bg-primary-container'} flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">{activity.title}</p>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(activity.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            }) : (
              <div className="p-8 text-center text-outline text-sm italic leading-relaxed">
                Clip the lecture before it gets lost.<br />Link it to a build. Come back and make.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Floating Carry Bag */}
      <motion.div 
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => onNavigate('capture')}
        className="fixed bottom-8 right-8 w-16 h-16 rounded-full glass-panel flex items-center justify-center shadow-2xl cursor-pointer group z-50"
      >
        <ShoppingBag className="text-primary w-7 h-7" />
        <div className="absolute -top-1 -right-1 w-5 h-5 bg-tertiary rounded-full text-[10px] text-white flex items-center justify-center font-bold">
          {counts.total}
        </div>
        <div className="absolute bottom-20 right-0 bg-on-surface text-surface px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {counts.total} pieces in vault
        </div>
      </motion.div>
    </div>
  );
}
