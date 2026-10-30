/**
 * FilesScreen.tsx - browser IndexedDB inbox for verified received files.
 */

import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '@lightbeam/core';
import { Button } from '../components/Controls';
import { Panel, Row } from '../components/Panel';
import {
  canWebShareFiles,
  clearInbox,
  deleteInboxItem,
  downloadBytes,
  listInbox,
  shareBrowserFile,
  toSafeBlob,
  type InboxItem,
} from '../services/inbox';

export interface FilesScreenProps {
  onInboxChanged: () => void;
  onBack: () => void;
}

export function FilesScreen({ onInboxChanged, onBack }: FilesScreenProps) {
  const [files, setFiles] = useState<InboxItem[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const items = await listInbox();
    setFiles(items);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      Object.values(imageUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageUrls]);

  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);

  const handleDeleteOne = async (id: string) => {
    await deleteInboxItem(id);
    if (previewId === id) setPreviewId(null);
    await refresh();
    onInboxChanged();
  };

  const handleClearAll = async () => {
    await clearInbox();
    setConfirmClear(false);
    setPreviewId(null);
    await refresh();
    onInboxChanged();
  };

  const togglePreview = (item: InboxItem) => {
    if (previewId === item.id) {
      setPreviewId(null);
      return;
    }
    if (item.mime.startsWith('image/') && !imageUrls[item.id]) {
      const url = URL.createObjectURL(toSafeBlob(item.bytes, item.mime));
      setImageUrls((prev) => ({ ...prev, [item.id]: url }));
    }
    setPreviewId(item.id);
  };

  const shareSupported = canWebShareFiles();

  return (
    <>
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Received files</h1>
          <p className="screen-subtitle">
            {files.length} file{files.length === 1 ? '' : 's'} ({formatBytes(totalBytes)}) stored locally in this
            browser&apos;s IndexedDB inbox
          </p>
        </div>
        <Button label="Back" variant="ghost" compact onClick={onBack} />
      </div>

      {files.length === 0 ? (
        <Panel>
          <p>
            Nothing stored yet. Verified payloads received via camera or loopback are saved in browser IndexedDB so you
            can inspect, download, share, or delete them at any time.
          </p>
        </Panel>
      ) : (
        files.map((item) => {
          const isPreviewable = item.mime.startsWith('text/') || item.mime === 'application/json' || item.mime.startsWith('image/');
          const showingPreview = previewId === item.id;
          return (
            <div key={item.id} className="inbox-card" data-testid="inbox-item">
              <div className="inbox-card-header">
                <div>
                  <strong>{item.name}</strong>
                  <div className="caption mono">
                    {formatBytes(item.size)} · {item.mime} · SHA-256 {item.sha256.slice(0, 12)}… ·{' '}
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </div>
                </div>
                <Row>
                  <Button
                    label="Download"
                    compact
                    onClick={() => downloadBytes(item.name, item.bytes, item.mime)}
                  />
                  {shareSupported ? (
                    <Button
                      label="Share"
                      variant="secondary"
                      compact
                      onClick={() => void shareBrowserFile(item.name, item.bytes, item.mime)}
                    />
                  ) : null}
                  {isPreviewable ? (
                    <Button
                      label={showingPreview ? 'Hide preview' : 'Preview'}
                      variant="ghost"
                      compact
                      onClick={() => togglePreview(item)}
                    />
                  ) : null}
                  <Button
                    label="Delete"
                    variant="danger"
                    compact
                    onClick={() => void handleDeleteOne(item.id)}
                  />
                </Row>
              </div>

              {showingPreview && (item.mime.startsWith('text/') || item.mime === 'application/json') ? (
                <pre className="text-preview">
                  {new TextDecoder().decode(item.bytes).slice(0, 16_000)}
                </pre>
              ) : null}

              {showingPreview && item.mime.startsWith('image/') && imageUrls[item.id] ? (
                <img src={imageUrls[item.id]} alt={item.name} className="image-preview" />
              ) : null}
            </div>
          );
        })
      )}

      {files.length > 0 ? (
        confirmClear ? (
          <Panel tone="bad">
            <p>Remove all {files.length} received file(s) from browser storage?</p>
            <Row>
              <Button label="Confirm delete all" variant="danger" compact onClick={() => void handleClearAll()} />
              <Button label="Cancel" variant="secondary" compact onClick={() => setConfirmClear(false)} />
            </Row>
          </Panel>
        ) : (
          <Row>
            <Button label="Delete all received files" variant="danger" onClick={() => setConfirmClear(true)} />
          </Row>
        )
      ) : null}

      <p className="caption">
        Files stay strictly inside this origin&apos;s browser storage until you download, share, or delete them.
        Nothing in this inbox is ever transmitted to the server.
      </p>
    </>
  );
}
