// SPDX-License-Identifier: AGPL-3.0-or-later

import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {
	SOUNDBOARD_DEFAULT_MAX_DURATION_MS,
	SOUNDBOARD_DEFAULT_MAX_SOUNDS,
} from '@fluxer/constants/src/SoundboardConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {createTestAccount} from '../../auth/tests/AuthTestUtils';
import {type ApiTestHarness, createApiTestHarness} from '../../test/ApiTestHarness';
import {HTTP_STATUS} from '../../test/TestConstants';
import {createBuilder} from '../../test/TestRequestBuilder';
import {addMemberRole, createChannel, createGuild, createRole, setupTestGuildWithMembers} from './GuildTestUtils';

const MANAGE_EXPRESSIONS = 1n << 30n;

const WAV_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(32)]);
const WAV_BASE64 = WAV_BYTES.toString('base64');

interface SoundboardSound {
	id: string;
	name: string;
	emoji_name: string | null;
	volume: number;
}

interface SoundboardLibrary {
	sounds: Array<SoundboardSound>;
	max_duration_ms: number;
	max_sounds: number;
	max_duration_ms_ceiling: number;
	max_sounds_ceiling: number;
	restart_on_repeat: boolean;
}

interface ValidationErrorBody {
	errors?: Array<{code?: string; path?: string}>;
}

interface AuditLogEntry {
	action_type: number;
	target_id: string | null;
}

async function uploadSound(
	harness: ApiTestHarness,
	token: string,
	guildId: string,
	name: string,
	emoji = '🔔',
): Promise<SoundboardSound> {
	return createBuilder<SoundboardSound>(harness, token)
		.post(`/guilds/${guildId}/soundboard-sounds`)
		.body({name, emoji_name: emoji, audio: WAV_BASE64})
		.expect(HTTP_STATUS.CREATED)
		.execute();
}

async function listAuditLog(
	harness: ApiTestHarness,
	token: string,
	guildId: string,
	actionType: number,
): Promise<Array<AuditLogEntry>> {
	const body = await createBuilder<{audit_log_entries: Array<AuditLogEntry>}>(harness, token)
		.get(`/guilds/${guildId}/audit-logs?action_type=${actionType}`)
		.execute();
	return body.audit_log_entries;
}

