// SPDX-License-Identifier: AGPL-3.0-or-later

import {GenericErrorModal} from '@app/features/app/components/alerts/GenericErrorModal';
import styles from '@app/features/channel/components/MessagePoll.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import * as PollCommands from '@app/features/messaging/commands/PollCommands';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {User} from '@app/features/user/models/User';
import Users from '@app/features/user/state/Users';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {PollAnswerResponse, PollResponse} from '@fluxer/schema/src/domains/message/PollSchemas';
import type {UserPartialResponse} from '@fluxer/schema/src/domains/user/UserResponseSchemas';
import {msg, plural} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {CheckIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import {useCallback, useEffect, useMemo, useState} from 'react';

const logger = new Logger('MessagePoll');

const SELECT_ONE_DESCRIPTOR = msg({
	message: 'Select one answer',
	comment: 'Hint under a poll question when members may pick a single answer.',
});
const SELECT_MANY_DESCRIPTOR = msg({
	message: 'Select one or more answers',
	comment: 'Hint under a poll question when members may pick several answers.',
});
const POLL_ENDED_DESCRIPTOR = msg({
	message: 'Poll ended',
	comment: 'Status shown in a poll footer once voting has closed.',
});
const END_POLL_DESCRIPTOR = msg({
	message: 'End poll',
	comment: 'Button in a poll footer that closes the poll early. Shown to the author and moderators.',
});
const ENDING_POLL_DESCRIPTOR = msg({
	message: 'Ending…',
	comment: 'Button label while a request to end a poll is in flight.',
});
const REMOVE_VOTE_DESCRIPTOR = msg({
	message: 'Remove vote',
	comment: 'Button in a poll footer that withdraws the current member’s vote.',
});
const SHOW_VOTES_DESCRIPTOR = msg({
	message: 'Show votes',
	comment: 'Button in a poll footer that reveals per-answer results before the member has voted.',
});
const HIDE_VOTES_DESCRIPTOR = msg({
	message: 'Hide votes',
	comment: 'Button in a poll footer that hides the results again so the member can vote without bias.',
});
const VOTERS_TITLE_DESCRIPTOR = msg({
	message: 'Voted for {answer}',
	comment: 'Heading of the popout listing who voted for a poll answer. {answer} is the answer text.',
});
const NO_VOTERS_DESCRIPTOR = msg({
	message: 'Nobody has picked this yet.',
	comment: 'Empty state of the popout listing who voted for a poll answer.',
});
const VOTE_FAILED_TITLE_DESCRIPTOR = msg({
	message: 'Vote not saved',
	comment: 'Title of the error dialog shown when voting on a poll fails.',
});
const END_FAILED_TITLE_DESCRIPTOR = msg({
	message: 'Poll not ended',
	comment: 'Title of the error dialog shown when ending a poll early fails.',
});
const VOTE_FAILED_DESCRIPTOR = msg({
	message: 'Your vote could not be saved. Try again.',
	comment: 'Error shown when voting on a poll fails.',
});
const END_FAILED_DESCRIPTOR = msg({
	message: 'The poll could not be ended.',
	comment: 'Error shown when ending a poll early fails.',
});

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}

function formatTimeLeft(remainingMs: number): string {
	if (remainingMs >= DAY_MS) {
		const days = Math.ceil(remainingMs / DAY_MS);
		return plural({count: days}, {one: '# day left', other: '# days left'});
	}
	if (remainingMs >= HOUR_MS) {
		const hours = Math.ceil(remainingMs / HOUR_MS);
		return plural({count: hours}, {one: '# hour left', other: '# hours left'});
	}
	const minutes = Math.max(1, Math.ceil(remainingMs / MINUTE_MS));
	return plural({count: minutes}, {one: '# minute left', other: '# minutes left'});
}

interface MessagePollProps {
	message: Message;
	channel: Channel;
	isPreview?: boolean;
}

