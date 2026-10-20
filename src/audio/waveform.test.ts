import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRepo, capturesRepo } from '../db';
import { wipeAll } from '../db/maintenance';
import {
  DEFAULT_BUCKETS,
  MAX_DECODE_BYTES,
  WaveformError,
  clearWaveformCache,
  computePeaks,
  computeWaveform,
  decodeWithBrowser,
  getWaveform,
} from './waveform';
import type { DecodeAudio, DecodedAudio } from './waveform';

beforeEach(async () => {
  await wipeAll();
  clearWaveformCache();
});
afterEach(() => vi.unstubAllGlobals());

const audio = (channels: number[][], duration = 2): DecodedAudio => ({
  duration,
  numberOfChannels: channels.length,
  getChannelData: (channel) => Float32Array.from(channels[channel]!),
});

describe('computePeaks', () => {
  it('takes the loudest sample of each slice and scales so the loudest slice is 1', () => {
    const samples = [0.1, -0.2, 0.05, 0, 0.4, -0.8, 0, 0];
    expect(computePeaks([samples], 4)).toEqual([0.25, 0.0625, 1, 0]);
  });

  it('merges channels by the louder one', () => {
    expect(computePeaks([[0.5, 0, 0, 0], [0, 0, 0, 1]], 2)).toEqual([0.5, 1]);
  });

  it('returns zeros for silence and for no audio at all', () => {
    expect(computePeaks([new Float32Array(100)], 5)).toEqual([0, 0, 0, 0, 0]);
    expect(computePeaks([], 3)).toEqual([0, 0, 0]);
    expect(computePeaks([[]], 3)).toEqual([0, 0, 0]);
    expect(computePeaks([[1, 1]], 0)).toEqual([]);
  });

  it('copes with fewer samples than bars', () => {
    const peaks = computePeaks([[0.5, 1]], 6);
    expect(peaks).toHaveLength(6);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks.every((peak) => peak >= 0 && peak <= 1)).toBe(true);
  });

  it('covers a long recording with the requested number of bars', () => {
    const long = Float32Array.from({ length: 480_000 }, (_, index) => Math.sin(index / 50) * (index > 240_000 ? 1 : 0.1));
    const peaks = computePeaks([long]);
    expect(peaks).toHaveLength(DEFAULT_BUCKETS);
    expect(peaks[0]).toBeCloseTo(0.1, 1);
    expect(peaks[DEFAULT_BUCKETS - 1]).toBeCloseTo(1, 1);
  });
});

describe('computeWaveform', () => {
  it('decodes a blob and returns its peaks and duration', async () => {
    const decode = vi.fn<DecodeAudio>().mockResolvedValue(audio([[0, 0.5, 0, 1]], 3.5));
    const waveform = await computeWaveform(new Blob(['audio-bytes']), { buckets: 2, decode });
    expect(waveform).toEqual({ peaks: [0.5, 1], durationSec: 3.5 });
    const given = decode.mock.calls[0]![0];
    expect(new TextDecoder().decode(given)).toBe('audio-bytes');
  });

  it('turns a decoding failure into a readable WaveformError', async () => {
    const decode: DecodeAudio = () => Promise.reject(new DOMException('bad data', 'EncodingError'));
    const error = await computeWaveform(new Blob(['x']), { decode }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WaveformError);
    expect(error).toMatchObject({ message: 'Не удалось построить волну записи' });
  });

  it('refuses files too big to decode into memory', async () => {
    const decode = vi.fn<DecodeAudio>();
    const huge = { size: MAX_DECODE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;
    await expect(computeWaveform(huge, { decode })).rejects.toThrow('слишком длинная');
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('decodeWithBrowser', () => {
  it('says so where there is no Web Audio', async () => {
    await expect(decodeWithBrowser(new ArrayBuffer(1))).rejects.toThrow('Браузер не умеет разбирать звук');
  });

  /** An OfflineAudioContext that refuses sample rates below `minRate`, and remembers the one it accepted. */
  function stubContext(minRate: number): number[] {
    const accepted: number[] = [];
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        constructor(_channels: number, _length: number, rate: number) {
          if (rate < minRate) throw new DOMException('unsupported rate', 'NotSupportedError');
          accepted.push(rate);
        }
        decodeAudioData = async () => audio([[1]]);
      },
    );
    return accepted;
  }

  it('decodes at 8 kHz, which keeps the PCM small', async () => {
    const accepted = stubContext(3_000);
    expect((await decodeWithBrowser(new ArrayBuffer(1))).numberOfChannels).toBe(1);
    expect(accepted).toEqual([8_000]);
  });

  it('takes a higher rate where the browser refuses low ones (older Safari)', async () => {
    const accepted = stubContext(22_050);
    await decodeWithBrowser(new ArrayBuffer(1));
    expect(accepted).toEqual([22_050]);
  });

  it('gives up with a readable error when no rate is accepted', async () => {
    stubContext(96_000);
    await expect(decodeWithBrowser(new ArrayBuffer(1))).rejects.toThrow('Браузер не умеет разбирать звук');
  });
});

describe('getWaveform', () => {
  async function storeAudio(text = 'sound') {
    const capture = await capturesRepo.create({ kind: 'voice', status: 'raw' });
    await audioRepo.save(capture.id, new Blob([text], { type: 'audio/webm' }));
    return (await capturesRepo.get(capture.id))!.audioId!;
  }

  it('loads the stored audio and computes the waveform once, however many ask', async () => {
    const audioId = await storeAudio();
    const decode = vi.fn<DecodeAudio>().mockResolvedValue(audio([[0.2, 0.4]], 1));

    const [first, second] = await Promise.all([getWaveform(audioId, { buckets: 2, decode }), getWaveform(audioId, { buckets: 2, decode })]);
    const third = await getWaveform(audioId, { buckets: 2, decode });

    expect(first).toEqual({ peaks: [0.5, 1], durationSec: 1 });
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('computes separately for a different number of bars', async () => {
    const audioId = await storeAudio();
    const decode = vi.fn<DecodeAudio>().mockImplementation(async () => audio([[0.2, 0.4, 0.6, 0.8]]));
    const coarse = await getWaveform(audioId, { buckets: 2, decode });
    const fine = await getWaveform(audioId, { buckets: 4, decode });
    expect(coarse.peaks).toHaveLength(2);
    expect(fine.peaks).toHaveLength(4);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('fails for audio that does not exist, and does not remember a failure', async () => {
    await expect(getWaveform('missing')).rejects.toThrow('Запись не найдена');

    const audioId = await storeAudio();
    const decode = vi.fn<DecodeAudio>().mockRejectedValueOnce(new Error('corrupt')).mockResolvedValue(audio([[1]]));
    await expect(getWaveform(audioId, { decode })).rejects.toBeInstanceOf(WaveformError);
    await expect(getWaveform(audioId, { decode })).resolves.toMatchObject({ durationSec: 2 });
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('forgets the least recently used waveform when the cache is full', async () => {
    const decode = vi.fn<DecodeAudio>().mockResolvedValue(audio([[1]]));
    const first = await storeAudio('first');
    await getWaveform(first, { decode });
    for (let index = 0; index < 40; index++) await getWaveform(await storeAudio(`audio-${index}`), { decode });
    expect(decode).toHaveBeenCalledTimes(41);

    await getWaveform(first, { decode });
    expect(decode).toHaveBeenCalledTimes(42);
  });
});
