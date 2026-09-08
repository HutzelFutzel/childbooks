import { useEffect, useState } from "react";

/** Load an image URL into an HTMLImageElement for use as a Konva image. */
export function useImage(url: string | undefined): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);

  useEffect(() => {
    if (!url) {
      setLoaded(null);
      return;
    }
    let active = true;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      if (active) setLoaded({ url, image: el });
    };
    el.onerror = () => {
      if (active) setLoaded(null);
    };
    el.src = url;
    return () => {
      active = false;
    };
  }, [url]);

  // A URL change is visible during render, before the effect above can clear
  // state. Never hand a canvas the previous source for one frame.
  if (!loaded || loaded.url !== url) return null;
  return loaded.image;
}
