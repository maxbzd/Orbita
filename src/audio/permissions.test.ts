import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_MESSAGES,
  MICROPHONE_MESSAGES,
  MicrophoneError,
  getMicrophoneAccess,
  probeMicrophone,
  requestMicrophone,
  toMicrophoneError,
  watchMicrophoneAccess,
} from './permissions';
import type { MicrophoneEnvironment } from './permissions';

const named = (name: string): Error => Object.assign(new Error(name), { name });

function environment(overrides: Partial<MicrophoneEnvironment> = {}): MicrophoneEnvironment {
  return {
    mediaDevices: { getUserMedia: vi.fn<MediaDevices['getUserMedia']>() },
    permissions: { query: vi.fn<Permissions['query']>() },
    isSecureContext: true,
    ...overrides,
  };
}

const status = (state: PermissionState): PermissionStatus => Object.assign(new EventTarget(), { state, name: 'microphone', onchange: null }) as unknown as PermissionStatus;

describe('toMicrophoneError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['DevicesNotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'aborted'],
    ['TypeError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ])('maps %s to %s', (name, code) => {
    const error = toMicrophoneError(named(name));
    expect(error).toBeInstanceOf(MicrophoneError);
    expect(error.code).toBe(code);
    expect(error.message).toBe(MICROPHONE_MESSAGES[code as keyof typeof MICROPHONE_MESSAGES]);
  });

  it('keeps a MicrophoneError as it is and survives values that are not errors', () => {
    const original = new MicrophoneError('busy');
    expect(toMicrophoneError(original)).toBe(original);
    expect(toMicrophoneError('boom').code).toBe('unknown');
    expect(toMicrophoneError(null).code).toBe('unknown');
  });

  it('explains every problem in Russian', () => {
    for (const message of [...Object.values(MICROPHONE_MESSAGES), ...Object.values(ACCESS_MESSAGES)]) {
      expect(message).toMatch(/[а-яё]/i);
    }
  });
});

describe('getMicrophoneAccess', () => {
  it('reports the permission state without asking', async () => {
    for (const state of ['granted', 'prompt', 'denied'] as const) {
      const env = environment({ permissions: { query: vi.fn().mockResolvedValue(status(state)) } });
      expect(await getMicrophoneAccess(env)).toBe(state);
      expect(env.mediaDevices?.getUserMedia).not.toHaveBeenCalled();
    }
  });

  it('says prompt where the Permissions API cannot tell (Safari, old Firefox)', async () => {
    expect(await getMicrophoneAccess(environment({ permissions: { query: vi.fn().mockRejectedValue(new TypeError('unknown name')) } }))).toBe('prompt');
    expect(await getMicrophoneAccess(environment({ permissions: undefined }))).toBe('prompt');
  });

  it('says unsupported without getUserMedia or on an insecure page', async () => {
    expect(await getMicrophoneAccess(environment({ mediaDevices: undefined }))).toBe('unsupported');
    expect(await getMicrophoneAccess(environment({ isSecureContext: false }))).toBe('unsupported');
  });
});

describe('watchMicrophoneAccess', () => {
  it('reports changes made in the browser settings until unsubscribed', async () => {
    const permission = status('prompt');
    const onChange = vi.fn();
    const stop = watchMicrophoneAccess(onChange, environment({ permissions: { query: vi.fn().mockResolvedValue(permission) } }));
    await Promise.resolve();
    await Promise.resolve();

    (permission as { state: PermissionState }).state = 'denied';
    permission.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('denied');

    stop();
    permission.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the permission cannot be queried', async () => {
    const stop = watchMicrophoneAccess(vi.fn(), environment({ permissions: { query: vi.fn().mockRejectedValue(new TypeError()) } }));
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});

describe('requestMicrophone', () => {
  it('asks for a mono, noise-suppressed stream and returns it', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockResolvedValue(stream);
    await expect(requestMicrophone(undefined, environment({ mediaDevices: { getUserMedia } }))).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ channelCount: 1, noiseSuppression: true }) });
  });

  it('rejects with a readable MicrophoneError', async () => {
    const getUserMedia = vi.fn<MediaDevices['getUserMedia']>().mockRejectedValue(named('NotAllowedError'));
    const error = await requestMicrophone(undefined, environment({ mediaDevices: { getUserMedia } })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MicrophoneError);
    expect(error).toMatchObject({ code: 'denied', message: expect.stringContaining('Нет доступа к микрофону') });
  });

  it('refuses early on an insecure page or without getUserMedia', async () => {
    await expect(requestMicrophone(undefined, environment({ isSecureContext: false }))).rejects.toMatchObject({ code: 'insecure' });
    await expect(requestMicrophone(undefined, environment({ mediaDevices: undefined }))).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('probeMicrophone', () => {
  it('closes the stream it opened to ask the question', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream;
    await probeMicrophone(environment({ mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } }));
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
