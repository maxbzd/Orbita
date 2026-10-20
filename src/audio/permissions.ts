import { t } from '../i18n';
export type MicrophoneAccess = 'granted' | 'prompt' | 'denied' | 'unsupported';

export type MicrophoneErrorCode = 'denied' | 'not-found' | 'busy' | 'insecure' | 'unsupported' | 'aborted' | 'unknown';

export const MICROPHONE_MESSAGES: Readonly<Record<MicrophoneErrorCode, string>> = {
  get denied() { return t('No microphone access. Allow it in the site settings (the lock icon next to the address) and try again.') },
  get 'not-found'() { return t('No microphone found. Connect one or check that it is turned on.') },
  get busy() { return t('The microphone is in use by another app. Close it (a call, another recording) and try again.') },
  get insecure() { return t('Audio recording works only on secure pages (https). Open the app through an https link.') },
  get unsupported() { return t('This browser cannot record audio. Open the app in a recent version of Chrome, Safari or Firefox.') },
  get aborted() { return t('Could not start the microphone. Please try again.') },
  get unknown() { return t('Could not get access to the microphone. Please try again.') },
};

/** getUserMedia failure with a message that can be shown to the user as it is. */
export class MicrophoneError extends Error {
  constructor(
    readonly code: MicrophoneErrorCode,
    message: string = MICROPHONE_MESSAGES[code],
  ) {
    super(message);
    this.name = 'MicrophoneError';
  }
}

/** What the user sees next to the microphone switch, per access state. */
export const ACCESS_MESSAGES: Readonly<Record<MicrophoneAccess, string>> = {
  get granted() { return t('Microphone allowed') },
  get prompt() { return t('The browser will ask for permission at the first recording') },
  denied: MICROPHONE_MESSAGES.denied,
  unsupported: MICROPHONE_MESSAGES.unsupported,
};

/** The parts of `navigator` this module touches: replaceable in tests. */
export interface MicrophoneEnvironment {
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  permissions?: Pick<Permissions, 'query'>;
  isSecureContext?: boolean;
}

function browserEnvironment(): MicrophoneEnvironment {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  return {
    mediaDevices: nav?.mediaDevices,
    permissions: nav?.permissions,
    isSecureContext: (globalThis as { isSecureContext?: boolean }).isSecureContext,
  };
}

/** Why recording cannot even be attempted here, if it cannot. */
function unavailability(env: MicrophoneEnvironment): MicrophoneError | undefined {
  if (env.isSecureContext === false) return new MicrophoneError('insecure');
  if (typeof env.mediaDevices?.getUserMedia !== 'function') return new MicrophoneError('unsupported');
  return undefined;
}

/** Maps what `getUserMedia` throws (DOMException names) to a `MicrophoneError`. */
export function toMicrophoneError(error: unknown): MicrophoneError {
  if (error instanceof MicrophoneError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new MicrophoneError('denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new MicrophoneError('not-found');
    case 'NotReadableError':
    case 'TrackStartError':
      return new MicrophoneError('busy');
    case 'AbortError':
      return new MicrophoneError('aborted');
    case 'TypeError':
      return new MicrophoneError('unsupported');
    default:
      return new MicrophoneError('unknown');
  }
}

/**
 * Current microphone permission without asking. Browsers that cannot tell (Safari, older Firefox)
 * report `prompt`: the question will simply be asked when recording starts.
 */
export async function getMicrophoneAccess(env: MicrophoneEnvironment = browserEnvironment()): Promise<MicrophoneAccess> {
  if (unavailability(env)) return 'unsupported';
  try {
    const status = await env.permissions?.query({ name: 'microphone' as PermissionName });
    return status?.state ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

/** Calls `onChange` whenever the user changes the permission in the browser; returns the unsubscribe function. */
export function watchMicrophoneAccess(
  onChange: (access: MicrophoneAccess) => void,
  env: MicrophoneEnvironment = browserEnvironment(),
): () => void {
  let stopped = false;
  let detach = (): void => {};
  void (async () => {
    try {
      const status = await env.permissions?.query({ name: 'microphone' as PermissionName });
      if (!status || stopped) return;
      const listener = (): void => onChange(status.state);
      status.addEventListener('change', listener);
      detach = () => status.removeEventListener('change', listener);
    } catch {
      // The Permissions API does not know "microphone" here: nothing to watch.
    }
  })();
  return () => {
    stopped = true;
    detach();
  };
}

/** Speech-tuned capture: one channel, with the browser's noise handling on. */
export const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

/** Asks for the microphone. Throws `MicrophoneError` with a Russian message. */
export async function requestMicrophone(
  constraints: MediaStreamConstraints = MICROPHONE_CONSTRAINTS,
  env: MicrophoneEnvironment = browserEnvironment(),
): Promise<MediaStream> {
  const problem = unavailability(env);
  if (problem) throw problem;
  try {
    return await env.mediaDevices!.getUserMedia(constraints);
  } catch (error) {
    throw toMicrophoneError(error);
  }
}

/** Asks for the microphone only to trigger the browser's question (onboarding): the stream is closed at once. */
export async function probeMicrophone(env: MicrophoneEnvironment = browserEnvironment()): Promise<void> {
  const stream = await requestMicrophone(MICROPHONE_CONSTRAINTS, env);
  for (const track of stream.getTracks()) track.stop();
}
