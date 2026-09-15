// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {ExpressionPickerPopout} from '@app/features/expressions/components/popouts/ExpressionPickerPopout';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import {getSkinTonedSurrogate} from '@app/features/expressions/utils/SkinToneUtils';
import * as MessageCommands from '@app/features/messaging/commands/MessageCommands';
import * as PollCommands from '@app/features/messaging/commands/PollCommands';
import styles from '@app/features/messaging/components/CreatePollModal.module.css';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {failureValidationErrors} from '@app/features/platform/utils/ResponseInspection';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Input, Textarea} from '@app/features/ui/components/form/FormInput';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {
	POLL_DURATION_PRESETS_HOURS,
	POLL_MAX_DURATION_HOURS_CEILING,
	POLL_MIN_ANSWERS,
	POLL_MIN_DURATION_HOURS,
} from '@fluxer/constants/src/PollConstants';
import type {GuildPollSettingsResponse, PollCreateRequestInput} from '@fluxer/schema/src/domains/message/PollSchemas';
import * as SnowflakeUtils from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg, plural} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {PlusIcon, SmileyIcon, XIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useState} from 'react';

const logger = new Logger('CreatePollModal');

const TITLE_DESCRIPTOR = msg({message: 'Create poll', comment: 'Title of the dialog for composing a new poll.'});
const QUESTION_LABEL_DESCRIPTOR = msg({message: 'Question', comment: 'Label of the poll question field.'});
const QUESTION_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'What do you want to ask?',
	comment: 'Placeholder of the poll question field.',
});
const ANSWERS_LABEL_DESCRIPTOR = msg({message: 'Answers', comment: 'Label above the list of poll answer fields.'});
const ANSWER_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Answer {index}',
	comment: 'Placeholder of one poll answer field. {index} is its 1-based position.',
});
const ADD_ANSWER_DESCRIPTOR = msg({message: 'Add answer', comment: 'Button that adds another poll answer field.'});
const REMOVE_ANSWER_DESCRIPTOR = msg({
	message: 'Remove answer',
	comment: 'Accessible label of the button that removes one poll answer field.',
});
const CHOOSE_EMOJI_DESCRIPTOR = msg({
	message: 'Choose an emoji for this answer',
	comment: 'Accessible label of the emoji picker button next to a poll answer.',
});
const DURATION_LABEL_DESCRIPTOR = msg({message: 'Duration', comment: 'Label above the poll duration choices.'});
const CUSTOM_DURATION_DESCRIPTOR = msg({
	message: 'Custom',
	comment: 'Duration choice that reveals a field for typing a number of hours.',
});
const HOURS_SUFFIX_DESCRIPTOR = msg({message: 'hours', comment: 'Unit shown after the custom poll duration field.'});
const MULTISELECT_LABEL_DESCRIPTOR = msg({
	message: 'Allow multiple answers',
	comment: 'Toggle in the poll composer letting voters pick more than one answer.',
});
const MULTISELECT_DISABLED_DESCRIPTOR = msg({
	message: 'This community only allows single-answer polls.',
	comment: 'Description under the multiple-answers toggle when the community has disabled it.',
});
const VOTE_CHANGE_LABEL_DESCRIPTOR = msg({
	message: 'Allow changing votes',
	comment: 'Toggle in the poll composer. When on, voters may withdraw or switch their vote while the poll is open.',
});
const VOTE_CHANGE_DESCRIPTION_DESCRIPTOR = msg({
	message: 'When off, a vote is final once cast.',
	comment: 'Description under the Allow changing votes toggle in the poll composer.',
});
const POST_DESCRIPTOR = msg({message: 'Post poll', comment: 'Submit button of the poll composer.'});
const DURATION_RANGE_ERROR_DESCRIPTOR = msg({
	message: 'Polls can stay open between {min} and {max} hours.',
	comment: 'Validation error under the custom duration field. {min} and {max} are whole numbers of hours.',
});
const GENERIC_ERROR_DESCRIPTOR = msg({
	message: 'The poll could not be posted. Try again.',
	comment: 'Error shown at the bottom of the poll composer when the request fails.',
});

interface AnswerDraft {
	key: number;
	text: string;
	emojiId: string | null;
	emojiName: string | null;
	emojiAnimated: boolean;
}

