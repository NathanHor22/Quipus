/* Embedded in both setup pages; the destination comes from the firmware API URL. */
(function () {
  "use strict";
  var started = false;
  window.quipusSetupReturn = function () {
    if (started) return;
    started = true;
    var link = document.querySelector("[data-quipus-dashboard]");
    var notice = document.getElementById("return-state");
    var destination = new URL(link.href);
    var deadline = Date.now() + 120000, timer, image, timeout, finished = false;

    function stop() {
      finished = true;
      clearTimeout(timer); clearTimeout(timeout);
      if (image) { image.onload = null; image.onerror = null; }
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    }
    function retry() {
      if (finished || document.hidden) return;
      clearTimeout(timer);
      if (image) return;
      if (Date.now() >= deadline) {
        stop();
        notice.textContent = "After reconnecting this phone or laptop to normal internet, choose Return to Quipus.";
        return;
      }
      // A new URL prevents a cached image from falsely certifying internet access.
      // No Wi-Fi credentials or pairing code are sent to the public website.
      image = new Image();
      image.referrerPolicy = "no-referrer";
      function unavailable() {
        clearTimeout(timeout);
        image.onload = null; image.onerror = null; image = null;
        if (!finished) timer = setTimeout(retry, 5000);
      }
      image.onload = function () {
        stop();
        notice.textContent = "Opening your Quipus dashboard…";
        window.location.replace(destination.href);
      };
      image.onerror = unavailable;
      timeout = setTimeout(unavailable, 5000);
      image.src = destination.origin + "/quipus-icon-192.png?setup=" + Date.now();
    }
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("pagehide", stop, { once: true });
    timer = setTimeout(retry, 1500);
  };
  if (document.querySelector("[data-return-auto]")) window.quipusSetupReturn();
}());
