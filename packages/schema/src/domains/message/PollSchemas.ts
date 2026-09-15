// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	POLL_EMOJI_MAX_LENGTH,
	POLL_MAX_ANSWER_LENGTH_CEILING,
	POLL_MAX_ANSWERS_CEILING,
	POLL_MAX_DURATION_HOURS_CEILING,
	POLL_MAX_QUESTION_LENGTH_CEILING,
	POLL_MIN_ANSWERS,
	POLL_MIN_DURATION_HOURS,
	PollLayoutTypes,
} from '@fluxer/constants/src/PollConstants';
import {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {isValidSingleUnicodeEmoji} from '@fluxer/schema/src/primitives/EmojiValidators';
import {
	createStringType,
	Int32Type,
	SnowflakeStringType,
	SnowflakeType,
} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import {z} from 'zod';

// Request-side bounds are the instance *ceilings*; the effective limit
// (instance setting capped further by the community) is enforced in
// PollService with a proper error code, so clients get a useful message
// instead of a bare schema rejection.

const PollEmojiIdField = SnowflakeType.nullish().describe('ID of a custom emoji from this community');
const PollEmojiNameField = createStringType(1, POLL_EMOJI_MAX_LENGTH)
	.nullish()
	.describe('Unicode emoji character (ignored when emoji_id is provided)');

function hasNoEmojiOrValidEmoji(value: {emoji_id?: unknown; emoji_name?: unknown}): boolean {
	if (value.emoji_id != null) return true;
	if (value.emoji_name == null) return true;
	return typeof value.emoji_name === 'string' && isValidSingleUnicodeEmoji(value.emoji_name);
}

export const PollQuestionRequest = z.object({
	text: createStringType(1, POLL_MAX_QUESTION_LENGTH_CEILING).describe('The question being asked'),
});

export type PollQuestionRequest = z.infer<typeof PollQuestionRequest>;

export const PollAnswerRequest = z
	.object({
		text: createStringType(1, POLL_MAX_ANSWER_LENGTH_CEILING).describe('Answer label'),
		emoji_id: PollEmojiIdField,
		emoji_name: PollEmojiNameField,
	})
	.refine(hasNoEmojiOrValidEmoji, {
		message: 'An answer emoji must be a custom emoji id or a single Unicode emoji',
		path: ['emoji_name'],
	});

export type PollAnswerRequest = z.infer<typeof PollAnswerRequest>;

export const PollCreateRequest = z.object({
	question: PollQuestionRequest,
	answers: z
		.array(PollAnswerRequest)
		.min(POLL_MIN_ANSWERS)
		.max(POLL_MAX_ANSWERS_CEILING)
		.describe('The answers members can pick from'),
	duration_hours: z
		.number()
		.int()
		.min(POLL_MIN_DURATION_HOURS)
		.max(POLL_MAX_DURATION_HOURS_CEILING)
		.describe('How long the poll stays open, in hours'),
	allow_multiselect: z.boolean().optional().describe('Whether a member may pick more than one answer'),
	layout_type: z.literal(PollLayoutTypes.DEFAULT).optional().describe('Poll layout (only DEFAULT exists)'),
});

export type PollCreateRequest = z.infer<typeof PollCreateRequest>;

export const PollEmojiResponse = z.object({
	id: SnowflakeStringType.nullable(),
	name: z.string().nullable(),
	animated: z.boolean().optional(),
});

export type PollEmojiResponse = z.infer<typeof PollEmojiResponse>;

export const PollAnswerResponse = z.object({
	answer_id: Int32Type.describe('Position-based ID, stable for the life of the poll'),
	text: z.string(),
	emoji: PollEmojiResponse.nullable(),
});

export type PollAnswerResponse = z.infer<typeof PollAnswerResponse>;

export const PollAnswerCountResponse = z.object({
	id: Int32Type.describe('The answer_id this count belongs to'),
	count: Int32Type,
	me_voted: z.boolean(),
});

export type PollAnswerCountResponse = z.infer<typeof PollAnswerCountResponse>;

export const PollResultsResponse = z.object({
	is_finalized: z.boolean().describe('True once the poll has ended and counts are final'),
	answer_counts: z.array(PollAnswerCountResponse),
	total_voters: Int32Type.describe('Distinct members who voted'),
});

export type PollResultsResponse = z.infer<typeof PollResultsResponse>;

export const PollResponse = z.object({
	question: z.object({text: z.string()}),
	answers: z.array(PollAnswerResponse),
	expires_at: z.string().datetime(),
	allow_multiselect: z.boolean(),
	layout_type: z.literal(PollLayoutTypes.DEFAULT),
	results: PollResultsResponse,
});

export type PollResponse = z.infer<typeof PollResponse>;

export const PollAnswerVotersResponse = z.object({
	users: z.array(z.lazy(() => UserPartialResponse)),
});

export type PollAnswerVotersResponse = z.infer<typeof PollAnswerVotersResponse>;

export const PollAnswerVotersQuery = z.object({
	after: SnowflakeType.optional().describe('Return voters with an ID greater than this'),
	limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PollAnswerVotersQuery = z.infer<typeof PollAnswerVotersQuery>;

// Community settings (Community Settings → Polls). Each numeric value is
// additionally capped by the instance limit of the same name.
export const GuildPollSettingsResponse = z.object({
	enabled: z.boolean(),
	max_answers: Int32Type,
	max_question_length: Int32Type,
	max_answer_length: Int32Type,
	max_duration_hours: Int32Type,
	default_duration_hours: Int32Type,
	allow_multiselect: z.boolean(),
	// Instance ceilings, so the settings UI can show "instance limit: N".
	max_answers_ceiling: Int32Type,
	max_question_length_ceiling: Int32Type,
	max_answer_length_ceiling: Int32Type,
	max_duration_hours_ceiling: Int32Type,
	instance_enabled: z.boolean(),
});

export type GuildPollSettingsResponse = z.infer<typeof GuildPollSettingsResponse>;

export const GuildPollSettingsUpdateRequest = z.object({
	enabled: z.boolean().optional(),
	max_answers: z.number().int().min(POLL_MIN_ANSWERS).max(POLL_MAX_ANSWERS_CEILING).optional(),
	max_question_length: z.number().int().min(1).max(POLL_MAX_QUESTION_LENGTH_CEILING).optional(),
	max_answer_length: z.number().int().min(1).max(POLL_MAX_ANSWER_LENGTH_CEILING).optional(),
	max_duration_hours: z.number().int().min(POLL_MIN_DURATION_HOURS).max(POLL_MAX_DURATION_HOURS_CEILING).optional(),
	default_duration_hours: z.number().int().min(POLL_MIN_DURATION_HOURS).max(POLL_MAX_DURATION_HOURS_CEILING).optional(),
	allow_multiselect: z.boolean().optional(),
});

export type GuildPollSettingsUpdateRequest = z.infer<typeof GuildPollSettingsUpdateRequest>;