describe('Guild soundboard', () => {
	let harness: ApiTestHarness;
	beforeAll(async () => {
		harness = await createApiTestHarness();
	});
	afterAll(async () => {
		await harness?.shutdown();
	});
	beforeEach(async () => {
		await harness.reset();
	});

	it('returns an empty library with default limits for a fresh guild', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		const library = await createBuilder<SoundboardLibrary>(harness, owner.token)
			.get(`/guilds/${guild.id}/soundboard-sounds`)
			.execute();
		expect(library.sounds).toEqual([]);
		expect(library.max_sounds).toBe(SOUNDBOARD_DEFAULT_MAX_SOUNDS);
		expect(library.max_duration_ms).toBe(SOUNDBOARD_DEFAULT_MAX_DURATION_MS);
		expect(library.max_sounds_ceiling).toBe(SOUNDBOARD_DEFAULT_MAX_SOUNDS);
		expect(library.restart_on_repeat).toBe(false);
	});

	it('requires Manage Community to change soundboard settings', async () => {
		const {guild, members} = await setupTestGuildWithMembers(harness, 1);
		await createBuilder(harness, members[0]!.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({max_duration_ms: 3000, max_sounds: 5, restart_on_repeat: false})
			.expect(HTTP_STATUS.FORBIDDEN, 'MISSING_PERMISSIONS')
			.execute();
	});

	it('rejects a soundboard limit above the instance ceiling', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		const {json} = await createBuilder<ValidationErrorBody>(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({
				max_duration_ms: SOUNDBOARD_DEFAULT_MAX_DURATION_MS,
				max_sounds: SOUNDBOARD_DEFAULT_MAX_SOUNDS + 50,
				restart_on_repeat: false,
			})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.executeWithResponse();
		expect(json.errors?.[0]?.code).toBe(ValidationErrorCodes.SOUNDBOARD_SETTING_EXCEEDS_INSTANCE_LIMIT);
	});

	it('saves valid settings and reflects them in the library response', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		await createBuilder(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({max_duration_ms: 2500, max_sounds: 4, restart_on_repeat: true})
			.expect(HTTP_STATUS.OK)
			.execute();
		const library = await createBuilder<SoundboardLibrary>(harness, owner.token)
			.get(`/guilds/${guild.id}/soundboard-sounds`)
			.execute();
		expect(library.max_duration_ms).toBe(2500);
		expect(library.max_sounds).toBe(4);
		expect(library.restart_on_repeat).toBe(true);
	});

	it('will not lower the sound limit below the number already uploaded', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		await uploadSound(harness, owner.token, guild.id, 'one');
		await uploadSound(harness, owner.token, guild.id, 'two');
		const {json} = await createBuilder<ValidationErrorBody>(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({max_duration_ms: SOUNDBOARD_DEFAULT_MAX_DURATION_MS, max_sounds: 1, restart_on_repeat: false})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.executeWithResponse();
		expect(json.errors?.[0]?.code).toBe(ValidationErrorCodes.SOUNDBOARD_MAX_SOUNDS_BELOW_INSTALLED);
	});

	it('requires Create Expressions to upload a sound', async () => {
		const {guild, members} = await setupTestGuildWithMembers(harness, 1);
		await createBuilder(harness, members[0]!.token)
			.post(`/guilds/${guild.id}/soundboard-sounds`)
			.body({name: 'nope', emoji_name: '🔔', audio: WAV_BASE64})
			.expect(HTTP_STATUS.FORBIDDEN, 'MISSING_PERMISSIONS')
			.execute();
	});

	it('rejects an upload without an emoji', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		await createBuilder(harness, owner.token)
			.post(`/guilds/${guild.id}/soundboard-sounds`)
			.body({name: 'no emoji', audio: WAV_BASE64})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.execute();
	});

	it('enforces the sound quota', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		await createBuilder(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({max_duration_ms: SOUNDBOARD_DEFAULT_MAX_DURATION_MS, max_sounds: 1, restart_on_repeat: false})
			.expect(HTTP_STATUS.OK)
			.execute();
		await uploadSound(harness, owner.token, guild.id, 'first');
		const {json} = await createBuilder<ValidationErrorBody>(harness, owner.token)
			.post(`/guilds/${guild.id}/soundboard-sounds`)
			.body({name: 'second', emoji_name: '🔔', audio: WAV_BASE64})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.executeWithResponse();
		expect(json.errors?.[0]?.code).toBe(ValidationErrorCodes.SOUNDBOARD_SOUND_QUOTA_REACHED);
	});

	it('rejects a sound longer than the community limit', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		await createBuilder(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-settings`)
			.body({max_duration_ms: 500, max_sounds: SOUNDBOARD_DEFAULT_MAX_SOUNDS, restart_on_repeat: false})
			.expect(HTTP_STATUS.OK)
			.execute();
		const {json} = await createBuilder<ValidationErrorBody>(harness, owner.token)
			.post(`/guilds/${guild.id}/soundboard-sounds`)
			.body({name: 'too long', emoji_name: '🔔', audio: WAV_BASE64})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.executeWithResponse();
		expect(json.errors?.[0]?.code).toBe(ValidationErrorCodes.SOUNDBOARD_SOUND_DURATION_EXCEEDS_LIMIT);
	});

	it('uploads, updates, and deletes a sound and records each in the audit log', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');

		const created = await uploadSound(harness, owner.token, guild.id, 'airhorn');
		expect(created.name).toBe('airhorn');
		expect(await listAuditLog(harness, owner.token, guild.id, AuditLogActionType.SOUNDBOARD_SOUND_CREATE)).toEqual([
			expect.objectContaining({target_id: created.id}),
		]);

		const updated = await createBuilder<SoundboardSound>(harness, owner.token)
			.patch(`/guilds/${guild.id}/soundboard-sounds/${created.id}`)
			.body({name: 'renamed', volume: 0.4})
			.expect(HTTP_STATUS.OK)
			.execute();
		expect(updated.name).toBe('renamed');
		expect(updated.volume).toBe(0.4);
		expect(await listAuditLog(harness, owner.token, guild.id, AuditLogActionType.SOUNDBOARD_SOUND_UPDATE)).toEqual([
			expect.objectContaining({target_id: created.id}),
		]);

		await createBuilder(harness, owner.token)
			.delete(`/guilds/${guild.id}/soundboard-sounds/${created.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
		const library = await createBuilder<SoundboardLibrary>(harness, owner.token)
			.get(`/guilds/${guild.id}/soundboard-sounds`)
			.execute();
		expect(library.sounds).toEqual([]);
		expect(await listAuditLog(harness, owner.token, guild.id, AuditLogActionType.SOUNDBOARD_SOUND_DELETE)).toEqual([
			expect.objectContaining({target_id: created.id}),
		]);
	});

	it('lets a non-creator with Manage Expressions delete a sound', async () => {
		const {owner, members, guild} = await setupTestGuildWithMembers(harness, 1);
		const moderator = members[0]!;
		const role = await createRole(harness, owner.token, guild.id, {
			name: 'Expressions',
			permissions: MANAGE_EXPRESSIONS.toString(),
		});
		await addMemberRole(harness, owner.token, guild.id, moderator.userId, role.id);
		const sound = await uploadSound(harness, owner.token, guild.id, 'ownersound');
		await createBuilder(harness, moderator.token)
			.delete(`/guilds/${guild.id}/soundboard-sounds/${sound.id}`)
			.expect(HTTP_STATUS.NO_CONTENT)
			.execute();
	});

	it('rejects playing a sound when the caller is not connected to the channel', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Soundboard');
		const voice = await createChannel(harness, owner.token, guild.id, 'Voice', 2);
		const {json} = await createBuilder<ValidationErrorBody>(harness, owner.token)
			.post(`/voice/channels/${voice.id}/soundboard-sound`)
			.body({sound_id: '1234567890123456789'})
			.expect(HTTP_STATUS.BAD_REQUEST)
			.executeWithResponse();
		expect(json.errors?.[0]?.code).toBe(ValidationErrorCodes.USER_NOT_IN_CHANNEL);
	});
});
