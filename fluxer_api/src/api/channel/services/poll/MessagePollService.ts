// SPDX-License-Identifier: AGPL-3.0-or-later

import {
	type ChannelID,
	createEmojiID,
	createMessageID,
	type GuildID,
	type MessageID,
	type UserID,
} from '@app/api/BrandedTypes';
import type {IChannelRepository} from '@app/api/channel/IChannelRepository';
import type {AuthenticatedChannel} from '@app/api/channel/services/AuthenticatedChannel';
import {dispatchChannelEvent} from '@app/api/channel/services/ChannelGatewayDispatch';
import {MessageInteractionBase} from '@app/api/channel/services/interaction/MessageInteractionBase';
import type {MessageDispatchService} from '@app/api/channel/services/message/MessageDispatchService';
import type {MessagePersistenceService} from '@app/api/channel/services/message/MessagePersistenceService';
import {MessagePollAuthService} from '@app/api/channel/services/poll/MessagePollAuthService';
import {MessagePollRepository} from '@app/api/channel/services/poll/MessagePollRepository';
import {buildPollResponse} from '@app/api/channel/services/poll/MessagePollResponseBuilder';
import type {GuildPollSettingsRow, MessagePollAnswerItem} from '@app/api/database/types/PollTypes';
import type {GuildAuditLogService} from '@app/api/guild/GuildAuditLogService';
import type {IGuildRepositoryAggregate} from '@app/api/guild/repositories/IGuildRepositoryAggregate';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import {Logger} from '@app/api/Logger';
import type {LimitConfigService} from '@app/api/limits/LimitConfigService';
import {resolveLimitSafe} from '@app/api/limits/LimitConfigUtils';
import {createLimitMatchContext} from '@app/api/limits/LimitMatchContextBuilder';
import type {RequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import {createRequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import {MessagePoll} from '@app/api/models/MessagePoll';
import type {IUserRepository} from '@app/api/user/IUserRepository';
import {requirePermission} from '@app/api/utils/PermissionUtils';
import {AuditLogActionType} from '@fluxer/constants/src/AuditLogActionType';
import {MessageReferenceTypes, MessageTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	POLL_DEFAULT_DURATION_HOURS,
	POLL_DEFAULT_MAX_ANSWER_LENGTH,
	POLL_DEFAULT_MAX_ANSWERS,
	POLL_DEFAULT_MAX_DURATION_HOURS,
	POLL_DEFAULT_MAX_QUESTION_LENGTH,
	POLL_MIN_ANSWERS,
	POLL_MIN_DURATION_HOURS,
	PollLayoutTypes,
} from '@fluxer/constants/src/PollConstants';
import {ValidationErrorCodes} from '@fluxer/constants/src/ValidationErrorCodes';
import {UnknownMessageError} from '@fluxer/errors/src/domains/channel/UnknownMessageError';
import {FeatureTemporarilyDisabledError} from '@fluxer/errors/src/domains/core/FeatureTemporarilyDisabledError';
import {InputValidationError} from '@fluxer/errors/src/domains/core/InputValidationError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import type {
	GuildPollSettingsResponse,
	GuildPollSettingsUpdateRequest,
	PollAnswerVotersResponse,
	PollCreateRequest,
	PollResponse,
} from '@fluxer/schema/src/domains/message/PollSchemas';
import {isValidSingleUnicodeEmoji} from '@fluxer/schema/src/primitives/EmojiValidators';
import {snowflakeToDate} from '@fluxer/snowflake/src/Snowflake';

const HOUR_MS = 60 * 60 * 1000;
const EXPIRY_LOOKBACK_DAYS = 3;
const EXPIRY_FETCH_LIMIT = 200;

export interface InstancePollLimits {
	enabled: boolean;
	maxAnswers: number;
	maxQuestionLength: number;
	maxAnswerLength: number;
	maxDurationHours: number;
}

export interface EffectivePollLimits extends InstancePollLimits {
	instanceEnabled: boolean;
	defaultDurationHours: number;
	allowMultiselect: boolean;
	maxAnswersCeiling: number;
	maxQuestionLengthCeiling: number;
	maxAnswerLengthCeiling: number;
	maxDurationHoursCeiling: number;
}

export interface PreparedPoll {
	questionText: string;
	answers: Array<MessagePollAnswerItem>;
	allowMultiselect: boolean;
	allowVoteChange: boolean;
	expiresAt: Date;
}

export class MessagePollService extends MessageInteractionBase {
	readonly authService: MessagePollAuthService;
	private readonly repository = new MessagePollRepository();

	constructor(
		gatewayService: IGatewayService,
		private readonly channelRepository: IChannelRepository,
		userRepository: IUserRepository,
		private readonly guildRepository: IGuildRepositoryAggregate,
		private readonly userCacheService: UserCacheService,
		private readonly snowflakeService: ISnowflakeService,
		private readonly limitConfigService: LimitConfigService,
		private readonly auditLogService: GuildAuditLogService,
		private readonly persistenceService: MessagePersistenceService,
		private readonly dispatchService: MessageDispatchService,
	) {
		super(gatewayService);
		this.authService = new MessagePollAuthService(channelRepository, userRepository, guildRepository, gatewayService);
	}

	// ---------------------------------------------------------------- limits

	instanceLimits(): InstancePollLimits {
		const snapshot = this.limitConfigService.getConfigSnapshot();
		const ctx = createLimitMatchContext({user: null});
		return {
			enabled: resolveLimitSafe(snapshot, ctx, 'feature_message_polls', 1, 'guild') !== 0,
			maxAnswers: resolveLimitSafe(snapshot, ctx, 'max_poll_answers', POLL_DEFAULT_MAX_ANSWERS, 'guild'),
			maxQuestionLength: resolveLimitSafe(
				snapshot,
				ctx,
				'max_poll_question_length',
				POLL_DEFAULT_MAX_QUESTION_LENGTH,
				'guild',
			),
			maxAnswerLength: resolveLimitSafe(
				snapshot,
				ctx,
				'max_poll_answer_length',
				POLL_DEFAULT_MAX_ANSWER_LENGTH,
				'guild',
			),
			maxDurationHours: resolveLimitSafe(
				snapshot,
				ctx,
				'max_poll_duration_hours',
				POLL_DEFAULT_MAX_DURATION_HOURS,
				'guild',
			),
		};
	}

	async getEffectiveLimits(guildId: GuildID | null): Promise<EffectivePollLimits> {
		const instance = this.instanceLimits();
		const settings = guildId ? await this.repository.getSettings(guildId) : null;
		const cap = (value: number | null | undefined, ceiling: number): number =>
			value == null ? ceiling : Math.max(1, Math.min(value, ceiling));
		const maxDurationHours = Math.max(
			POLL_MIN_DURATION_HOURS,
			cap(settings?.max_duration_hours, instance.maxDurationHours),
		);
		return {
			instanceEnabled: instance.enabled,
			enabled: instance.enabled && (settings?.enabled ?? true),
			maxAnswers: Math.max(POLL_MIN_ANSWERS, cap(settings?.max_answers, instance.maxAnswers)),
			maxQuestionLength: cap(settings?.max_question_length, instance.maxQuestionLength),
			maxAnswerLength: cap(settings?.max_answer_length, instance.maxAnswerLength),
			maxDurationHours,
			defaultDurationHours: Math.min(settings?.default_duration_hours ?? POLL_DEFAULT_DURATION_HOURS, maxDurationHours),
			allowMultiselect: settings?.allow_multiselect ?? true,
			maxAnswersCeiling: instance.maxAnswers,
			maxQuestionLengthCeiling: instance.maxQuestionLength,
			maxAnswerLengthCeiling: instance.maxAnswerLength,
			maxDurationHoursCeiling: instance.maxDurationHours,
		};
	}

	toSettingsResponse(limits: EffectivePollLimits): GuildPollSettingsResponse {
		return {
			enabled: limits.enabled,
			max_answers: limits.maxAnswers,
			max_question_length: limits.maxQuestionLength,
			max_answer_length: limits.maxAnswerLength,
			max_duration_hours: limits.maxDurationHours,
			default_duration_hours: limits.defaultDurationHours,
			allow_multiselect: limits.allowMultiselect,
			max_answers_ceiling: limits.maxAnswersCeiling,
			max_question_length_ceiling: limits.maxQuestionLengthCeiling,
			max_answer_length_ceiling: limits.maxAnswerLengthCeiling,
			max_duration_hours_ceiling: limits.maxDurationHoursCeiling,
			instance_enabled: limits.instanceEnabled,
		};
	}

	async getSettings(guildId: GuildID): Promise<GuildPollSettingsResponse> {
		return this.toSettingsResponse(await this.getEffectiveLimits(guildId));
	}

	async updateSettings(params: {
		guildId: GuildID;
		userId: UserID;
		data: GuildPollSettingsUpdateRequest;
	}): Promise<GuildPollSettingsResponse> {
		const {guildId, userId, data} = params;
		await requireManageGuild(this.gatewayService, guildId, userId);
		const instance = this.instanceLimits();
		const exceeds = (field: string, value: number | undefined, ceiling: number): void => {
			if (value !== undefined && value > ceiling) {
				throw InputValidationError.fromCode(field, ValidationErrorCodes.POLL_SETTING_EXCEEDS_INSTANCE_LIMIT, {
					max: ceiling,
				});
			}
		};
		exceeds('max_answers', data.max_answers, instance.maxAnswers);
		exceeds('max_question_length', data.max_question_length, instance.maxQuestionLength);
		exceeds('max_answer_length', data.max_answer_length, instance.maxAnswerLength);
		exceeds('max_duration_hours', data.max_duration_hours, instance.maxDurationHours);
		exceeds('default_duration_hours', data.default_duration_hours, instance.maxDurationHours);
		const existing = await this.repository.getSettings(guildId);
		const next: GuildPollSettingsRow = {
			guild_id: guildId,
			enabled: data.enabled ?? existing?.enabled ?? true,
			max_answers: data.max_answers ?? existing?.max_answers ?? null,
			max_question_length: data.max_question_length ?? existing?.max_question_length ?? null,
			max_answer_length: data.max_answer_length ?? existing?.max_answer_length ?? null,
			max_duration_hours: data.max_duration_hours ?? existing?.max_duration_hours ?? null,
			default_duration_hours: data.default_duration_hours ?? existing?.default_duration_hours ?? null,
			allow_multiselect: data.allow_multiselect ?? existing?.allow_multiselect ?? true,
			version: (existing?.version ?? 0) + 1,
		};
		if (next.default_duration_hours != null && next.max_duration_hours != null) {
			next.default_duration_hours = Math.min(next.default_duration_hours, next.max_duration_hours);
		}
		await this.repository.upsertSettings(next);
		return this.getSettings(guildId);
	}

	// -------------------------------------------------------------- creation

	/**
	 * Validate a poll from a message create request against permissions and
	 * effective limits. Called by MessageSendService before the message is
	 * persisted; returns the normalised poll ready for createPollForMessage.
	 */
	async prepare(params: {
		authChannel: AuthenticatedChannel;
		poll: PollCreateRequest;
		now?: Date;
	}): Promise<PreparedPoll> {
		const {authChannel, poll} = params;
		const now = params.now ?? new Date();
		const {channel, guild} = authChannel;
		this.ensureTextChannel(channel);
		const guildId = channel.guildId ?? null;
		const limits = await this.getEffectiveLimits(guildId);
		if (!limits.enabled) {
			throw new FeatureTemporarilyDisabledError();
		}
		if (guild) {
			await authChannel.checkPermission(Permissions.SEND_POLLS);
		}
		const questionText = poll.question.text.trim();
		if (questionText.length === 0 || questionText.length > limits.maxQuestionLength) {
			throw InputValidationError.fromCode('question.text', ValidationErrorCodes.POLL_QUESTION_LENGTH_INVALID, {
				max: limits.maxQuestionLength,
			});
		}
		if (poll.answers.length < POLL_MIN_ANSWERS || poll.answers.length > limits.maxAnswers) {
			throw InputValidationError.fromCode('answers', ValidationErrorCodes.POLL_ANSWER_COUNT_INVALID, {
				min: POLL_MIN_ANSWERS,
				max: limits.maxAnswers,
			});
		}
		if (poll.duration_hours < POLL_MIN_DURATION_HOURS || poll.duration_hours > limits.maxDurationHours) {
			throw InputValidationError.fromCode('duration_hours', ValidationErrorCodes.POLL_DURATION_INVALID, {
				min: POLL_MIN_DURATION_HOURS,
				max: limits.maxDurationHours,
			});
		}
		const allowMultiselect = poll.allow_multiselect ?? false;
		if (allowMultiselect && !limits.allowMultiselect) {
			throw InputValidationError.fromCode('allow_multiselect', ValidationErrorCodes.POLL_MULTISELECT_NOT_ALLOWED);
		}
		const answers: Array<MessagePollAnswerItem> = [];
		for (const [index, answer] of poll.answers.entries()) {
			const text = answer.text.trim();
			if (text.length === 0 || text.length > limits.maxAnswerLength) {
				throw InputValidationError.fromCode(`answers.${index}.text`, ValidationErrorCodes.POLL_ANSWER_LENGTH_INVALID, {
					max: limits.maxAnswerLength,
				});
			}
			const emoji = await this.resolveEmoji(guildId, answer, index);
			answers.push({answer_id: index + 1, text, ...emoji});
		}
		return {
			questionText,
			answers,
			allowMultiselect,
			allowVoteChange: poll.allow_vote_change ?? true,
			expiresAt: new Date(now.getTime() + poll.duration_hours * HOUR_MS),
		};
	}

	private async resolveEmoji(
		guildId: GuildID | null,
		answer: {emoji_id?: bigint | null; emoji_name?: string | null},
		index: number,
	): Promise<Pick<MessagePollAnswerItem, 'emoji_id' | 'emoji_name' | 'emoji_animated'>> {
		if (answer.emoji_id != null) {
			const emojiId = createEmojiID(BigInt(answer.emoji_id));
			const emoji = await this.guildRepository.getEmojiById(emojiId);
			if (!emoji || (guildId !== null && emoji.guildId !== guildId)) {
				throw InputValidationError.fromCode(`answers.${index}.emoji_id`, ValidationErrorCodes.CUSTOM_EMOJI_NOT_FOUND);
			}
			return {emoji_id: emojiId, emoji_name: emoji.name, emoji_animated: emoji.isAnimated};
		}
		const name = answer.emoji_name?.trim() ?? '';
		if (name.length === 0) {
			return {emoji_id: null, emoji_name: null, emoji_animated: null};
		}
		if (!isValidSingleUnicodeEmoji(name)) {
			throw InputValidationError.fromCode(`answers.${index}.emoji_name`, ValidationErrorCodes.POLL_INVALID_EMOJI);
		}
		return {emoji_id: null, emoji_name: name, emoji_animated: false};
	}

	async createPollForMessage(params: {
		messageId: MessageID;
		channelId: ChannelID;
		guildId: GuildID | null;
		authorId: UserID;
		prepared: PreparedPoll;
		now?: Date;
	}): Promise<MessagePoll> {
		const now = params.now ?? new Date();
		const poll = new MessagePoll({
			message_id: params.messageId,
			channel_id: params.channelId,
			guild_id: params.guildId,
			author_id: params.authorId,
			question_text: params.prepared.questionText,
			answers: params.prepared.answers,
			allow_multiselect: params.prepared.allowMultiselect,
			allow_vote_change: params.prepared.allowVoteChange,
			layout_type: PollLayoutTypes.DEFAULT,
			expires_at: params.prepared.expiresAt,
			finalized_at: null,
			created_at: now,
			version: 1,
		});
		return this.repository.createPoll(poll);
	}

	// -------------------------------------------------------------- responses

	async buildPollResponse(poll: MessagePoll, viewerUserId: UserID | null): Promise<PollResponse> {
		return buildPollResponse(poll, viewerUserId);
	}

	// ---------------------------------------------------------------- voting

	private async loadOpenPoll(params: {
		authChannel: AuthenticatedChannel;
		messageId: MessageID;
		requestCache: RequestCache;
	}): Promise<{poll: MessagePoll; channel: Channel}> {
		const {authChannel, messageId} = params;
		const channel = authChannel.channel;
		this.ensureTextChannel(channel);
		await this.assertMessageHistoryAccess(authChannel, messageId);
		const message = await this.channelRepository.messages.getMessage(channel.id, messageId);
		if (!message) throw new UnknownMessageError();
		const poll = await this.repository.getPoll(messageId);
		if (!poll) throw InputValidationError.fromCode('message_id', ValidationErrorCodes.POLL_NOT_FOUND);
		if (!poll.isFinalized && poll.isExpiredAt(new Date())) {
			await this.finalize({poll, channel, requestCache: params.requestCache});
			throw InputValidationError.fromCode('message_id', ValidationErrorCodes.POLL_ALREADY_FINALIZED);
		}
		if (poll.isFinalized) {
			throw InputValidationError.fromCode('message_id', ValidationErrorCodes.POLL_ALREADY_FINALIZED);
		}
		return {poll, channel};
	}

	private async assertMessageHistoryAccess(authChannel: AuthenticatedChannel, messageId: MessageID): Promise<void> {
		const {guild, hasPermission} = authChannel;
		if (!guild) return;
		if (await hasPermission(Permissions.READ_MESSAGE_HISTORY)) return;
		const cutoff = guild.message_history_cutoff;
		if (!cutoff || snowflakeToDate(messageId).getTime() < new Date(cutoff).getTime()) {
			throw new UnknownMessageError();
		}
	}

	async vote(params: {
		userId: UserID;
		channelId: ChannelID;
		messageId: MessageID;
		answerId: number;
		sessionId?: string;
		requestCache: RequestCache;
	}): Promise<void> {
		const authChannel = await this.authService.getChannelAuthenticated({
			userId: params.userId,
			channelId: params.channelId,
		});
		const {poll, channel} = await this.loadOpenPoll({
			authChannel,
			messageId: params.messageId,
			requestCache: params.requestCache,
		});
		if (!poll.hasAnswer(params.answerId)) {
			throw InputValidationError.fromCode('answer_id', ValidationErrorCodes.POLL_ANSWER_NOT_FOUND);
		}
		const existing = (await this.repository.listVotes(poll.messageId)).filter((vote) => vote.user_id === params.userId);
		if (existing.some((vote) => vote.answer_id === params.answerId)) return;
		if (!poll.allowVoteChange && !poll.allowMultiselect && existing.length > 0) {
			throw InputValidationError.fromCode('answer_id', ValidationErrorCodes.POLL_VOTE_CHANGE_NOT_ALLOWED);
		}
		if (!poll.allowMultiselect) {
			for (const vote of existing) {
				await this.repository.removeVote(poll.messageId, vote.answer_id, params.userId);
				await this.dispatchVote(
					'MESSAGE_POLL_VOTE_REMOVE',
					channel,
					poll,
					params.userId,
					vote.answer_id,
					params.sessionId,
				);
			}
		}
		await this.repository.addVote(poll.messageId, params.answerId, params.userId, new Date());
		await this.dispatchVote('MESSAGE_POLL_VOTE_ADD', channel, poll, params.userId, params.answerId, params.sessionId);
	}

	async unvote(params: {
		userId: UserID;
		channelId: ChannelID;
		messageId: MessageID;
		answerId: number;
		sessionId?: string;
		requestCache: RequestCache;
	}): Promise<void> {
		const authChannel = await this.authService.getChannelAuthenticated({
			userId: params.userId,
			channelId: params.channelId,
		});
		const {poll, channel} = await this.loadOpenPoll({
			authChannel,
			messageId: params.messageId,
			requestCache: params.requestCache,
		});
		if (!poll.hasAnswer(params.answerId)) {
			throw InputValidationError.fromCode('answer_id', ValidationErrorCodes.POLL_ANSWER_NOT_FOUND);
		}
		const votes = await this.repository.listVotesForAnswer(poll.messageId, params.answerId);
		if (!votes.some((vote) => vote.user_id === params.userId)) return;
		if (!poll.allowVoteChange) {
			throw InputValidationError.fromCode('answer_id', ValidationErrorCodes.POLL_VOTE_CHANGE_NOT_ALLOWED);
		}
		await this.repository.removeVote(poll.messageId, params.answerId, params.userId);
		await this.dispatchVote(
			'MESSAGE_POLL_VOTE_REMOVE',
			channel,
			poll,
			params.userId,
			params.answerId,
			params.sessionId,
		);
	}

	async listVoters(params: {
		userId: UserID;
		channelId: ChannelID;
		messageId: MessageID;
		answerId: number;
		limit: number;
		after?: UserID;
		requestCache: RequestCache;
	}): Promise<PollAnswerVotersResponse> {
		const authChannel = await this.authService.getChannelAuthenticated({
			userId: params.userId,
			channelId: params.channelId,
		});
		this.ensureTextChannel(authChannel.channel);
		await this.assertMessageHistoryAccess(authChannel, params.messageId);
		const poll = await this.repository.getPoll(params.messageId);
		if (!poll) throw InputValidationError.fromCode('message_id', ValidationErrorCodes.POLL_NOT_FOUND);
		if (!poll.hasAnswer(params.answerId)) {
			throw InputValidationError.fromCode('answer_id', ValidationErrorCodes.POLL_ANSWER_NOT_FOUND);
		}
		const votes = await this.repository.listVotersForAnswer({
			messageId: poll.messageId,
			answerId: params.answerId,
			limit: params.limit,
			after: params.after,
		});
		const users = await this.userCacheService.getUserPartialResponses(
			votes.map((vote) => vote.user_id),
			params.requestCache,
		);
		return {users: votes.flatMap((vote) => users.get(vote.user_id) ?? [])};
	}

	private async dispatchVote(
		event: 'MESSAGE_POLL_VOTE_ADD' | 'MESSAGE_POLL_VOTE_REMOVE',
		channel: Channel,
		poll: MessagePoll,
		userId: UserID,
		answerId: number,
		sessionId?: string,
	): Promise<void> {
		await dispatchChannelEvent({
			gatewayService: this.gatewayService,
			channel,
			event,
			data: {
				channel_id: channel.id.toString(),
				message_id: poll.messageId.toString(),
				guild_id: poll.guildId ? poll.guildId.toString() : undefined,
				user_id: userId.toString(),
				answer_id: answerId,
				session_id: sessionId,
			},
		});
	}

	// ---------------------------------------------------------------- ending

	/** End a poll early. Author, or MANAGE_MESSAGES in guild channels. */
	async expire(params: {
		userId: UserID;
		channelId: ChannelID;
		messageId: MessageID;
		requestCache: RequestCache;
		auditLogReason?: string | null;
	}): Promise<PollResponse> {
		const authChannel = await this.authService.getChannelAuthenticated({
			userId: params.userId,
			channelId: params.channelId,
		});
		const {poll, channel} = await this.loadOpenPoll({
			authChannel,
			messageId: params.messageId,
			requestCache: params.requestCache,
		});
		const isAuthor = poll.authorId === params.userId;
		if (!isAuthor) {
			if (!authChannel.guild || !(await authChannel.hasPermission(Permissions.MANAGE_MESSAGES))) {
				throw new MissingPermissionsError();
			}
		}
		const finalized = await this.finalize({
			poll,
			channel,
			requestCache: params.requestCache,
			actorUserId: params.userId,
		});
		if (!isAuthor && poll.guildId) {
			await this.recordAuditLog({
				guildId: poll.guildId,
				userId: params.userId,
				messageId: poll.messageId,
				reason: params.auditLogReason ?? null,
			});
		}
		return this.buildPollResponse(finalized, params.userId);
	}

	/**
	 * Mark a poll finished: lock votes, broadcast the updated message, and
	 * post the POLL_RESULT system message as a reply to it. Idempotent.
	 */
	async finalize(params: {
		poll: MessagePoll;
		channel: Channel;
		requestCache: RequestCache;
		actorUserId?: UserID;
		now?: Date;
	}): Promise<MessagePoll> {
		const {poll, channel} = params;
		if (poll.isFinalized) return poll;
		const now = params.now ?? new Date();
		const finalized = poll.withFinalizedAt(now);
		await this.repository.savePoll(finalized);
		await this.repository.deleteExpiryIndex(poll);
		const message = await this.channelRepository.messages.getMessage(channel.id, poll.messageId);
		if (message) {
			await this.dispatchService.dispatchMessageUpdate({
				channel,
				message,
				requestCache: params.requestCache,
				currentUserId: params.actorUserId,
			});
		}
		try {
			const resultMessageId = createMessageID(await this.snowflakeService.generateForChannel(channel.id));
			const {message: resultMessage} = await this.persistenceService.createMessage({
				messageId: resultMessageId,
				channelId: channel.id,
				userId: poll.authorId,
				type: MessageTypes.POLL_RESULT,
				content: null,
				flags: 0,
				guildId: poll.guildId,
				channel,
				messageReference: {
					channel_id: channel.id,
					message_id: poll.messageId,
					guild_id: poll.guildId,
					type: MessageReferenceTypes.DEFAULT,
				},
				referencedMessage: message,
			});
			await this.dispatchService.dispatchMessageCreate({
				channel,
				message: resultMessage,
				requestCache: params.requestCache,
			});
		} catch (error) {
			Logger.error({error, messageId: poll.messageId.toString()}, 'Failed to post poll result message');
		}
		return finalized;
	}

	/** Worker entry point: finalize every poll whose timer has run out. */
	async finalizeExpired(now = new Date()): Promise<{finalized: number; skipped: number}> {
		let finalized = 0;
		let skipped = 0;
		const requestCache = createRequestCache();
		for (let offset = 0; offset <= EXPIRY_LOOKBACK_DAYS; offset++) {
			const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
			const bucket = Number(
				`${bucketDate.getUTCFullYear()}${String(bucketDate.getUTCMonth() + 1).padStart(2, '0')}${String(bucketDate.getUTCDate()).padStart(2, '0')}`,
			);
			while (true) {
				const expired = await this.repository.fetchExpiredByBucket(bucket, now, EXPIRY_FETCH_LIMIT);
				if (expired.length === 0) break;
				let progressed = false;
				for (const row of expired) {
					const poll = await this.repository.getPoll(row.message_id);
					const channel = await this.channelRepository.channelData.findUnique(row.channel_id);
					if (!poll || !channel) {
						await this.repository.deleteExpiryIndex(
							new MessagePoll({
								message_id: row.message_id,
								channel_id: row.channel_id,
								guild_id: null,
								author_id: row.message_id as unknown as UserID,
								question_text: '',
								answers: [],
								allow_multiselect: false,
								allow_vote_change: true,
								layout_type: PollLayoutTypes.DEFAULT,
								expires_at: row.expires_at,
								finalized_at: null,
								created_at: row.expires_at,
								version: 0,
							}),
						);
						skipped++;
						progressed = true;
						continue;
					}
					if (poll.isFinalized) {
						await this.repository.deleteExpiryIndex(poll);
						skipped++;
						progressed = true;
						continue;
					}
					await this.finalize({poll, channel, requestCache, now});
					finalized++;
					progressed = true;
				}
				if (!progressed || expired.length < EXPIRY_FETCH_LIMIT) break;
			}
		}
		return {finalized, skipped};
	}

	/** Remove a poll's rows when its message is deleted. */
	async deleteForMessage(messageId: MessageID): Promise<void> {
		const poll = await this.repository.getPoll(messageId);
		if (poll) await this.repository.deletePoll(poll);
	}

	private async recordAuditLog(params: {
		guildId: GuildID;
		userId: UserID;
		messageId: MessageID;
		reason: string | null;
	}): Promise<void> {
		try {
			await this.auditLogService
				.createBuilder(params.guildId, params.userId)
				.withAction(AuditLogActionType.POLL_END, params.messageId.toString())
				.withReason(params.reason)
				.withChanges(this.auditLogService.computeChanges(null, {message_id: params.messageId.toString()}))
				.commit();
		} catch (error) {
			Logger.error({error, guildId: params.guildId.toString()}, 'Failed to record poll audit log');
		}
	}
}

async function requireManageGuild(gatewayService: IGatewayService, guildId: GuildID, userId: UserID): Promise<void> {
	await requirePermission(gatewayService, {guildId, userId, permission: Permissions.MANAGE_GUILD});
}
