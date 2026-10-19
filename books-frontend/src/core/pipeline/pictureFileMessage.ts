/**
 * What a render reports when a picture file it needs is not in storage: the
 * book still lists the picture, but its file is gone (an upload that never
 * finished, a cleared bucket, a dev reset). Its own module, so the chat can
 * recognize it without loading the pipeline or the backend.
 */
export const PICTURE_FILE_MISSING =
  "A saved picture file this page needs is missing, so it could not be changed.";
