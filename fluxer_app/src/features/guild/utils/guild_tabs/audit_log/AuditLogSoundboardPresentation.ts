// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
	AuditLogDetailRow,
	AuditLogDomainResult,
	AuditLogPlaceholder,
} from '@app/features/guild/utils/guild_tabs/audit_log/AuditLogPresentationTypes';
import {
	POLL_END_SUMMARY,
	SOUNDBOARD_SOUND_CREATE_SUMMARY,
	SOUNDBOARD_SOUND_CREATE_UNNAMED_SUMMARY,
	SOUNDBOARD_SOUND_DELETE_SUMMARY,
	SOUNDBOARD_SOUND_DELETE_UNNAMED_SUMMARY,
	SOUNDBOARD_SOUND_EMOJI_CHANGED_ROW,
	SOUNDBOARD_SOUND_NAME_CHANGED_ROW,
	SOUNDBOARD_SOUND_RENAME_SUMMARY,
	SOUNDBOARD_SOUND_UPDATE_SUMMARY,
	SOUNDBOARD_SOUND_UPDATE_UNNAMED_SUMMARY,
	SOUNDBOARD_SOUND_UPLOADER_ROW,
	SOUNDBOARD_SOUND_VOLUME_CHANGED_ROW,
} from '@app/features/guild/utils/guild_tabs/audit_log/AuditLogSoundboardMessages';
import {
	actorPlaceholder,
	readChange,
	readNumber,
	readSnowflake,
	readString,
} from '@app/features/guild/utils/guild_tabs/audit_log/AuditLogValues';
import type {GuildAuditLogEntryResponse} from '@fluxer/schema/src/domains/guild/GuildAuditLogSchemas';

function namePlaceholder(value: string): AuditLogPlaceholder {
	return {kind: 'name', value};
}

function readOldString(entry: GuildAuditLogEntryResponse, key: string): string | null {
	return readString(readChange(entry, key)?.oldValue);
}

function readNewString(entry: GuildAuditLogEntryResponse, key: string): string | null {
	return readString(readChange(entry, key)?.newValue);
}

function uploaderRows(entry: GuildAuditLogEntryResponse): Array<AuditLogDetailRow> {
	const creatorId = readSnowflake(readChange(entry, 'creator_id')?.oldValue);
	if (creatorId === null || creatorId === entry.user_id) return [];
	return [
		{
			id: 'uploader',
			tone: 'neutral',
			sentence: {descriptor: SOUNDBOARD_SOUND_UPLOADER_ROW, values: {user: {kind: 'user', id: creatorId}}},
		},
	];
}

export function presentSoundboardSoundCreate(entry: GuildAuditLogEntryResponse): AuditLogDomainResult {
	const actor = actorPlaceholder(entry);
	const name = readNewString(entry, 'name');
	return {
		summary:
			name === null
				? {descriptor: SOUNDBOARD_SOUND_CREATE_UNNAMED_SUMMARY, values: {actor}}
				: {descriptor: SOUNDBOARD_SOUND_CREATE_SUMMARY, values: {actor, name: namePlaceholder(name)}},
		rows: [],
		blocks: [],
	};
}

export function presentSoundboardSoundUpdate(entry: GuildAuditLogEntryResponse): AuditLogDomainResult {
	const actor = actorPlaceholder(entry);
	const oldName = readOldString(entry, 'name');
	const newName = readNewString(entry, 'name');
	const nameChanged = oldName !== null && newName !== null && oldName !== newName;
	const oldVolume = readNumber(readChange(entry, 'volume')?.oldValue);
	const newVolume = readNumber(readChange(entry, 'volume')?.newValue);
	const volumeChanged = oldVolume !== null && newVolume !== null && oldVolume !== newVolume;
	const emojiChanged = readChange(entry, 'emoji_id') !== null || readChange(entry, 'emoji_name') !== null;

	if (nameChanged && !volumeChanged && !emojiChanged) {
		return {
			summary: {
				descriptor: SOUNDBOARD_SOUND_RENAME_SUMMARY,
				values: {actor, oldName: namePlaceholder(oldName), newName: namePlaceholder(newName)},
			},
			rows: [],
			blocks: [],
		};
	}

	const rows: Array<AuditLogDetailRow> = [];
	if (nameChanged) {
		rows.push({
			id: 'name',
			tone: 'neutral',
			sentence: {
				descriptor: SOUNDBOARD_SOUND_NAME_CHANGED_ROW,
				values: {oldName: namePlaceholder(oldName), newName: namePlaceholder(newName)},
			},
		});
	}
	if (volumeChanged) {
		rows.push({
			id: 'volume',
			tone: 'neutral',
			sentence: {
				descriptor: SOUNDBOARD_SOUND_VOLUME_CHANGED_ROW,
				values: {oldVolume: Math.round(oldVolume * 100), newVolume: Math.round(newVolume * 100)},
			},
		});
	}
	if (emojiChanged) {
		rows.push({id: 'emoji', tone: 'neutral', sentence: {descriptor: SOUNDBOARD_SOUND_EMOJI_CHANGED_ROW, values: {}}});
	}

	const name = newName ?? oldName;
	return {
		summary:
			name === null
				? {descriptor: SOUNDBOARD_SOUND_UPDATE_UNNAMED_SUMMARY, values: {actor}}
				: {descriptor: SOUNDBOARD_SOUND_UPDATE_SUMMARY, values: {actor, name: namePlaceholder(name)}},
		rows,
		blocks: [],
	};
}

export function presentSoundboardSoundDelete(entry: GuildAuditLogEntryResponse): AuditLogDomainResult {
	const actor = actorPlaceholder(entry);
	const name = readOldString(entry, 'name');
	return {
		summary:
			name === null
				? {descriptor: SOUNDBOARD_SOUND_DELETE_UNNAMED_SUMMARY, values: {actor}}
				: {descriptor: SOUNDBOARD_SOUND_DELETE_SUMMARY, values: {actor, name: namePlaceholder(name)}},
		rows: uploaderRows(entry),
		blocks: [],
	};
}

export function presentPollEnd(entry: GuildAuditLogEntryResponse): AuditLogDomainResult {
	return {summary: {descriptor: POLL_END_SUMMARY, values: {actor: actorPlaceholder(entry)}}, rows: [], blocks: []};
}