export const MessagePoll = observer(({message, channel, isPreview}: MessagePollProps) => {
	const {i18n} = useLingui();
	const poll = message.poll;
	const now = useNow(MINUTE_MS);
	const [revealed, setRevealed] = useState(false);
	const [ending, setEnding] = useState(false);
	const [busyAnswer, setBusyAnswer] = useState<number | null>(null);

	const expiresAtMs = poll ? new Date(poll.expires_at).getTime() : 0;
	const isFinalized = poll ? poll.results.is_finalized || expiresAtMs <= now : false;
	const counts = poll?.results.answer_counts ?? [];
	const totalVotes = counts.reduce((sum, entry) => sum + entry.count, 0);
	const meVotedAny = counts.some((entry) => entry.me_voted);
	const showResults = isFinalized || meVotedAny || revealed;
	const currentUserId = Users.getCurrentUser()?.id;
	const canEnd =
		!isPreview &&
		!isFinalized &&
		(message.author.id === currentUserId ||
			(!channel.isPrivate() && Permission.can(Permissions.MANAGE_MESSAGES, channel)));
	const canVote = !isPreview && !isFinalized;

	const countFor = useCallback((answerId: number) => counts.find((entry) => entry.id === answerId), [counts]);

	const handleAnswerClick = useCallback(
		async (answer: PollAnswerResponse) => {
			if (!poll || !canVote || busyAnswer !== null) return;
			const entry = countFor(answer.answer_id);
			setBusyAnswer(answer.answer_id);
			try {
				if (entry?.me_voted) {
					await PollCommands.unvote(channel.id, message.id, answer.answer_id);
				} else {
					await PollCommands.vote(channel.id, message.id, answer.answer_id, poll.allow_multiselect);
				}
			} catch (error) {
				logger.error('Poll vote failed', error);
				ModalCommands.push(
					modal(() => (
						<GenericErrorModal title={i18n._(VOTE_FAILED_TITLE_DESCRIPTOR)} message={i18n._(VOTE_FAILED_DESCRIPTOR)} />
					)),
				);
			} finally {
				setBusyAnswer(null);
			}
		},
		[poll, canVote, busyAnswer, countFor, channel.id, message.id, i18n],
	);

	const handleRemoveVotes = useCallback(async () => {
		if (!poll) return;
		for (const entry of counts) {
			if (entry.me_voted) {
				try {
					await PollCommands.unvote(channel.id, message.id, entry.id);
				} catch (error) {
					logger.error('Removing poll vote failed', error);
				}
			}
		}
	}, [poll, counts, channel.id, message.id]);

	const handleEnd = useCallback(async () => {
		if (ending) return;
		setEnding(true);
		try {
			await PollCommands.expire(channel.id, message.id);
		} catch (error) {
			logger.error('Ending poll failed', error);
			ModalCommands.push(
				modal(() => (
					<GenericErrorModal title={i18n._(END_FAILED_TITLE_DESCRIPTOR)} message={i18n._(END_FAILED_DESCRIPTOR)} />
				)),
			);
		} finally {
			setEnding(false);
		}
	}, [ending, channel.id, message.id, i18n]);

	const votesText = plural({count: totalVotes}, {one: '# vote', other: '# votes'});
	const timeText = isFinalized ? i18n._(POLL_ENDED_DESCRIPTOR) : formatTimeLeft(expiresAtMs - now);

	if (!poll) return null;

	return (
		<div className={styles.poll} role="group" aria-label={poll.question.text} data-flx="channel.message-poll">
			<div className={styles.question} data-flx="channel.message-poll.question">
				{poll.question.text}
			</div>
			{!isFinalized && (
				<div className={styles.hint} data-flx="channel.message-poll.hint">
					{i18n._(poll.allow_multiselect ? SELECT_MANY_DESCRIPTOR : SELECT_ONE_DESCRIPTOR)}
				</div>
			)}
			<ul className={styles.answers} data-flx="channel.message-poll.answers">
				{poll.answers.map((answer) => {
					const entry = countFor(answer.answer_id);
					const count = entry?.count ?? 0;
					const percent = totalVotes === 0 ? 0 : Math.round((count / totalVotes) * 100);
					const voted = entry?.me_voted ?? false;
					return (
						<li key={answer.answer_id} data-flx="channel.message-poll.answer-item">
							<PollAnswerButton
								answer={answer}
								voted={voted}
								percent={percent}
								count={count}
								showResults={showResults}
								multiselect={poll.allow_multiselect}
								disabled={!canVote || busyAnswer !== null}
								onClick={() => void handleAnswerClick(answer)}
								channelId={channel.id}
								messageId={message.id}
								isPreview={Boolean(isPreview)}
							/>
						</li>
					);
				})}
			</ul>
			<div className={styles.footer} data-flx="channel.message-poll.footer">
				<span data-flx="channel.message-poll.total-votes">{votesText}</span>
				<span className={styles.dot} data-flx="channel.message-poll.time-left">
					{timeText}
				</span>
				{!isFinalized && !meVotedAny && !isPreview && (
					<button
						type="button"
						className={clsx(styles.footerButton, styles.dot)}
						onClick={() => setRevealed((value) => !value)}
						data-flx="channel.message-poll.toggle-results"
					>
						{i18n._(revealed ? HIDE_VOTES_DESCRIPTOR : SHOW_VOTES_DESCRIPTOR)}
					</button>
				)}
				{!isFinalized && meVotedAny && !isPreview && (
					<button
						type="button"
						className={clsx(styles.footerButton, styles.dot)}
						onClick={() => void handleRemoveVotes()}
						data-flx="channel.message-poll.remove-vote"
					>
						{i18n._(REMOVE_VOTE_DESCRIPTOR)}
					</button>
				)}
				{canEnd && (
					<button
						type="button"
						className={clsx(styles.footerButton, styles.dot)}
						onClick={() => void handleEnd()}
						disabled={ending}
						data-flx="channel.message-poll.end-poll"
					>
						{i18n._(ending ? ENDING_POLL_DESCRIPTOR : END_POLL_DESCRIPTOR)}
					</button>
				)}
			</div>
		</div>
	);
});

