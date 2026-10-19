package com.quipus.usbmic;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import java.util.function.Predicate;

/** Keeps USB stalls off the capture thread, with a strict half-second memory bound. */
final class AudioPacketSender implements AutoCloseable {
  private final ArrayBlockingQueue<AudioProtocol.Packet> packets = new ArrayBlockingQueue<>(16);
  private final AtomicBoolean active = new AtomicBoolean(true);
  private final AtomicBoolean accepting = new AtomicBoolean(true);
  private final AtomicBoolean transportFailed = new AtomicBoolean(false);
  private final AtomicInteger outstanding = new AtomicInteger();
  private final Predicate<AudioProtocol.Packet> write;
  private final Runnable onFailure;
  private final Thread worker;

  AudioPacketSender(Predicate<AudioProtocol.Packet> write, Runnable onFailure) {
    this.write = write;
    this.onFailure = onFailure;
    worker = new Thread(this::run, "quipus-usb-audio-send");
    worker.start();
  }

  boolean offer(AudioProtocol.Packet packet) {
    if (!active.get() || !accepting.get()) return false;
    outstanding.incrementAndGet();
    if (packets.offer(packet)) return true;
    outstanding.decrementAndGet();
    return false;
  }

  private void run() {
    try {
      while (active.get()) {
        AudioProtocol.Packet packet = packets.poll(100, TimeUnit.MILLISECONDS);
        if (packet != null) {
          try {
            if (!write.test(packet)) {
              transportFailed.set(true);
              if (active.getAndSet(false)) onFailure.run();
            }
          } finally {
            outstanding.decrementAndGet();
          }
        }
      }
    } catch (InterruptedException ignored) {
      Thread.currentThread().interrupt();
    } catch (RuntimeException ignored) {
      transportFailed.set(true);
      if (active.getAndSet(false)) onFailure.run();
    } finally {
      active.set(false);
      packets.clear();
    }
  }

  /** Stops capture admission and drains already captured frames within a hard deadline. */
  boolean finish(long timeoutMs) {
    accepting.set(false);
    long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
    while (active.get() && outstanding.get() > 0 && System.nanoTime() < deadline) {
      LockSupport.parkNanos(2_000_000L);
      if (Thread.currentThread().isInterrupted()) break;
    }
    boolean complete = !transportFailed.get() && outstanding.get() == 0;
    close();
    return complete;
  }

  @Override
  public void close() {
    accepting.set(false);
    active.set(false);
    worker.interrupt();
    if (Thread.currentThread() != worker) {
      try {
        worker.join(1500);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
      }
    }
    packets.clear();
  }
}
