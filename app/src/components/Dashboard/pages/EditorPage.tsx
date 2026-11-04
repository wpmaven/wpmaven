import React, { useEffect, useRef, useState } from 'react';
import { initEditorConfig } from '../../../editor/config';
import { useDashboard } from '../../../contexts/DashboardContext';
import { EDITOR_LOADING_TEXT, PageLoading } from '../../AppLoading';

const EditorApp = React.lazy(() => import('../../../editor/EditorApp'));

function EditorPage() {
  const { editorPostId, editorSelectedItem, editorTarget } = useDashboard();
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const postId = editorSelectedItem?.id ? Number(editorSelectedItem.id) : (editorPostId || 0);
    initEditorConfig(postId);
    setReady(true);
  }, [editorPostId, editorSelectedItem]);

  // The item the address names is read before the editor opens, so its frame starts there (2026-10-19);
  // once open, the editor moves to another item itself.
  if (ready && !editorTarget) started.current = true;
  if (!started.current) {
    return (
      <div className="wpm-editor-page">
        <PageLoading text={EDITOR_LOADING_TEXT} />
      </div>
    );
  }

  return (
    <div className="wpm-editor-page">
      <React.Suspense fallback={<PageLoading text={EDITOR_LOADING_TEXT} />}>
        <EditorApp selectedItem={editorSelectedItem} />
      </React.Suspense>
    </div>
  );
}

export default EditorPage;
