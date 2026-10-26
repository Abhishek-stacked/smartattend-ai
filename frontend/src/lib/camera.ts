export class CameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CameraError";
  }
}

export async function startCamera(video: HTMLVideoElement | null): Promise<MediaStream> {
  if (!video) throw new CameraError("The camera preview is not ready. Try again.");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError("This browser cannot access a camera. Use a recent Chrome, Edge or Firefox.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError") throw new CameraError("Camera permission was denied. Allow it in the browser and try again.");
    if (name === "NotFoundError") throw new CameraError("No camera was found on this device.");
    throw new CameraError("The camera could not be started. Close other apps using it and try again.");
  }
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    stopStream(stream);
    throw new CameraError("The camera preview could not start. Try again.");
  }
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Captures the current video frame in memory; nothing is uploaded from here. */
export function captureFrame(video: HTMLVideoElement | null, quality = 0.9): Promise<Blob> {
  if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
    return Promise.reject(new CameraError("No camera frame is available yet."));
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new CameraError("The frame could not be captured."));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CameraError("The frame could not be encoded."))),
      "image/jpeg",
      quality,
    );
  });
}

export function frameFile(blob: Blob, name = "frame.jpg"): File {
  return new File([blob], name, { type: "image/jpeg" });
}
