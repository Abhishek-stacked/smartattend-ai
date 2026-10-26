import { useCallback, useEffect, useRef, useState } from "react";
import { CameraError, startCamera, stopStream } from "../lib/camera";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      streamRef.current = await startCamera(videoRef.current);
      setActive(true);
    } catch (err) {
      setError(err instanceof CameraError ? err.message : "The camera could not be started.");
      stop();
    } finally {
      setStarting(false);
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, active, starting, error, start, stop };
}
