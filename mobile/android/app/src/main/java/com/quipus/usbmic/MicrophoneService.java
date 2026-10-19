package com.quipus.usbmic;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.usb.*;
import android.media.*;
import android.os.IBinder;
import android.os.SystemClock;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Foreground capture is armed by a visible activity, then gated by hardware consent. */
public final class MicrophoneService extends Service {
  private static final String CHANNEL = "quipus_microphone";
  private static final int NOTIFICATION = 2148, RATE = 16000, SAMPLES = 512;
  private final AtomicBoolean running = new AtomicBoolean(false);
  private final Object writeLock = new Object();
  private volatile int captureGeneration;
  private volatile boolean drainCapture, captureDrained;
  private volatile AudioRecord activeRecord;
  private volatile AudioProtocol.Packet activeSession;
  private volatile UsbDeviceConnection connection;
  private UsbInterface dataInterface;
  private UsbEndpoint input, output;
  private Thread reader, audioThread;
  private long lastReceived;

  public static boolean supported(UsbDevice device) {
    return device.getVendorId() == 0x303a && device.getProductId() == 0x1001;
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent == null || "stop".equals(intent.getAction())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (running.get()) return START_NOT_STICKY;
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      stopSelf();
      return START_NOT_STICKY;
    }
    UsbManager manager = (UsbManager) getSystemService(USB_SERVICE);
    UsbDevice device = manager.getDeviceList().get(intent.getStringExtra("deviceName"));
    if (device == null || !supported(device) || !manager.hasPermission(device)) {
      stopSelf();
      return START_NOT_STICKY;
    }
    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
        .createNotificationChannel(
            new NotificationChannel(
                CHANNEL,
                getString(R.string.notification_title),
                NotificationManager.IMPORTANCE_LOW));
    startForeground(
        NOTIFICATION,
        notification(getString(R.string.waiting)),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            | ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
    running.set(true);
    reader = new Thread(() -> runUsb(manager, device, startId), "quipus-usb-control");
    reader.start();
    return START_NOT_STICKY;
  }

