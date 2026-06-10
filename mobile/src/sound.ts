// Foreground message sound. Two jobs:
//
//  1. playMessageChime() — a short, soft chime played in-app when a message
//     lands in the conversation you're reading (driven off the SSE 'dm' event,
//     so it fires instantly and works even before push is provisioned).
//
//  2. active-thread tracking — the open DM thread registers itself here so the
//     push handler can stay silent for *that* thread's notifications (the chime
//     already covered them), while still sounding for every other notification.
//     This is what prevents a double "ding" when both SSE and a push arrive for
//     the same message.
//
// Audio is a nicety: every path is best-effort and swallows errors.

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

let activeDmThread: string | null = null;

/** The open DM thread sets this on focus (username) and clears it on blur. */
export function setActiveDmThread(username: string | null): void {
  activeDmThread = username;
}

/** Read by the push handler to suppress sound for the thread in the foreground. */
export function activeDmThreadName(): string | null {
  return activeDmThread;
}

let enabled = true;

/** Master switch — defaults on; a settings toggle can flip it (extension point). */
export function setMessageSoundEnabled(on: boolean): void {
  enabled = on;
}

export function messageSoundEnabled(): boolean {
  return enabled;
}

let player: AudioPlayer | null = null;

function ensurePlayer(): AudioPlayer | null {
  if (!player) {
    try {
      // Bundled asset (Metro resolves .wav as an asset by default).
      player = createAudioPlayer(require('../assets/message.wav'));
      player.volume = 0.7;
    } catch {
      player = null;
    }
  }
  return player;
}

/** Play the incoming-message chime. No-op when muted or audio is unavailable. */
export async function playMessageChime(): Promise<void> {
  if (!enabled) return;
  try {
    const p = ensurePlayer();
    if (!p) return;
    await p.seekTo(0);
    p.play();
  } catch {
    /* never fatal */
  }
}
