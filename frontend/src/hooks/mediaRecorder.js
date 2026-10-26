export function createMediaRecorder(stream, options) {
  try {
    return new MediaRecorder(stream, options);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
