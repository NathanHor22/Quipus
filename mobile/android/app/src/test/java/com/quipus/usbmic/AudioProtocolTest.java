package com.quipus.usbmic;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class AudioProtocolTest {
  @Test
  public void matchesIndependentCrcVectorSharedWithFirmware() {
    byte[] zero = new byte[16];
    byte[] encoded =
        AudioProtocol.encode(
            new AudioProtocol.Packet(AudioProtocol.HELLO, 0, 0, zero, zero, new byte[0]));
    assertEquals(56, encoded.length);
    assertArrayEquals(
        new byte[] {(byte) 0x82, 0x2e, (byte) 0xf0, (byte) 0xf1},
        Arrays.copyOfRange(encoded, 52, 56));
  }

  @Test
  public void fragmentedPacketsPreserveTimingIdentityAndPcm() {
    byte[] session = new byte[16], nonce = new byte[16], pcm = new byte[1024];
    Arrays.fill(session, (byte) 3);
    Arrays.fill(nonce, (byte) 9);
    for (int i = 0; i < pcm.length; i++) pcm[i] = (byte) i;
    AudioProtocol.Packet packet =
        new AudioProtocol.Packet(AudioProtocol.AUDIO, 123, 123456789L, session, nonce, pcm);
    byte[] encoded = AudioProtocol.encode(packet);
    AudioProtocol.Decoder decoder = new AudioProtocol.Decoder();
    List<AudioProtocol.Packet> decoded = new ArrayList<>();
    for (byte b : encoded) decoder.feed(new byte[] {b}, 1, decoded::add);
    assertEquals(1, decoded.size());
    assertEquals(123, decoded.get(0).sequence);
    assertEquals(123456789L, decoded.get(0).monotonicUs);
    assertArrayEquals(session, decoded.get(0).session);
    assertArrayEquals(nonce, decoded.get(0).nonce);
    assertArrayEquals(pcm, decoded.get(0).payload);
  }

  @Test
  public void malformedNoiseAndCorruptPacketsResynchroniseWithoutUnboundedBuffers() {
    byte[] zero = new byte[16];
    byte[] valid =
        AudioProtocol.encode(
            new AudioProtocol.Packet(AudioProtocol.START, 0, 5, zero, zero, new byte[0]));
    byte[] corrupt = valid.clone();
    corrupt[36] = 1;
    byte[] oversized = valid.clone();
    oversized[6] = (byte) 255;
    oversized[7] = (byte) 127;
    AudioProtocol.Decoder decoder = new AudioProtocol.Decoder();
    List<AudioProtocol.Packet> packets = new ArrayList<>();
    byte[] noise = new byte[100000];
    Arrays.fill(noise, (byte) 33);
    decoder.feed(noise, noise.length, packets::add);
    decoder.feed(oversized, oversized.length, packets::add);
    decoder.feed(corrupt, corrupt.length, packets::add);
    decoder.feed(valid, valid.length, packets::add);
    assertEquals(1, packets.size());
    assertEquals(AudioProtocol.START, packets.get(0).type);
  }

  @Test
  public void sourceArraysCannotMutateAnEncodedSession() {
    byte[] identity = new byte[16], pcm = new byte[] {1, 2};
    AudioProtocol.Packet packet =
        new AudioProtocol.Packet(AudioProtocol.AUDIO, 0, 0, identity, identity, pcm);
    identity[0] = 99;
    pcm[0] = 99;
    assertEquals(0, packet.session[0]);
    assertEquals(1, packet.payload[0]);
  }

  @Test
  public void rejectsOversizedPayloads() {
    assertThrows(
        IllegalArgumentException.class,
        () ->
            new AudioProtocol.Packet(
                AudioProtocol.AUDIO, 0, 0, new byte[16], new byte[16], new byte[1025]));
  }
}
