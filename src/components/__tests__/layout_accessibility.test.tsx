// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import PdfToolbar from '../tabs/PdfToolbar';

describe('Invisible Border & Symbol-Only Layout Accessibility', () => {
  it('renders PdfToolbar with ui-invisible-border class and full aria-label accessibility', () => {
    const { container, getByLabelText } = render(
      <PdfToolbar
        currentPage={1}
        numPages={10}
        jumpToPage={() => {}}
        zoom={1.0}
        setZoom={() => {}}
        rotation={0}
        setRotation={() => {}}
        readingFilter="default"
        setReadingFilter={() => {}}
        isDrawMode={false}
        setIsDrawMode={() => {}}
        activeTool="pen"
        setActiveTool={() => {}}
        penColor="#000000"
        setPenColor={() => {}}
        penWidth={2}
        setPenWidth={() => {}}
        highlighterColor="rgba(255,255,0,0.5)"
        setHighlighterColor={() => {}}
        highlighterWidth={10}
        setHighlighterWidth={() => {}}
        runAnnotationCommand={() => {}}
        clearPageAnnotations={() => {}}
        ingestionStatus={null}
        workspaceMode="read"
        onSetWorkspaceMode={() => {}}
      />
    );

    // Verify boundary wrapper has ui-invisible-border
    const wrapper = container.querySelector('.ui-invisible-border');
    expect(wrapper).not.toBeNull();

    // Verify aria-label attributes exist even when labels hide on narrow viewports
    expect(getByLabelText('Previous Page')).toBeTruthy();
    expect(getByLabelText('Next Page')).toBeTruthy();
    expect(getByLabelText('Zoom In')).toBeTruthy();
    expect(getByLabelText('Zoom Out')).toBeTruthy();
    expect(getByLabelText('Toggle Annotation Mode')).toBeTruthy();
  });
});
