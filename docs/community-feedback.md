# Feedback post draft

Status: prepared for GitHub Community; not published.

Title: Feedback on Quipus: consent and controls for a three-button conversation recorder

## Post

I'm working on Quipus with Nathan, who developed the original application.
I've added support for a Waveshare ESP32-S3-LCD-1.54 recorder: a small screen,
microphones, speaker, three buttons and a microSD card.

The intended flow is to request consent, record a conversation, then review its
audio, transcript, brief and suggested follow-ups in a dashboard. Calendar
invitations remain a separate review-and-approve action. The recorder uses Wi-Fi
for uploads; Bluetooth setup is available through Chrome on Windows and Android.

Repository: https://github.com/jinchuntan/quipus
Hardware guide: https://github.com/jinchuntan/quipus/blob/main/hardware/lantern-firmware/WAVESHARE.md

I'd appreciate feedback on three practical questions:

1. Are the consent prompt, recording state and stop action clear enough for
   someone using this in an ordinary meeting?
2. With three physical buttons, does this mapping make sense: PLUS for
   record/report, PWR tap for quieter audio and hold for power, BOOT tap for
   louder audio? The README includes an orientation diagram.
3. What information would make offline saving and pending uploads easier to
   understand without adding more screens or controls?

This is a prototype. Portable tests cover the button gestures and audio limits,
but build checks don't establish microphone quality, radio pairing or long-term
reliability on the physical board. Comments on the documentation and state flow
are useful even without the hardware. Please use fictional examples rather than
sharing private recordings or credentials in replies.
