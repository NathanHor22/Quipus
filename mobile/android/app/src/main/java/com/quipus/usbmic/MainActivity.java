package com.quipus.usbmic;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
  private static final String USB_PERMISSION = "com.quipus.usbmic.USB_PERMISSION";
  private final Handler handler = new Handler(Looper.getMainLooper());
  private TextView status;
  private UsbManager manager;
  private boolean receiverRegistered;
  private final Runnable refresh =
      new Runnable() {
        @Override
        public void run() {
          status.setText(
              getSharedPreferences("state", MODE_PRIVATE)
                  .getString("status", getString(R.string.connect_cable)));
          handler.postDelayed(this, 1000);
        }
      };
  private final BroadcastReceiver permissionReceiver =
      new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
          if (!USB_PERMISSION.equals(intent.getAction())) return;
          if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) connect();
          else status.setText(getString(R.string.usb_declined));
        }
      };

  // Android 11/12 require the legacy overload; the permission intent is package-scoped.
  @SuppressLint("UnspecifiedRegisterReceiverFlag")
  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    manager = (UsbManager) getSystemService(USB_SERVICE);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    int padding = (int) (24 * getResources().getDisplayMetrics().density);
    layout.setPadding(padding, padding * 2, padding, padding);
    layout.setBackgroundColor(Color.WHITE);
    TextView title = new TextView(this);
    title.setText(getString(R.string.brand));
    title.setTextSize(30);
    title.setTextColor(Color.rgb(15, 28, 46));
    layout.addView(title);
    TextView description = new TextView(this);
    description.setText(R.string.explanation);
    description.setTextSize(17);
    description.setPadding(0, padding, 0, padding);
    layout.addView(description);
    status = new TextView(this);
    status.setTextSize(16);
    status.setPadding(0, 0, 0, padding);
    layout.addView(status);
    Button connect = new Button(this);
    connect.setText(getString(R.string.enable_microphone));
    connect.setAllCaps(false);
    connect.setOnClickListener(view -> requestConnect());
    layout.addView(connect, new LinearLayout.LayoutParams(-1, -2));
    Button disconnect = new Button(this);
    disconnect.setText(getString(R.string.disconnect));
    disconnect.setAllCaps(false);
    disconnect.setOnClickListener(
        view -> {
          getSharedPreferences("state", MODE_PRIVATE)
              .edit()
              .putBoolean("autoConnect", false)
              .apply();
          stopService(new Intent(this, MicrophoneService.class));
          status.setText(getString(R.string.disconnected));
        });
    layout.addView(disconnect, new LinearLayout.LayoutParams(-1, -2));
    setContentView(layout);
    IntentFilter filter = new IntentFilter(USB_PERMISSION);
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(permissionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(permissionReceiver, filter);
    receiverRegistered = true;
  }

  @Override
  protected void onResume() {
    super.onResume();
    handler.post(refresh);
    if (getSharedPreferences("state", MODE_PRIVATE).getBoolean("autoConnect", false)
        && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED) connect();
  }

  @Override
  protected void onPause() {
    handler.removeCallbacks(refresh);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    if (receiverRegistered) unregisterReceiver(permissionReceiver);
    super.onDestroy();
  }

  private void requestConnect() {
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, 10);
      return;
    }
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 11);
    connect();
  }

  @Override
  public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(request, permissions, results);
    if (request == 10 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
      connect();
  }

  private void connect() {
    UsbDevice selected = null;
    for (UsbDevice device : manager.getDeviceList().values())
      if (MicrophoneService.supported(device)) {
        selected = device;
        break;
      }
    if (selected == null) {
      status.setText(getString(R.string.no_device));
      return;
    }
    if (!manager.hasPermission(selected)) {
      PendingIntent permission =
          PendingIntent.getBroadcast(
              this,
              0,
              new Intent(USB_PERMISSION).setPackage(getPackageName()),
              PendingIntent.FLAG_IMMUTABLE);
      manager.requestPermission(selected, permission);
      return;
    }
    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
      return;
    getSharedPreferences("state", MODE_PRIVATE).edit().putBoolean("autoConnect", true).apply();
    startForegroundService(
        new Intent(this, MicrophoneService.class).putExtra("deviceName", selected.getDeviceName()));
  }
}
