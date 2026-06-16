import React, { useState, useEffect } from 'react';

interface ProfileAvatarProps {
  photoURL?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export default function ProfileAvatar({ photoURL, name = 'Curator', size = 'md', className = '' }: ProfileAvatarProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadPhoto = async () => {
      if (!photoURL) {
        if (mounted) setDataUrl(null);
        return;
      }

      if (photoURL.startsWith('http') || photoURL.startsWith('data:')) {
        if (mounted) setDataUrl(photoURL);
      } else if (window.electronAPI) {
        try {
          const base64 = await window.electronAPI.readFileBase64(photoURL);
          if (mounted) setDataUrl(base64);
        } catch (err) {
          console.error("Failed to load local avatar", err);
          if (mounted) setDataUrl(null);
        }
      } else {
        if (mounted) setDataUrl(null);
      }
    };

    loadPhoto();
    return () => { mounted = false; };
  }, [photoURL]);

  const getInitials = (n: any) => {
    if (!n || typeof n !== 'string') return '?';
    const parts = n.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    return parts.map(w => w[0]).join('').toUpperCase().substring(0, 2);
  };

  const sizeClasses = {
    sm: 'w-6 h-6 text-[9px]',
    md: 'w-8 h-8 text-[10px]',
    lg: 'w-10 h-10 text-sm',
    xl: 'w-24 h-24 text-xl',
  };

  const classes = sizeClasses[size as keyof typeof sizeClasses] || sizeClasses.md;

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={name}
        className={`${classes} rounded-full object-cover border border-outline-variant/20 shadow-sm ${className}`}
      />
    );
  }

  return (
    <div className={`${classes} rounded-full bg-primary/20 text-primary flex items-center justify-center font-headline font-black ${className}`}>
      {getInitials(name)}
    </div>
  );
}
