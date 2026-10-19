type PositionedReader = {
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
};
type PositionedWriter = {
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>;
};

/** Regular files may still return partial IO; never assume one call is complete. */
export async function readAudioBytes(
  file: PositionedReader,
  buffer: Buffer,
  length: number,
  position: number,
) {
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length - offset)
      throw new Error("Recording ended before its declared WAV length.");
    offset += bytesRead;
  }
}
export async function writeAudioBytes(
  file: PositionedWriter,
  buffer: Buffer,
  length: number,
  position: number,
) {
  let offset = 0;
  while (offset < length) {
    const { bytesWritten } = await file.write(buffer, offset, length - offset, position + offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > length - offset)
      throw new Error("The recording could not be written completely.");
    offset += bytesWritten;
  }
}
