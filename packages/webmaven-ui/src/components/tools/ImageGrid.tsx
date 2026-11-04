import React from 'react';
import { ToolRenderProps } from './types';

/**
 * Renders results from image_generation. Handles a few payload shapes:
 *   - { images: [{ url, dataUrl, prompt, mediaId }, ...] }
 *   - { url, mediaId }                                        (single image)
 *   - { data: { images: [...] } }
 */
export const ImageGrid: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);
  const images: any[] = collectImages(data);

  if (images.length === 0) {
    return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No images.</span>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(images.length, 3)}, 1fr)`,
        gap: 6,
      }}
    >
      {images.slice(0, 6).map((img, i) => {
        const src = img.url || img.dataUrl;
        if (!src) return null;
        return (
          <a
            key={i}
            href={src}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'block', borderRadius: 6, overflow: 'hidden' }}
            title={img.prompt || img.alt || ''}
          >
            <img
              src={src}
              alt={img.alt || img.prompt || 'Generated'}
              loading="lazy"
              style={{
                width: '100%',
                aspectRatio: img.aspectRatio || '1 / 1',
                objectFit: 'cover',
                display: 'block',
                border: '1px solid var(--glass-border)',
              }}
            />
          </a>
        );
      })}
    </div>
  );
};

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function collectImages(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data?.images)) return data.images;
  if (Array.isArray(data)) return data;
  if (data?.url || data?.dataUrl) return [data];
  return [];
}