interface CreatePollModalProps {
	channelId: string;
	guildId?: string | null;
	limits: GuildPollSettingsResponse;
}

let answerKeySeed = 0;
function newAnswer(): AnswerDraft {
	return {key: ++answerKeySeed, text: '', emojiId: null, emojiName: null, emojiAnimated: false};
}

function formatPreset(hours: number): string {
	if (hours % 168 === 0) return plural({count: hours / 168}, {one: '# week', other: '# weeks'});
	if (hours % 24 === 0) return plural({count: hours / 24}, {one: '# day', other: '# days'});
	return plural({count: hours}, {one: '# hour', other: '# hours'});
}

export const CreatePollModal: React.FC<CreatePollModalProps> = observer(({channelId, limits}) => {
	const {i18n} = useLingui();
	const [question, setQuestion] = useState('');
	const [answers, setAnswers] = useState<Array<AnswerDraft>>(() => [newAnswer(), newAnswer()]);
	const [durationHours, setDurationHours] = useState<number>(limits.default_duration_hours);
	const [customDuration, setCustomDuration] = useState<string>('');
	const [useCustom, setUseCustom] = useState(false);
	const [multiselect, setMultiselect] = useState(false);
	const [allowVoteChange, setAllowVoteChange] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pickerFor, setPickerFor] = useState<number | null>(null);

	const presets = useMemo(
		() => POLL_DURATION_PRESETS_HOURS.filter((hours) => hours <= limits.max_duration_hours),
		[limits.max_duration_hours],
	);
	useEffect(() => {
		if (!presets.includes(durationHours) && !useCustom) {
			setUseCustom(true);
			setCustomDuration(String(durationHours));
		}
	}, [presets, durationHours, useCustom]);

	const effectiveDuration = useCustom ? Number.parseInt(customDuration, 10) : durationHours;
	const durationValid =
		Number.isInteger(effectiveDuration) &&
		effectiveDuration >= POLL_MIN_DURATION_HOURS &&
		effectiveDuration <= limits.max_duration_hours;
	const questionTrimmed = question.trim();
	const filledAnswers = answers.filter((answer) => answer.text.trim().length > 0);
	const canSubmit =
		!submitting &&
		questionTrimmed.length > 0 &&
		questionTrimmed.length <= limits.max_question_length &&
		filledAnswers.length >= POLL_MIN_ANSWERS &&
		filledAnswers.every((answer) => answer.text.trim().length <= limits.max_answer_length) &&
		durationValid;

	const updateAnswer = useCallback((key: number, patch: Partial<AnswerDraft>) => {
		setAnswers((current) => current.map((answer) => (answer.key === key ? {...answer, ...patch} : answer)));
	}, []);

	const handleSubmit = useCallback(async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		setError(null);
		// Wire shape: snowflakes travel as strings (z.input of the schema); a
		// BigInt here would blow up JSON.stringify before the request is sent.
		const poll: PollCreateRequestInput = {
			question: {text: questionTrimmed},
			answers: filledAnswers.map((answer) => ({
				text: answer.text.trim(),
				emoji_id: answer.emojiId ?? undefined,
				emoji_name: answer.emojiId ? undefined : (answer.emojiName ?? undefined),
			})),
			duration_hours: effectiveDuration,
			allow_multiselect: multiselect,
			allow_vote_change: allowVoteChange,
		};
		try {
			const result = await MessageCommands.send(channelId, {
				content: '',
				nonce: SnowflakeUtils.fromTimestamp(Date.now()),
				poll,
			});
			if (result === null) {
				setError(i18n._(GENERIC_ERROR_DESCRIPTOR));
				return;
			}
			ModalCommands.pop();
		} catch (caught) {
			logger.error('Posting poll failed', caught);
			const details = failureValidationErrors(caught)
				?.map((entry) => entry.message)
				.join(' ');
			setError(details && details.length > 0 ? details : i18n._(GENERIC_ERROR_DESCRIPTOR));
		} finally {
			setSubmitting(false);
		}
	}, [canSubmit, questionTrimmed, filledAnswers, effectiveDuration, multiselect, allowVoteChange, channelId, i18n]);

	return (
		<Modal.Root onClose={() => ModalCommands.pop()} size="small" data-flx="messaging.create-poll-modal.modal-root">
			<Modal.Header title={i18n._(TITLE_DESCRIPTOR)} data-flx="messaging.create-poll-modal.modal-header" />
			<Modal.Content data-flx="messaging.create-poll-modal.modal-content">
				<Modal.ContentLayout className={styles.layout} data-flx="messaging.create-poll-modal.content-layout">
					<div className={styles.section} data-flx="messaging.create-poll-modal.question-section">
						<Textarea
							label={
								<>
									{i18n._(QUESTION_LABEL_DESCRIPTOR)} <span className={styles.required}>*</span>
								</>
							}
							value={question}
							onChange={(event) => setQuestion(event.currentTarget.value.slice(0, limits.max_question_length))}
							maxLength={limits.max_question_length}
							showCharacterCount={true}
							minRows={2}
							maxRows={5}
							placeholder={i18n._(QUESTION_PLACEHOLDER_DESCRIPTOR)}
							autoFocus={true}
							data-flx="messaging.create-poll-modal.question-input"
						/>
					</div>

					<div className={styles.section} data-flx="messaging.create-poll-modal.answers-section">
						<span className={styles.sectionLabel} data-flx="messaging.create-poll-modal.answers-label">
							<span>
								{i18n._(ANSWERS_LABEL_DESCRIPTOR)} <span className={styles.required}>*</span>
							</span>
							<span className={styles.counter}>
								{answers.length}/{limits.max_answers}
							</span>
						</span>
						{answers.map((answer, index) => (
							<div key={answer.key} className={styles.answerRow} data-flx="messaging.create-poll-modal.answer-row">
								<Popout
									position="bottom-start"
									animationType="none"
									offsetMainAxis={8}
									onOpen={() => setPickerFor(answer.key)}
									onClose={() => setPickerFor(null)}
									render={(renderProps) => (
										<ExpressionPickerPopout
											visibleTabs={['emojis']}
											onEmojiSelect={(picked) => {
												if (picked.id) {
													updateAnswer(answer.key, {
														emojiId: picked.id,
														emojiName: picked.name,
														emojiAnimated: Boolean(picked.animated),
													});
												} else {
													updateAnswer(answer.key, {
														emojiId: null,
														emojiName: getSkinTonedSurrogate(picked),
														emojiAnimated: false,
													});
												}
												renderProps.onClose();
											}}
											onClose={renderProps.onClose}
											data-flx="messaging.create-poll-modal.expression-picker-popout"
										/>
									)}
									data-flx="messaging.create-poll-modal.emoji-popout"
								>
									<button
										type="button"
										className={styles.emojiButton}
										aria-label={i18n._(CHOOSE_EMOJI_DESCRIPTOR)}
										aria-haspopup="dialog"
										aria-expanded={pickerFor === answer.key}
										data-flx="messaging.create-poll-modal.emoji-button"
									>
										{answer.emojiId || answer.emojiName ? (
											<SoundboardEmoji
												emojiId={answer.emojiId}
												emojiName={answer.emojiName}
												emojiAnimated={answer.emojiAnimated}
												size={20}
											/>
										) : (
											<SmileyIcon size={20} />
										)}
									</button>
								</Popout>
								<div className={styles.answerInput}>
									<Input
										value={answer.text}
										onChange={(event) =>
											updateAnswer(answer.key, {text: event.currentTarget.value.slice(0, limits.max_answer_length)})
										}
										maxLength={limits.max_answer_length}
										placeholder={i18n._(ANSWER_PLACEHOLDER_DESCRIPTOR, {index: index + 1})}
										data-flx="messaging.create-poll-modal.answer-input"
									/>
								</div>
								<button
									type="button"
									className={styles.iconButton}
									aria-label={i18n._(REMOVE_ANSWER_DESCRIPTOR)}
									disabled={answers.length <= POLL_MIN_ANSWERS}
									onClick={() => setAnswers((current) => current.filter((entry) => entry.key !== answer.key))}
									data-flx="messaging.create-poll-modal.remove-answer"
								>
									<XIcon size={16} />
								</button>
							</div>
						))}
						{answers.length < limits.max_answers && (
							<Button
								type="button"
								variant="secondary"
								className={styles.addAnswer}
								leftIcon={<PlusIcon size={16} data-flx="messaging.create-poll-modal.plus-icon" />}
								onClick={() => setAnswers((current) => [...current, newAnswer()])}
								data-flx="messaging.create-poll-modal.add-answer"
							>
								{i18n._(ADD_ANSWER_DESCRIPTOR)}
							</Button>
						)}
					</div>

					<div className={styles.section} data-flx="messaging.create-poll-modal.duration-section">
						<span className={styles.sectionLabel} data-flx="messaging.create-poll-modal.duration-label">
							{i18n._(DURATION_LABEL_DESCRIPTOR)}
						</span>
						<div className={styles.durations} data-flx="messaging.create-poll-modal.durations">
							{presets.map((hours) => (
								<button
									key={hours}
									type="button"
									className={clsx(
										styles.durationPill,
										!useCustom && durationHours === hours && styles.durationPillActive,
									)}
									onClick={() => {
										setUseCustom(false);
										setDurationHours(hours);
									}}
									data-flx="messaging.create-poll-modal.duration-preset"
								>
									{formatPreset(hours)}
								</button>
							))}
							<button
								type="button"
								className={clsx(styles.durationPill, useCustom && styles.durationPillActive)}
								onClick={() => {
									setUseCustom(true);
									if (customDuration === '') setCustomDuration(String(durationHours));
								}}
								data-flx="messaging.create-poll-modal.duration-custom"
							>
								{i18n._(CUSTOM_DURATION_DESCRIPTOR)}
							</button>
						</div>
						{useCustom && (
							<div className={styles.customDuration} data-flx="messaging.create-poll-modal.custom-duration">
								<Input
									type="number"
									min={POLL_MIN_DURATION_HOURS}
									max={Math.min(limits.max_duration_hours, POLL_MAX_DURATION_HOURS_CEILING)}
									value={customDuration}
									onChange={(event) => setCustomDuration(event.currentTarget.value)}
									error={
										durationValid
											? undefined
											: i18n._(DURATION_RANGE_ERROR_DESCRIPTOR, {
													min: POLL_MIN_DURATION_HOURS,
													max: limits.max_duration_hours,
												})
									}
									data-flx="messaging.create-poll-modal.custom-duration-input"
								/>
								<span>{i18n._(HOURS_SUFFIX_DESCRIPTOR)}</span>
							</div>
						)}
					</div>

					<Switch
						label={i18n._(MULTISELECT_LABEL_DESCRIPTOR)}
						description={limits.allow_multiselect ? undefined : i18n._(MULTISELECT_DISABLED_DESCRIPTOR)}
						value={multiselect && limits.allow_multiselect}
						onChange={setMultiselect}
						disabled={!limits.allow_multiselect}
						data-flx="messaging.create-poll-modal.multiselect-switch"
					/>

					<Switch
						label={i18n._(VOTE_CHANGE_LABEL_DESCRIPTOR)}
						description={i18n._(VOTE_CHANGE_DESCRIPTION_DESCRIPTOR)}
						value={allowVoteChange}
						onChange={setAllowVoteChange}
						data-flx="messaging.create-poll-modal.vote-change-switch"
					/>

					{error && (
						<div className={styles.error} role="alert" data-flx="messaging.create-poll-modal.error">
							{error}
						</div>
					)}
				</Modal.ContentLayout>
			</Modal.Content>
			<Modal.Footer data-flx="messaging.create-poll-modal.modal-footer">
				<Button
					type="button"
					variant="secondary"
					disabled={submitting}
					onClick={() => ModalCommands.pop()}
					data-flx="messaging.create-poll-modal.cancel-button"
				>
					<Trans>Never mind</Trans>
				</Button>
				<Button
					type="button"
					submitting={submitting}
					disabled={!canSubmit}
					onClick={() => void handleSubmit()}
					data-flx="messaging.create-poll-modal.post-button"
				>
					{i18n._(POST_DESCRIPTOR)}
				</Button>
			</Modal.Footer>
		</Modal.Root>
	);
});

export async function openCreatePollModal(channelId: string, guildId?: string | null): Promise<void> {
	const limits = await PollCommands.getEffectiveLimits(guildId);
	ModalCommands.push(
		ModalCommands.modal(() => <CreatePollModal channelId={channelId} guildId={guildId} limits={limits} />),
	);
}
