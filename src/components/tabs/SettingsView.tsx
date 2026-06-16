import React from 'react';
import Settings from '../Settings';
import { useOverscroll } from '../../hooks/useOverscroll';

export default function SettingsView() {
  const overscrollRef = useOverscroll();

  return (
    <div ref={overscrollRef} className="h-full overflow-y-auto no-scrollbar">
      <Settings />
    </div>
  );
}
