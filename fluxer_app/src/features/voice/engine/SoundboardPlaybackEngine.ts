// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import StreamerMode from '@app/features/streamer_mode/state/StreamerMode';
import Sound from '@app/features/ui/state/Sound';
import {getEffectiveAudioState} from '@app/features/voice/engine/VoiceEffectiveAudioState';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';
import {SOUNDBOARD_MAX_VOLUME} from '@fluxer/constants/src/SoundboardConstants';

const logger = new Logger('SoundboardPlaybackEngine');

const BUFFER_CACHE_LIMIT = 16;
const MAX_MASTER_VOLUME_PERCENT = 200;
const MAX_GAIN = 4;

interface PlayParams {
	hash: string;
	url: string;
	volume?: number;
	restartOnRepeat?: boolean;
}

class SoundboardPlaybackEngine {
	private audioContext: AudioContext | null = null;
	private bufferCache: Map<string, AudioBuffer> = new Map();
	private activeSources: Map<string, Set<AudioBufferSourceNode>> = new Map();
	private lastAppliedSinkId: string | null = null;

	private ensureContext(): AudioContext | null {
		if (typeof window === 'undefined') return null;
		if (this.audioContext && this.audioContext.state !== 'closed') {
			if (this.audioContext.state === 'suspended') {
				void this.audioContext.resume().catch((error) => {
					logger.debug('Soundboard AudioContext resume rejected', {error});
				});
			}
			return this.audioContext;
		}
		const Ctor =
			window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
		if (!Ctor) return null;
		try {
			this.audioContext = new Ctor({latencyHint: 'interactive'});
			this.lastAppliedSinkId = null;
			return this.audioContext;
		} catch (error) {
			logger.warn('Failed to create AudioContext', {error});
			return null;
		}
	}

	private async fetchAndDecode(url: string, hash: string): Promise<AudioBuffer | null> {
		const cached = this.bufferCache.get(hash);
		if (cached) {
			this.bufferCache.delete(hash);
			this.bufferCache.set(hash, cached);
			return cached;
		}
		const ctx = this.ensureContext();
		if (!ctx) return null;
		try {
			const response = await fetch(url, {cache: 'force-cache'});
			if (!response.ok) {
				logger.warn('Soundboard sound fetch failed', {url, status: response.status});
				return null;
			}
			const bytes = await response.arrayBuffer();
			const buffer = await ctx.decodeAudioData(bytes);
			this.bufferCache.set(hash, buffer);
			while (this.bufferCache.size > BUFFER_CACHE_LIMIT) {
				const firstKey = this.bufferCache.keys().next().value;
				if (!firstKey) break;
				this.bufferCache.delete(firstKey);
			}
			return buffer;
		} catch (error) {
			logger.warn('Soundboard sound decode failed', {url, error});
			return null;
		}
	}

	private getMasterVolumeMultiplier(): number {
		return Math.max(0, Math.min(MAX_MASTER_VOLUME_PERCENT, Sound.getMasterVolume())) / 100;
	}

	private applyOutputDevice(ctx: AudioContext): void {
		const deviceId = VoiceSettings.getOutputDeviceId();
		const sinkId = !deviceId || deviceId === 'default' ? '' : deviceId;
		if (sinkId === this.lastAppliedSinkId) return;
		if (sinkId === '' && this.lastAppliedSinkId === null) return;
		const sinkableContext = ctx as AudioContext & {setSinkId?: (sinkId: string) => Promise<void>};
		if (typeof sinkableContext.setSinkId !== 'function') return;
		const previousSinkId = this.lastAppliedSinkId;
		this.lastAppliedSinkId = sinkId;
		void sinkableContext.setSinkId(sinkId).catch((error) => {
			this.lastAppliedSinkId = previousSinkId;
			logger.debug('Failed to apply output device to soundboard context', {sinkId, error});
		});
	}

	private stopActiveSources(hash: string): void {
		const sources = this.activeSources.get(hash);
		if (!sources) return;
		for (const source of sources) {
			source.onended = null;
			try {
				source.stop();
			} catch {}
		}
		this.activeSources.delete(hash);
	}

	async play(params: PlayParams): Promise<void> {
		const {hash, url} = params;
		const soundVolume = Math.max(0, Math.min(SOUNDBOARD_MAX_VOLUME, params.volume ?? 1));
		if (getEffectiveAudioState().effectiveDeaf) return;
		if (StreamerMode.shouldDisableSounds) return;
		if (!Sound.getSoundEnabled()) return;
		const ctx = this.ensureContext();
		if (!ctx) return;
		this.applyOutputDevice(ctx);
		if (params.restartOnRepeat) {
			this.stopActiveSources(hash);
		}
		const buffer = await this.fetchAndDecode(url, hash);
		if (!buffer) return;
		const outputVolumePct = VoiceSettings.getOutputVolume();
		// Chain: voice output volume × app sounds master × this member's soundboard
		// slider × the sound's own volume (which may exceed 1). Hard-capped so a
		// stack of boosts cannot blow out the output.
		const soundboardVolume = VoiceSettings.getSoundboardVolume() / 100;
		const gainValue = Math.max(
			0,
			Math.min(MAX_GAIN, (outputVolumePct / 100) * this.getMasterVolumeMultiplier() * soundboardVolume * soundVolume),
		);
		try {
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			const gain = ctx.createGain();
			gain.gain.value = gainValue;
			source.connect(gain).connect(ctx.destination);
			let sources = this.activeSources.get(hash);
			if (!sources) {
				sources = new Set();
				this.activeSources.set(hash, sources);
			}
			sources.add(source);
			source.onended = () => {
				const current = this.activeSources.get(hash);
				if (!current) return;
				current.delete(source);
				if (current.size === 0) {
					this.activeSources.delete(hash);
				}
			};
			source.start();
		} catch (error) {
			logger.warn('Failed to play soundboard sound', {hash, error});
		}
	}

	async fetchBuffer(url: string, hash: string): Promise<AudioBuffer | null> {
		return this.fetchAndDecode(url, hash);
	}
}

const instance = new SoundboardPlaybackEngine();

export default instance;
