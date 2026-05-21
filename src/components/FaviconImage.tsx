import { useEffect, useMemo, useState } from 'react';
import { getCachedFavicon, saveCachedFavicon } from '../lib/faviconCache';

interface FaviconImageProps {
  url: string;
  className?: string;
}

function buildFaviconSources(url: string) {
  try {
    const parsedUrl = new URL(url);
    const extensionFaviconUrl =
      typeof chrome !== 'undefined' && typeof chrome.runtime?.getURL === 'function'
        ? chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`)
        : '';

    return [
      ...(extensionFaviconUrl ? [extensionFaviconUrl] : []),
      `https://www.google.com/s2/favicons?domain=${parsedUrl.hostname}&sz=64`
    ];
  } catch {
    return [];
  }
}

export default function FaviconImage({ url, className = 'bookmark-favicon' }: FaviconImageProps) {
  const sources = useMemo(() => buildFaviconSources(url), [url]);
  const extensionSource = sources[0] ?? '';
  const fallbackSource = sources[1] ?? '';
  const [source, setSource] = useState<string>('');
  const [hasLoadedCache, setHasLoadedCache] = useState(false);

  useEffect(() => {
    let isMounted = true;

    setSource('');
    setHasLoadedCache(false);

    void getCachedFavicon(url).then((cachedFavicon) => {
      if (!isMounted) {
        return;
      }

      if (cachedFavicon) {
        setSource(cachedFavicon);
      } else if (extensionSource) {
        setSource(extensionSource);
      } else if (fallbackSource) {
        setSource(fallbackSource);
      }

      setHasLoadedCache(true);
    });

    return () => {
      isMounted = false;
    };
  }, [extensionSource, fallbackSource, url]);

  if (sources.length === 0) {
    return (
      <span className={`bookmark-fallback-icon ${className}`.trim()} aria-hidden="true">
        •
      </span>
    );
  }

  if (!hasLoadedCache || !source) {
    return (
      <span className={`bookmark-fallback-icon ${className}`.trim()} aria-hidden="true">
        •
      </span>
    );
  }

  return (
    <img
      className={className}
      src={source}
      alt=""
      loading="lazy"
      onLoad={(event) => {
        if (source !== extensionSource) {
          return;
        }

        try {
          const image = event.currentTarget;
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || 64;
          canvas.height = image.naturalHeight || 64;
          const context = canvas.getContext('2d');

          if (!context) {
            return;
          }

          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          void saveCachedFavicon(url, dataUrl);
        } catch {
          // Ignore favicon cache conversion failures.
        }
      }}
      onError={() => {
        if (source === extensionSource && fallbackSource) {
          setSource(fallbackSource);
          return;
        }

        setSource('');
      }}
    />
  );
}