  private Notification notification(String text) {
    PendingIntent open =
        PendingIntent.getActivity(
            this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    PendingIntent stop =
        PendingIntent.getService(
            this,
            1,
            new Intent(this, MicrophoneService.class).setAction("stop"),
            PendingIntent.FLAG_IMMUTABLE);
    return new Notification.Builder(this, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle(getString(R.string.notification_title))
        .setContentText(text)
        .setOngoing(true)
        .setContentIntent(open)
        .addAction(
            new Notification.Action.Builder(null, getString(R.string.disconnect), stop).build())
        .build();
  }

  private void status(String message) {
    getSharedPreferences("state", MODE_PRIVATE).edit().putString("status", message).apply();
    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
        .notify(NOTIFICATION, notification(message));
  }

  private void runUsb(UsbManager manager, UsbDevice device, int startId) {
    try {
      for (int i = 0; i < device.getInterfaceCount(); i++) {
        UsbInterface candidate = device.getInterface(i);
        if (candidate.getInterfaceClass() != UsbConstants.USB_CLASS_CDC_DATA) continue;
        UsbEndpoint in = null, out = null;
        for (int j = 0; j < candidate.getEndpointCount(); j++) {
          UsbEndpoint endpoint = candidate.getEndpoint(j);
          if (endpoint.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
          if (endpoint.getDirection() == UsbConstants.USB_DIR_IN) in = endpoint;
          else out = endpoint;
        }
        if (in != null && out != null) {
          dataInterface = candidate;
          input = in;
          output = out;
          break;
        }
      }
      if (dataInterface == null) throw new IllegalStateException("No CDC audio transport");
      connection = manager.openDevice(device);
      if (connection == null || !connection.claimInterface(dataInterface, true))
        throw new IllegalStateException("USB access unavailable");
      // Assert CDC DTR only; no reset/bootloader RTS sequence is sent.
      for (int i = 0; i < device.getInterfaceCount(); i++)
        if (device.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_COMM)
          connection.controlTransfer(0x21, 0x22, 1, device.getInterface(i).getId(), null, 0, 500);
      AudioProtocol.Decoder decoder = new AudioProtocol.Decoder();
      byte[] read = new byte[4096], zero = new byte[16];
      long helloAt = 0;
      lastReceived = SystemClock.elapsedRealtime();
      status(getString(R.string.connected));
      while (running.get()) {
        long now = SystemClock.elapsedRealtime();
        if (now - helloAt > 1000) {
          send(
              new AudioProtocol.Packet(
                  AudioProtocol.HELLO, 0, System.nanoTime() / 1000, zero, zero, new byte[0]));
          helloAt = now;
        }
        int count = connection.bulkTransfer(input, read, read.length, 250);
        if (count > 0) {
          lastReceived = now;
          decoder.feed(read, count, this::handle);
        }
        if (now - lastReceived > 10000) throw new IllegalStateException("Quipus is not responding");
      }
    } catch (Exception ignored) {
      if (running.get()) status(getString(R.string.usb_interrupted));
    } finally {
      // Close this reader's connection before another start can reserve the service.
      stopCapture();
      closeUsb();
      running.set(false);
      stopSelf(startId);
    }
  }

  private void handle(AudioProtocol.Packet packet) {
    if (packet.payload.length != 0) return;
    if (packet.type == AudioProtocol.READY) {
      // A reboot or lost STOP must never leave the phone capturing an ended session.
      if (activeSession != null) {
        stopCapture();
        status(getString(R.string.waiting));
      }
      return;
    }
    if (packet.type == AudioProtocol.START) {
      if (allZero(packet.session) || allZero(packet.nonce)) return;
      AudioProtocol.Packet active = activeSession;
      if (active != null
          && Arrays.equals(active.session, packet.session)
          && Arrays.equals(active.nonce, packet.nonce)) return;
      stopCapture();
      drainCapture = false;
      captureDrained = false;
      activeSession = packet;
      int generation = ++captureGeneration;
      audioThread = new Thread(() -> capture(packet, generation), "quipus-phone-capture");
      audioThread.start();
    } else if (packet.type == AudioProtocol.STOP) {
      AudioProtocol.Packet active = activeSession;
      if (active != null
          && Arrays.equals(active.session, packet.session)
          && Arrays.equals(active.nonce, packet.nonce)) {
        drainCapture = true;
        stopCapture();
        send(
            new AudioProtocol.Packet(
                captureDrained ? AudioProtocol.STOP : AudioProtocol.ERROR,
                0,
                System.nanoTime() / 1000,
                active.session,
                active.nonce,
                new byte[0]));
        status(getString(R.string.meeting_stopped));
      }
    }
  }

  private static boolean allZero(byte[] bytes) {
    for (byte value : bytes) if (value != 0) return false;
    return true;
  }

  @SuppressLint("MissingPermission")
  private void capture(AudioProtocol.Packet session, int generation) {
    AudioRecord record = null;
    AudioPacketSender sender = null;
    try {
      if (!running.get()
          || captureGeneration != generation
          || checkSelfPermission(Manifest.permission.RECORD_AUDIO)
              != PackageManager.PERMISSION_GRANTED) return;
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
      int minimum =
          AudioRecord.getMinBufferSize(
              RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minimum <= 0) throw new IllegalStateException("Microphone format unavailable");
      record =
          new AudioRecord.Builder()
              .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
              .setAudioFormat(
                  new AudioFormat.Builder()
                      .setSampleRate(RATE)
                      .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                      .build())
              .setBufferSizeInBytes(Math.max(minimum * 2, 8192))
              .build();
      for (AudioDeviceInfo microphone :
          ((AudioManager) getSystemService(AUDIO_SERVICE))
              .getDevices(AudioManager.GET_DEVICES_INPUTS))
        if (microphone.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
          record.setPreferredDevice(microphone);
          break;
        }
      if (record.getState() != AudioRecord.STATE_INITIALIZED)
        throw new IllegalStateException("Microphone unavailable");
      activeRecord = record;
      if (!running.get() || captureGeneration != generation) return;
      record.startRecording();
      AudioRecord sourceRecord = record;
      sender =
          new AudioPacketSender(
              this::send,
              () -> {
                try {
                  sourceRecord.stop();
                } catch (IllegalStateException ignored) {
                }
              });
      status(getString(R.string.recording));
      short[] samples = new short[SAMPLES];
      long sequence = 0, frameOffset = 0;
      AudioTimestamp timestamp = new AudioTimestamp();
      while (running.get() && captureGeneration == generation) {
        int count = record.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
        if (count <= 0) throw new IllegalStateException("Microphone interrupted");
        long sampleUs = System.nanoTime() / 1000 - count * 1000000L / RATE;
        if (record.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC)
            == AudioRecord.SUCCESS)
          sampleUs =
              timestamp.nanoTime / 1000 + (frameOffset - timestamp.framePosition) * 1000000L / RATE;
        frameOffset += count;
        byte[] pcm = new byte[count * 2];
        for (int i = 0; i < count; i++) {
          pcm[i * 2] = (byte) samples[i];
          pcm[i * 2 + 1] = (byte) (samples[i] >> 8);
        }
        if (!sender.offer(
            new AudioProtocol.Packet(
                AudioProtocol.AUDIO, sequence++, sampleUs, session.session, session.nonce, pcm)))
          throw new IllegalStateException("USB recording interrupted");
      }
    } catch (Exception ignored) {
      if (running.get() && captureGeneration == generation) {
        status(getString(R.string.audio_interrupted));
        send(
            new AudioProtocol.Packet(
                AudioProtocol.ERROR,
                0,
                System.nanoTime() / 1000,
                session.session,
                session.nonce,
                new byte[0]));
      }
    } finally {
      if (sender != null) {
        if (drainCapture) captureDrained = sender.finish(1000);
        else sender.close();
      }
      if (record != null) {
        try {
          record.stop();
        } catch (IllegalStateException ignored) {
        }
        record.release();
      }
      if (activeRecord == record) activeRecord = null;
    }
  }

  private boolean send(AudioProtocol.Packet packet) {
    byte[] bytes = AudioProtocol.encode(packet);
    synchronized (writeLock) {
      UsbDeviceConnection usb = connection;
      if (usb == null || output == null) return false;
      int offset = 0;
      long deadline = SystemClock.elapsedRealtime() + 500;
      while (offset < bytes.length && running.get()) {
        long remaining = deadline - SystemClock.elapsedRealtime();
        if (remaining <= 0) return false;
        int sent =
            usb.bulkTransfer(
                output, bytes, offset, bytes.length - offset, (int) Math.min(250, remaining));
        if (sent <= 0) return false;
        offset += sent;
      }
      return offset == bytes.length;
    }
  }

  private void stopCapture() {
    captureGeneration++;
    activeSession = null;
    AudioRecord record = activeRecord;
    if (record != null)
      try {
        record.stop();
      } catch (IllegalStateException ignored) {
      }
    Thread thread = audioThread;
    if (thread != null && thread != Thread.currentThread())
      try {
        thread.join(2000);
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
      }
    audioThread = null;
  }

  private void closeUsb() {
    UsbDeviceConnection usb = connection;
    connection = null;
    if (usb != null) {
      if (dataInterface != null) usb.releaseInterface(dataInterface);
      usb.close();
    }
  }

  @Override
  public void onDestroy() {
    running.set(false);
    stopCapture();
    closeUsb();
    getSharedPreferences("state", MODE_PRIVATE)
        .edit()
        .putString("status", getString(R.string.disconnected))
        .apply();
    stopForeground(STOP_FOREGROUND_REMOVE);
    super.onDestroy();
  }
}
