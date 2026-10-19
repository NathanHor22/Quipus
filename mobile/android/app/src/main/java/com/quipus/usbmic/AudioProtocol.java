package com.quipus.usbmic;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.function.Consumer;
import java.util.zip.CRC32;

/** Bounded, versioned wire framing shared with quipus_usb_protocol.c. */
public final class AudioProtocol {
  public static final int HEADER = 56, MAX_PAYLOAD = 1024;
  public static final int HELLO = 1, READY = 2, START = 3, AUDIO = 4, STOP = 5, ERROR = 6;

  private AudioProtocol() {}

  public static final class Packet {
    public final int type;
    public final long sequence, monotonicUs;
    public final byte[] session, nonce, payload;

    public Packet(
        int type, long sequence, long monotonicUs, byte[] session, byte[] nonce, byte[] payload) {
      if (type < HELLO
          || type > ERROR
          || session.length != 16
          || nonce.length != 16
          || payload.length > MAX_PAYLOAD)
        throw new IllegalArgumentException("Invalid audio packet");
      this.type = type;
      this.sequence = sequence;
      this.monotonicUs = monotonicUs;
      this.session = session.clone();
      this.nonce = nonce.clone();
      this.payload = payload.clone();
    }
  }

  public static byte[] encode(Packet packet) {
    ByteBuffer buffer =
        ByteBuffer.allocate(HEADER + packet.payload.length).order(ByteOrder.LITTLE_ENDIAN);
    buffer
        .put(new byte[] {'Q', 'P', 'A', '1'})
        .put((byte) 1)
        .put((byte) packet.type)
        .putShort((short) packet.payload.length);
    buffer
        .putInt((int) packet.sequence)
        .putLong(packet.monotonicUs)
        .put(packet.session)
        .put(packet.nonce)
        .putInt(0)
        .put(packet.payload);
    byte[] bytes = buffer.array();
    CRC32 crc = new CRC32();
    crc.update(bytes, 0, 52);
    crc.update(packet.payload);
    buffer.putInt(52, (int) crc.getValue());
    return bytes;
  }

  public static final class Decoder {
    private final byte[] bytes = new byte[(HEADER + MAX_PAYLOAD) * 2];
    private int used;

    public void feed(byte[] input, int count, Consumer<Packet> consumer) {
      if (count < 0 || count > input.length)
        throw new IllegalArgumentException("Invalid byte count");
      int offset = 0;
      while (offset < count) {
        if (used == bytes.length) used = 0;
        int take = Math.min(count - offset, bytes.length - used);
        System.arraycopy(input, offset, bytes, used, take);
        used += take;
        offset += take;
        parse(consumer);
      }
    }

    private void discard(int count) {
      used -= count;
      System.arraycopy(bytes, count, bytes, 0, used);
    }

    private void parse(Consumer<Packet> consumer) {
      while (used >= HEADER) {
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int length = Short.toUnsignedInt(buffer.getShort(6)), type = Byte.toUnsignedInt(bytes[5]);
        if (bytes[0] != 'Q'
            || bytes[1] != 'P'
            || bytes[2] != 'A'
            || bytes[3] != '1'
            || bytes[4] != 1
            || type < HELLO
            || type > ERROR
            || length > MAX_PAYLOAD) {
          discard(1);
          continue;
        }
        if (used < HEADER + length) return;
        CRC32 crc = new CRC32();
        crc.update(bytes, 0, 52);
        crc.update(bytes, HEADER, length);
        if (Integer.toUnsignedLong(buffer.getInt(52)) != crc.getValue()) {
          discard(1);
          continue;
        }
        Packet packet =
            new Packet(
                type,
                Integer.toUnsignedLong(buffer.getInt(8)),
                buffer.getLong(12),
                Arrays.copyOfRange(bytes, 20, 36),
                Arrays.copyOfRange(bytes, 36, 52),
                Arrays.copyOfRange(bytes, HEADER, HEADER + length));
        discard(HEADER + length);
        consumer.accept(packet);
      }
    }
  }
}
