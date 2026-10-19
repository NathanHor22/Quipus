package com.quipus.usbmic;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class AudioPacketSenderTest {
  private AudioProtocol.Packet packet(long sequence) {
    return new AudioProtocol.Packet(
        AudioProtocol.AUDIO, sequence, 0, new byte[16], new byte[16], new byte[1024]);
  }

  @Test
  public void gracefulFinishPreservesQueuedTailAndRejectsNewFrames() throws Exception {
    CountDownLatch delivered = new CountDownLatch(3);
    AudioPacketSender sender =
        new AudioPacketSender(
            p -> {
              delivered.countDown();
              return true;
            },
            () -> fail("Unexpected failure"));
    assertTrue(sender.offer(packet(1)));
    assertTrue(sender.offer(packet(2)));
    assertTrue(sender.offer(packet(3)));
    assertTrue(sender.finish(1000));
    assertEquals(0, delivered.getCount());
    assertFalse(sender.offer(packet(4)));
  }

  @Test
  public void preservesOrderWithoutBlockingCapture() throws Exception {
    List<Long> delivered = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch complete = new CountDownLatch(3);
    try (AudioPacketSender sender =
        new AudioPacketSender(
            p -> {
              delivered.add(p.sequence);
              complete.countDown();
              return true;
            },
            () -> fail("Unexpected failure"))) {
      assertTrue(sender.offer(packet(1)));
      assertTrue(sender.offer(packet(2)));
      assertTrue(sender.offer(packet(3)));
      assertTrue(complete.await(2, TimeUnit.SECONDS));
      assertEquals(List.of(1L, 2L, 3L), delivered);
    }
  }

  @Test
  public void queueCapacityIsStrictWhenUsbIsBlocked() throws Exception {
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    try (AudioPacketSender sender =
        new AudioPacketSender(
            p -> {
              entered.countDown();
              try {
                release.await(2, TimeUnit.SECONDS);
              } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
              }
              return true;
            },
            () -> fail("Unexpected failure"))) {
      assertTrue(sender.offer(packet(0)));
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      for (int i = 1; i <= 16; i++) assertTrue(sender.offer(packet(i)));
      assertFalse(sender.offer(packet(17)));
      release.countDown();
    }
  }

  @Test
  public void failedTransportStopsAcceptingAudioAndSignalsOnce() throws Exception {
    CountDownLatch failed = new CountDownLatch(1);
    AudioPacketSender sender = new AudioPacketSender(p -> false, failed::countDown);
    try {
      assertTrue(sender.offer(packet(0)));
      assertTrue(failed.await(2, TimeUnit.SECONDS));
      assertFalse(sender.offer(packet(1)));
      assertFalse(sender.finish(100));
    } finally {
      sender.close();
    }
    assertFalse(sender.offer(packet(2)));
  }
}