interface PollAnswerButtonProps {
	answer: PollAnswerResponse;
	voted: boolean;
	percent: number;
	count: number;
	showResults: boolean;
	multiselect: boolean;
	disabled: boolean;
	onClick: () => void;
	channelId: string;
	messageId: string;
	isPreview: boolean;
}

const PollAnswerButton = observer((props: PollAnswerButtonProps) => {
	const {answer, voted, percent, count, showResults, multiselect, disabled, onClick, channelId, messageId, isPreview} =
		props;
	const button = (
		<button
			type="button"
			className={clsx(styles.answer, voted && styles.answerVoted)}
			onClick={onClick}
			disabled={disabled}
			aria-pressed={voted}
			data-flx="channel.message-poll.answer"
		>
			{showResults && <span className={styles.bar} style={{width: `${percent}%`}} aria-hidden="true" />}
			<span className={styles.answerBody}>
				<span
					className={clsx(styles.marker, multiselect && styles.markerSquare, voted && styles.markerChecked)}
					aria-hidden="true"
				>
					{voted && <CheckIcon size={12} weight="bold" />}
				</span>
				{answer.emoji && (
					<span className={styles.answerEmoji}>
						<SoundboardEmoji
							emojiId={answer.emoji.id}
							emojiName={answer.emoji.name}
							emojiAnimated={answer.emoji.animated}
							size={20}
						/>
					</span>
				)}
				<span className={styles.answerText}>{answer.text}</span>
			</span>
			{showResults && (
				<span className={styles.answerPercent} data-flx="channel.message-poll.answer-percent">
					{percent}%
				</span>
			)}
		</button>
	);
	if (!showResults || count === 0 || isPreview) return button;
	return (
		<Popout
			position="right-start"
			offsetMainAxis={8}
			render={() => <PollVotersPopout answer={answer} channelId={channelId} messageId={messageId} count={count} />}
			data-flx="channel.message-poll.voters-popout-anchor"
		>
			{button}
		</Popout>
	);
});

interface PollVotersPopoutProps {
	answer: PollAnswerResponse;
	channelId: string;
	messageId: string;
	count: number;
}

const PollVotersPopout = observer(({answer, channelId, messageId, count}: PollVotersPopoutProps) => {
	const {i18n} = useLingui();
	const [voters, setVoters] = useState<Array<UserPartialResponse> | null>(null);
	useEffect(() => {
		let cancelled = false;
		PollCommands.fetchVoters(channelId, messageId, answer.answer_id, {limit: 100})
			.then((users) => {
				if (cancelled) return;
				Users.cacheUsers(users.slice());
				setVoters(users);
			})
			.catch((error) => {
				logger.error('Fetching poll voters failed', error);
				if (!cancelled) setVoters([]);
			});
		return () => {
			cancelled = true;
		};
	}, [channelId, messageId, answer.answer_id, count]);
	const users = useMemo(() => (voters ?? []).map((wire) => Users.getUser(wire.id) ?? new User(wire)), [voters]);
	return (
		<div className={styles.voters} data-flx="channel.message-poll.voters">
			<div className={styles.votersTitle}>{i18n._(VOTERS_TITLE_DESCRIPTOR, {answer: answer.text})}</div>
			{voters !== null && users.length === 0 && (
				<div className={styles.votersEmpty}>{i18n._(NO_VOTERS_DESCRIPTOR)}</div>
			)}
			{users.map((user) => (
				<div key={user.id} className={styles.voter} data-flx="channel.message-poll.voter">
					<Avatar user={user} size={24} />
					<span className={styles.voterName}>{user.displayName}</span>
				</div>
			))}
		</div>
	);
});

export type {PollResponse};
