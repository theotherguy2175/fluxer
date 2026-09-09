// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildID, SoundboardSoundID} from '../../BrandedTypes';
import {deleteOneOrMany, fetchMany, fetchOne, upsertOne} from '../../database/CassandraQueryExecution';
import type {GuildSoundboardSettingsRow, GuildSoundboardSoundRow} from '../../database/types/GuildTypes';
import {GuildSoundboardSound} from '../../models/GuildSoundboardSound';
import {GuildSoundboardSettings, GuildSoundboardSounds} from '../../Tables';

const LIST_SOUNDS_CQL = GuildSoundboardSounds.selectCql({
	where: GuildSoundboardSounds.where.eq('guild_id'),
});
const FETCH_SOUND_CQL = GuildSoundboardSounds.selectCql({
	where: [GuildSoundboardSounds.where.eq('guild_id'), GuildSoundboardSounds.where.eq('sound_id')],
	limit: 1,
});
const FETCH_SETTINGS_CQL = GuildSoundboardSettings.selectCql({
	where: GuildSoundboardSettings.where.eq('guild_id'),
	limit: 1,
});

export class GuildSoundboardRepository {
	async listSounds(guildId: GuildID): Promise<Array<GuildSoundboardSound>> {
		const rows = await fetchMany<GuildSoundboardSoundRow>(LIST_SOUNDS_CQL, {guild_id: guildId});
		return rows.map((row) => new GuildSoundboardSound(row));
	}

	async countSounds(guildId: GuildID): Promise<number> {
		const rows = await fetchMany<GuildSoundboardSoundRow>(LIST_SOUNDS_CQL, {guild_id: guildId});
		return rows.length;
	}

	async getSound(guildId: GuildID, soundId: SoundboardSoundID): Promise<GuildSoundboardSound | null> {
		const row = await fetchOne<GuildSoundboardSoundRow>(FETCH_SOUND_CQL, {guild_id: guildId, sound_id: soundId});
		return row ? new GuildSoundboardSound(row) : null;
	}

	async upsertSound(sound: GuildSoundboardSound): Promise<GuildSoundboardSound> {
		await upsertOne(GuildSoundboardSounds.upsertAll(sound.toRow()));
		return sound;
	}

	async deleteSound(guildId: GuildID, soundId: SoundboardSoundID): Promise<void> {
		await deleteOneOrMany(GuildSoundboardSounds.deleteByPk({guild_id: guildId, sound_id: soundId}));
	}

	async getSettings(guildId: GuildID): Promise<GuildSoundboardSettingsRow | null> {
		return fetchOne<GuildSoundboardSettingsRow>(FETCH_SETTINGS_CQL, {guild_id: guildId});
	}

	async upsertSettings(settings: GuildSoundboardSettingsRow): Promise<GuildSoundboardSettingsRow> {
		await upsertOne(GuildSoundboardSettings.upsertAll(settings));
		return settings;
	}
}
