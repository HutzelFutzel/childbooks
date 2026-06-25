import { useEffect, useState } from "react";

/** Load an image URL into an HTMLImageElement for use as a Konva image. */
export function useImage(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    let active = true;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      if (active) setImg(el);
    };
    el.onerror = () => {
      if (active) setImg(null);
    };
    el.src = url;
    return () => {
      active = false;
    };
  }, [url]);

  return img;
}
