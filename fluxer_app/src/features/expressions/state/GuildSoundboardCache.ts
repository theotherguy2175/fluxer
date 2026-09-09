// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {sortBySnowflakeDesc} from '@fluxer/snowflake/src/SnowflakeUtils';

export interface CachedSoundboardLimits {
	maxDurationMs: number;
	maxSounds: number;
}

type SoundboardUpdateListener = (sounds: ReadonlyArray<GuildSoundboardSoundResponse>) => void;

const MAX_GUILD_SOUNDBOARD_CACHE_ENTRIES = 50;

const soundboardCache = new Map<string, ReadonlyArray<GuildSoundboardSoundResponse>>();
const soundboardLimitsCache = new Map<string, CachedSoundboardLimits>();
const soundboardAccessSequence = new Set<string>();
const soundboardListeners = new Map<string, Set<SoundboardUpdateListener>>();

function setCache(guildId: string, value: ReadonlyArray<GuildSoundboardSoundResponse>, shouldNotify: boolean): void {
	const frozen = Object.freeze(sortBySnowflakeDesc([...value]));
	soundboardCache.set(guildId, frozen);
	soundboardAccessSequence.delete(guildId);
	soundboardAccessSequence.add(guildId);
	evictCacheIfNeeded();
	if (shouldNotify) {
		const listeners = soundboardListeners.get(guildId);
		if (listeners) {
			for (const listener of listeners) listener(frozen);
		}
	}
}

function evictCacheIfNeeded(): void {
	for (const guildId of soundboardAccessSequence) {
		if (!soundboardCache.has(guildId)) {
			soundboardAccessSequence.delete(guildId);
		}
	}
	while (soundboardCache.size > MAX_GUILD_SOUNDBOARD_CACHE_ENTRIES) {
		const guildId = soundboardAccessSequence.values().next().value;
		if (guildId == null) break;
		soundboardCache.delete(guildId);
		soundboardLimitsCache.delete(guildId);
		soundboardAccessSequence.delete(guildId);
	}
}

export function getCachedGuildSoundboardSounds(guildId: string): ReadonlyArray<GuildSoundboardSoundResponse> {
	return soundboardCache.get(guildId) ?? [];
}

export function getCachedGuildSoundboardLimits(guildId: string): CachedSoundboardLimits | null {
	return soundboardLimitsCache.get(guildId) ?? null;
}

export function seedGuildSoundboardCache(
	guildId: string,
	sounds: ReadonlyArray<GuildSoundboardSoundResponse>,
	limits?: CachedSoundboardLimits,
): void {
	setCache(guildId, sounds, false);
	if (limits) soundboardLimitsCache.set(guildId, limits);
}

export function subscribeToGuildSoundboardUpdates(guildId: string, listener: SoundboardUpdateListener): () => void {
	let listenersForGuild = soundboardListeners.get(guildId);
	if (!listenersForGuild) {
		listenersForGuild = new Set();
		soundboardListeners.set(guildId, listenersForGuild);
	}
	listenersForGuild.add(listener);
	return () => {
		listenersForGuild?.delete(listener);
		if (listenersForGuild && listenersForGuild.size === 0) {
			soundboardListeners.delete(guildId);
		}
	};
}

export function updateGuildSoundboardCacheFromGateway(
	guildId: string,
	sounds: ReadonlyArray<GuildSoundboardSoundResponse>,
): void {
	setCache(guildId, sounds, true);
}
