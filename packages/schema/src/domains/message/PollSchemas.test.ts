// SPDX-License-Identifier: AGPL-3.0-or-later

import {GuildPollSettingsUpdateRequest, PollCreateRequest} from '@fluxer/schema/src/domains/message/PollSchemas';
import {describe, expect, it} from 'vitest';

const validPoll = {
	question: {text: 'Best editor?'},
	answers: [{text: 'vim'}, {text: 'emacs', emoji_name: '🧙'}],
	duration_hours: 24,
};

describe('PollCreateRequest', () => {
	it('accepts a minimal poll', () => {
		expect(PollCreateRequest.safeParse(validPoll).success).toBe(true);
	});

	it('requires at least two answers', () => {
		expect(PollCreateRequest.safeParse({...validPoll, answers: [{text: 'only'}]}).success).toBe(false);
	});

	it('rejects durations under an hour and over the ceiling', () => {
		expect(PollCreateRequest.safeParse({...validPoll, duration_hours: 0}).success).toBe(false);
		expect(PollCreateRequest.safeParse({...validPoll, duration_hours: 365 * 24 + 1}).success).toBe(false);
	});

	it('rejects an answer emoji that is not a single emoji', () => {
		const result = PollCreateRequest.safeParse({
			...validPoll,
			answers: [{text: 'a', emoji_name: 'not-emoji'}, {text: 'b'}],
		});
		expect(result.success).toBe(false);
	});

	it('lets an answer carry a custom emoji id without a name', () => {
		const result = PollCreateRequest.safeParse({
			...validPoll,
			answers: [{text: 'a', emoji_id: '1234567890'}, {text: 'b'}],
		});
		expect(result.success).toBe(true);
	});
});

describe('GuildPollSettingsUpdateRequest', () => {
	it('accepts a partial update', () => {
		expect(GuildPollSettingsUpdateRequest.safeParse({max_answers: 5}).success).toBe(true);
	});

	it('rejects values outside the hard ceilings', () => {
		expect(GuildPollSettingsUpdateRequest.safeParse({max_answers: 1}).success).toBe(false);
		expect(GuildPollSettingsUpdateRequest.safeParse({max_answers: 26}).success).toBe(false);
		expect(GuildPollSettingsUpdateRequest.safeParse({max_question_length: 1001}).success).toBe(false);
	});
});

describe('soundboard volume bounds', () => {
	it('allows boosting a sound up to 200%', async () => {
		const {GuildSoundboardSoundUpdateRequest} = await import('@fluxer/schema/src/domains/guild/GuildSoundboardSchemas');
		expect(GuildSoundboardSoundUpdateRequest.safeParse({volume: 1.5}).success).toBe(true);
		expect(GuildSoundboardSoundUpdateRequest.safeParse({volume: 2}).success).toBe(true);
		expect(GuildSoundboardSoundUpdateRequest.safeParse({volume: 2.01}).success).toBe(false);
	});
});
