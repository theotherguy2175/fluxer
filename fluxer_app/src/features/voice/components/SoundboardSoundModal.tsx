// SPDX-License-Identifier: AGPL-3.0-or-later

import {GenericErrorModal} from '@app/features/app/components/alerts/GenericErrorModal';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import type {SoundboardEmojiSelection} from '@app/features/expressions/commands/GuildSoundboardCommands';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {ExpressionPickerPopout} from '@app/features/expressions/components/popouts/ExpressionPickerPopout';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import {getSkinTonedSurrogate} from '@app/features/expressions/utils/SkinToneUtils';
import {
	blobToBase64,
	isValidSoundboardSoundFile,
	SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT,
} from '@app/features/expressions/utils/SoundboardClientValidators';
import UnicodeEmojis from '@app/features/expressions/utils/UnicodeEmojis';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {failureValidationErrors} from '@app/features/platform/utils/ResponseInspection';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Slider} from '@app/features/ui/components/Slider';
import {Popout} from '@app/features/ui/popover/PopoverPopout';
import {AudioWaveform, computePeaks} from '@app/features/voice/components/AudioWaveform';
import styles from '@app/features/voice/components/SoundboardSoundModal.module.css';
import {SoundWaveform} from '@app/features/voice/components/SoundWaveform';
import {encodeAudioBufferSliceToWav} from '@app/features/voice/utils/AudioWavEncode';
import {
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MAX_VOLUME,
	SOUNDBOARD_MIN_DURATION_MS,
	SOUNDBOARD_NAME_MAX_LENGTH,
} from '@fluxer/constants/src/SoundboardConstants';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {PauseIcon, PlayIcon, SmileyIcon, TrashIcon, UploadSimpleIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

const CREATE_TITLE_DESCRIPTOR = msg({message: 'Upload a Sound', comment: 'Title of the soundboard upload modal.'});
const EDIT_TITLE_DESCRIPTOR = msg({message: 'Edit Sound', comment: 'Title of the soundboard edit modal.'});
const PREVIEW_LABEL_DESCRIPTOR = msg({message: 'Preview', comment: 'Section label above the soundboard waveform.'});
const FILE_LABEL_DESCRIPTOR = msg({message: 'File', comment: 'Field label for the chosen soundboard audio file.'});
const BROWSE_DESCRIPTOR = msg({
	message: 'Browse',
	comment: 'Button that opens the OS file picker to choose a different audio file.',
});
const NAME_LABEL_DESCRIPTOR = msg({message: 'Sound Name', comment: 'Field label for a soundboard sound name.'});
const NAME_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Sound Name',
	comment: 'Placeholder for the soundboard sound name field.',
});
const EMOJI_LABEL_DESCRIPTOR = msg({message: 'Related Emoji', comment: 'Field label for a soundboard sound emoji.'});
const EMOJI_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Click to select',
	comment: 'Placeholder on the soundboard emoji picker button when no emoji is chosen.',
});
const VOLUME_LABEL_DESCRIPTOR = msg({message: 'Sound Volume', comment: 'Field label for the soundboard sound volume.'});
const CHOOSE_EMOJI_DESCRIPTOR = msg({
	message: 'Choose an emoji',
	comment: 'Accessible label for the emoji picker button in the soundboard modal.',
});
const FAILED_DESCRIPTOR = msg({
	message: "Couldn't save this sound",
	comment: 'Title of the soundboard save error modal.',
});
const PLAY_SELECTION_DESCRIPTOR = msg({
	message: 'Play selection',
	comment: 'Play button label in the soundboard trimmer.',
});
const PAUSE_DESCRIPTOR = msg({message: 'Pause', comment: 'Pause button label in the soundboard trimmer.'});
const UNSUPPORTED_FILE_TITLE_DESCRIPTOR = msg({
	message: 'Unsupported audio file',
	comment: 'Title of the error shown when a chosen soundboard file is the wrong type or too large.',
});
const UNSUPPORTED_FILE_BODY_DESCRIPTOR = msg({
	message: 'Soundboard sounds must be MP3, OGG, M4A, or WAV audio under {maxSize}.',
	comment: 'Body of the unsupported-file error. {maxSize} is a formatted file size.',
});
const ENCODED_TOO_LARGE_DESCRIPTOR = msg({
	message: 'Trimmed selection is {size} — over the {limit} limit. Pick a shorter selection.',
	comment: 'Error when a trimmed soundboard clip encodes larger than the size cap.',
});

const PEAK_BIN_COUNT = 320;
const MIN_SELECTION_SECONDS = SOUNDBOARD_MIN_DURATION_MS / 1000;

interface CreateProps {
	mode: 'create';
	guildId: string;
	file: File;
	maxDurationMs: number;
}

interface EditProps {
	mode: 'edit';
	guildId: string;
	sound: GuildSoundboardSoundResponse;
	canDelete: boolean;
}

type SoundboardSoundModalProps = CreateProps | EditProps;

function showError(title: string, message: string): void {
	ModalCommands.push(
		modal(() => (
			<GenericErrorModal title={title} message={message} data-flx="voice.soundboard-sound-modal.error-modal" />
		)),
	);
}

function errorMessage(error: unknown): string {
	const validationErrors = failureValidationErrors(error);
	return validationErrors?.map((entry) => entry.message).join(', ') ?? (error instanceof Error ? error.message : '');
}

const logger = new Logger('SoundboardSoundModal');

function formatPercent(value: number): string {
	return `${Math.round(value)}%`;
}

export const SoundboardSoundModal: React.FC<SoundboardSoundModalProps> = observer((props) => {
	const {i18n} = useLingui();
	const isEdit = props.mode === 'edit';
	const maxSelectionSeconds = props.mode === 'create' ? props.maxDurationMs / 1000 : Number.POSITIVE_INFINITY;

	const [file, setFile] = useState<File | null>(props.mode === 'create' ? props.file : null);
	const [name, setName] = useState(() => (isEdit ? props.sound.name : ''));
	const [emoji, setEmoji] = useState<SoundboardEmojiSelection & {emojiAnimated?: boolean}>(() =>
		isEdit
			? {emojiId: props.sound.emoji_id, emojiName: props.sound.emoji_name, emojiAnimated: props.sound.emoji_animated}
			: {emojiId: null, emojiName: null, emojiAnimated: false},
	);
	const [volumePercent, setVolumePercent] = useState(() => (isEdit ? Math.round(props.sound.volume * 100) : 100));
	const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
	const [decoding, setDecoding] = useState(true);
	const [startSeconds, setStartSeconds] = useState(0);
	const [endSeconds, setEndSeconds] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [playheadSeconds, setPlayheadSeconds] = useState<number | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
	const gainNodeRef = useRef<GainNode | null>(null);
	const startedAtRef = useRef(0);
	const playbackOffsetRef = useRef(0);
	const rafRef = useRef<number | null>(null);

	const sourceUrl = props.mode === 'edit' ? props.sound.url : null;

	useEffect(() => {
		let cancelled = false;
		const Ctor =
			typeof window === 'undefined'
				? null
				: window.AudioContext ||
					(window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
		if (!Ctor) {
			setDecoding(false);
			return;
		}
		setDecoding(true);
		setAudioBuffer(null);
		const ctx = new Ctor();
		audioContextRef.current = ctx;
		(async () => {
			try {
				const bytes = file
					? await file.arrayBuffer()
					: await (await fetch(sourceUrl!, {cache: 'force-cache'})).arrayBuffer();
				const decoded = await ctx.decodeAudioData(bytes.slice(0));
				if (cancelled) return;
				setAudioBuffer(decoded);
				setStartSeconds(0);
				setEndSeconds(Math.min(decoded.duration, maxSelectionSeconds));
			} catch (error) {
				logger.warn('Failed to decode soundboard preview', error);
			} finally {
				if (!cancelled) setDecoding(false);
			}
		})();
		return () => {
			cancelled = true;
			void ctx.close().catch(() => {});
			if (audioContextRef.current === ctx) audioContextRef.current = null;
		};
	}, [file, sourceUrl, maxSelectionSeconds]);

	const totalDuration = audioBuffer?.duration ?? 0;
	const peaks = useMemo(() => (audioBuffer ? computePeaks(audioBuffer, PEAK_BIN_COUNT) : null), [audioBuffer]);
	const selStart = isEdit ? 0 : startSeconds;
	const selEnd = isEdit ? totalDuration : endSeconds;
	const selectionDuration = Math.max(0, selEnd - selStart);
	const selectionOverLimit = props.mode === 'create' && selectionDuration > maxSelectionSeconds + 0.001;
	const selectionTooShort = props.mode === 'create' && selectionDuration < MIN_SELECTION_SECONDS;

	const stopPlayback = useCallback(() => {
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		const node = sourceNodeRef.current;
		if (node) {
			try {
				node.onended = null;
				node.stop();
			} catch {}
			try {
				node.disconnect();
			} catch {}
		}
		sourceNodeRef.current = null;
		gainNodeRef.current = null;
		setIsPlaying(false);
		setPlayheadSeconds(null);
	}, []);

	useEffect(() => stopPlayback, [stopPlayback]);

	useEffect(() => {
		if (gainNodeRef.current) gainNodeRef.current.gain.value = volumePercent / 100;
	}, [volumePercent]);

	const togglePlayback = useCallback(() => {
		const ctx = audioContextRef.current;
		if (!ctx || !audioBuffer) return;
		if (isPlaying) {
			stopPlayback();
			return;
		}
		void ctx.resume().catch(() => {});
		const regionStart = isEdit ? 0 : startSeconds;
		const regionEnd = isEdit ? audioBuffer.duration : endSeconds;
		const regionLength = Math.max(0.02, regionEnd - regionStart);
		const node = ctx.createBufferSource();
		node.buffer = audioBuffer;
		const gain = ctx.createGain();
		gain.gain.value = volumePercent / 100;
		node.connect(gain).connect(ctx.destination);
		sourceNodeRef.current = node;
		gainNodeRef.current = gain;
		startedAtRef.current = ctx.currentTime;
		playbackOffsetRef.current = regionStart;
		node.onended = () => {
			if (sourceNodeRef.current === node) stopPlayback();
		};
		const tick = () => {
			const context = audioContextRef.current;
			if (!context) return;
			const current = playbackOffsetRef.current + (context.currentTime - startedAtRef.current);
			if (current >= regionEnd) {
				stopPlayback();
				return;
			}
			setPlayheadSeconds(current);
			rafRef.current = requestAnimationFrame(tick);
		};
		try {
			node.start(0, regionStart, regionLength);
			setIsPlaying(true);
			setPlayheadSeconds(regionStart);
			rafRef.current = requestAnimationFrame(tick);
		} catch (error) {
			logger.warn('Failed to start soundboard preview', error);
			stopPlayback();
		}
	}, [audioBuffer, isEdit, isPlaying, startSeconds, endSeconds, stopPlayback, volumePercent]);

	const handleSelectionChange = useCallback(
		(next: {startSeconds: number; endSeconds: number}) => {
			stopPlayback();
			setStartSeconds(next.startSeconds);
			setEndSeconds(next.endSeconds);
		},
		[stopPlayback],
	);

	const handleBrowse = useCallback(async () => {
		const [picked] = await openFilePicker({accept: SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT});
		if (!picked) return;
		if (!isValidSoundboardSoundFile(picked).valid) {
			showError(
				i18n._(UNSUPPORTED_FILE_TITLE_DESCRIPTOR),
				i18n._(UNSUPPORTED_FILE_BODY_DESCRIPTOR, {maxSize: formatFileSize(i18n.locale, SOUNDBOARD_MAX_BYTES)}),
			);
			return;
		}
		stopPlayback();
		setFile(picked);
	}, [i18n, stopPlayback]);

	const trimmedName = name.trim();
	const hasEmoji = emoji.emojiId != null || (emoji.emojiName != null && emoji.emojiName.length > 0);
	const canSave =
		trimmedName.length > 0 && hasEmoji && !saving && !decoding && !selectionOverLimit && !selectionTooShort;

	const emojiLabel = useMemo(() => {
		if (emoji.emojiId != null && emoji.emojiName) return `:${emoji.emojiName}:`;
		if (emoji.emojiName) return UnicodeEmojis.nameForSurrogate(emoji.emojiName, true, emoji.emojiName);
		return null;
	}, [emoji.emojiId, emoji.emojiName]);

	const handleSave = useCallback(async () => {
		if (saving) return;
		setSaving(true);
		try {
			const volume = Math.max(0, Math.min(SOUNDBOARD_MAX_VOLUME, volumePercent / 100));
			if (props.mode === 'create') {
				const buffer = audioBuffer;
				if (!buffer || !file) throw new Error('Audio not ready');
				const isUntrimmed = startSeconds <= 0.001 && endSeconds >= buffer.duration - 0.001;
				const blob = isUntrimmed
					? file
					: encodeAudioBufferSliceToWav(buffer, {startSeconds, endSeconds, downmixToMono: true});
				if (blob.size > SOUNDBOARD_MAX_BYTES) {
					showError(
						i18n._(FAILED_DESCRIPTOR),
						i18n._(ENCODED_TOO_LARGE_DESCRIPTOR, {
							size: formatFileSize(i18n.locale, blob.size),
							limit: formatFileSize(i18n.locale, SOUNDBOARD_MAX_BYTES),
						}),
					);
					return;
				}
				const base64 = await blobToBase64(blob);
				await GuildSoundboardCommands.upload(
					props.guildId,
					trimmedName,
					{emojiId: emoji.emojiId ?? null, emojiName: emoji.emojiName ?? null},
					base64,
					volume,
				);
			} else {
				await GuildSoundboardCommands.update(props.guildId, props.sound.id, {
					name: trimmedName,
					emoji: {emojiId: emoji.emojiId ?? null, emojiName: emoji.emojiName ?? null},
					volume,
				});
			}
			ModalCommands.pop();
		} catch (error) {
			logger.error('Failed to save soundboard sound', error);
			showError(i18n._(FAILED_DESCRIPTOR), errorMessage(error));
		} finally {
			setSaving(false);
		}
	}, [props, file, audioBuffer, startSeconds, endSeconds, trimmedName, emoji, volumePercent, saving, i18n]);

	const handleDelete = useCallback(async () => {
		if (props.mode !== 'edit' || saving) return;
		setSaving(true);
		try {
			await GuildSoundboardCommands.remove(props.guildId, props.sound.id);
			ModalCommands.pop();
		} catch (error) {
			logger.error('Failed to delete soundboard sound', error);
			showError(i18n._(FAILED_DESCRIPTOR), errorMessage(error));
		} finally {
			setSaving(false);
		}
	}, [props, saving, i18n]);

	const durationBadge = props.mode === 'create' && audioBuffer != null && (
		<span
			className={clsx(styles.durationBadge, selectionOverLimit ? styles.durationOver : styles.durationOk)}
			data-flx="voice.soundboard-sound-modal.duration-badge"
		>
			{selectionDuration.toFixed(2)}s
		</span>
	);

	return (
		<Modal.Root onClose={() => ModalCommands.pop()} size="small" data-flx="voice.soundboard-sound-modal.modal-root">
			<Modal.Header
				title={i18n._(isEdit ? EDIT_TITLE_DESCRIPTOR : CREATE_TITLE_DESCRIPTOR)}
				data-flx="voice.soundboard-sound-modal.modal-header"
			/>
			<Modal.Content data-flx="voice.soundboard-sound-modal.modal-content">
				<Modal.ContentLayout className={styles.layout} data-flx="voice.soundboard-sound-modal.content-layout">
					<div className={styles.section} data-flx="voice.soundboard-sound-modal.preview-section">
						<span className={styles.sectionLabel} data-flx="voice.soundboard-sound-modal.preview-label">
							{i18n._(PREVIEW_LABEL_DESCRIPTOR)}
						</span>
						{isEdit ? (
							<SoundWaveform
								buffer={audioBuffer}
								loading={decoding}
								isPlaying={isPlaying}
								playheadFraction={playheadSeconds != null && totalDuration > 0 ? playheadSeconds / totalDuration : null}
								onToggle={togglePlayback}
							/>
						) : (
							<div className={styles.waveformWrap} data-flx="voice.soundboard-sound-modal.waveform-wrap">
								{peaks && audioBuffer ? (
									<AudioWaveform
										peaks={peaks}
										durationSeconds={totalDuration}
										startSeconds={selStart}
										endSeconds={selEnd}
										minSelectionSeconds={MIN_SELECTION_SECONDS}
										maxSelectionSeconds={maxSelectionSeconds}
										playheadSeconds={playheadSeconds}
										dimOutsideSelection
										onSelectionChange={handleSelectionChange}
										data-flx="voice.soundboard-sound-modal.waveform"
									/>
								) : (
									<div
										className={styles.waveformPlaceholder}
										data-flx="voice.soundboard-sound-modal.waveform-placeholder"
									/>
								)}
								<button
									type="button"
									className={styles.waveformPlay}
									onClick={togglePlayback}
									disabled={!audioBuffer}
									aria-label={i18n._(isPlaying ? PAUSE_DESCRIPTOR : PLAY_SELECTION_DESCRIPTOR)}
									data-flx="voice.soundboard-sound-modal.waveform-play"
								>
									{isPlaying ? (
										<PauseIcon size={16} weight="fill" data-flx="voice.soundboard-sound-modal.pause-icon" />
									) : (
										<PlayIcon size={16} weight="fill" data-flx="voice.soundboard-sound-modal.play-icon" />
									)}
								</button>
								{durationBadge}
							</div>
						)}
					</div>
					{props.mode === 'create' && (
						<div className={styles.section} data-flx="voice.soundboard-sound-modal.file-section">
							<span className={styles.sectionLabel} data-flx="voice.soundboard-sound-modal.file-label">
								{i18n._(FILE_LABEL_DESCRIPTOR)} <span className={styles.required}>*</span>
							</span>
							<div className={styles.fileRow} data-flx="voice.soundboard-sound-modal.file-row">
								<div className={styles.fileName} data-flx="voice.soundboard-sound-modal.file-name">
									<UploadSimpleIcon size={16} data-flx="voice.soundboard-sound-modal.upload-icon" />
									<span className={styles.fileNameText}>{file?.name ?? ''}</span>
								</div>
								<Button
									type="button"
									variant="secondary"
									small
									onClick={handleBrowse}
									data-flx="voice.soundboard-sound-modal.browse-button"
								>
									{i18n._(BROWSE_DESCRIPTOR)}
								</Button>
							</div>
						</div>
					)}
					<div className={styles.fieldRow} data-flx="voice.soundboard-sound-modal.field-row">
						<div className={styles.field} data-flx="voice.soundboard-sound-modal.name-field">
							<span className={styles.sectionLabel} data-flx="voice.soundboard-sound-modal.name-label">
								{i18n._(NAME_LABEL_DESCRIPTOR)} <span className={styles.required}>*</span>
							</span>
							<Input
								value={name}
								onChange={(event) => setName(event.currentTarget.value.slice(0, SOUNDBOARD_NAME_MAX_LENGTH))}
								maxLength={SOUNDBOARD_NAME_MAX_LENGTH}
								placeholder={i18n._(NAME_PLACEHOLDER_DESCRIPTOR)}
								data-flx="voice.soundboard-sound-modal.name-input"
							/>
						</div>
						<div className={styles.field} data-flx="voice.soundboard-sound-modal.emoji-field">
							<span className={styles.sectionLabel} data-flx="voice.soundboard-sound-modal.emoji-label">
								{i18n._(EMOJI_LABEL_DESCRIPTOR)} <span className={styles.required}>*</span>
							</span>
							<Popout
								position="bottom-start"
								animationType="none"
								offsetMainAxis={8}
								onOpen={() => setEmojiPickerOpen(true)}
								onClose={() => setEmojiPickerOpen(false)}
								render={(renderProps) => {
									const close = () => {
										renderProps.onClose();
										setEmojiPickerOpen(false);
									};
									return (
										<ExpressionPickerPopout
											visibleTabs={['emojis']}
											onEmojiSelect={(picked) => {
												if (picked.id) {
													setEmoji({
														emojiId: picked.id,
														emojiName: picked.name,
														emojiAnimated: Boolean(picked.animated),
													});
												} else {
													setEmoji({emojiId: null, emojiName: getSkinTonedSurrogate(picked), emojiAnimated: false});
												}
												close();
											}}
											onClose={close}
											data-flx="voice.soundboard-sound-modal.expression-picker-popout"
										/>
									);
								}}
								data-flx="voice.soundboard-sound-modal.popout"
							>
								<button
									type="button"
									className={styles.emojiButton}
									aria-label={i18n._(CHOOSE_EMOJI_DESCRIPTOR)}
									aria-haspopup="dialog"
									aria-expanded={emojiPickerOpen}
									data-flx="voice.soundboard-sound-modal.emoji-button"
								>
									{hasEmoji ? (
										<>
											<SoundboardEmoji
												emojiId={emoji.emojiId ?? null}
												emojiName={emoji.emojiName ?? null}
												emojiAnimated={emoji.emojiAnimated}
												size={20}
											/>
											<span className={styles.emojiLabel}>{emojiLabel}</span>
										</>
									) : (
										<>
											<SmileyIcon size={18} data-flx="voice.soundboard-sound-modal.smiley-icon" />
											<span className={styles.emojiPlaceholder}>{i18n._(EMOJI_PLACEHOLDER_DESCRIPTOR)}</span>
										</>
									)}
								</button>
							</Popout>
						</div>
					</div>
					<div className={styles.section} data-flx="voice.soundboard-sound-modal.volume-section">
						<span className={styles.sectionLabel} data-flx="voice.soundboard-sound-modal.volume-label">
							{i18n._(VOLUME_LABEL_DESCRIPTOR)}
						</span>
						<Slider
							value={volumePercent}
							defaultValue={volumePercent}
							factoryDefaultValue={100}
							minValue={0}
							maxValue={SOUNDBOARD_MAX_VOLUME * 100}
							step={1}
							ariaLabel={i18n._(VOLUME_LABEL_DESCRIPTOR)}
							onValueRender={formatPercent}
							onValueChange={setVolumePercent}
							asValueChanges={setVolumePercent}
							data-flx="voice.soundboard-sound-modal.volume-slider"
						/>
					</div>
				</Modal.ContentLayout>
			</Modal.Content>
			<Modal.Footer data-flx="voice.soundboard-sound-modal.modal-footer">
				{isEdit && props.canDelete && (
					<Button
						type="button"
						variant="danger"
						submitting={saving}
						onClick={handleDelete}
						leftIcon={<TrashIcon size={16} data-flx="voice.soundboard-sound-modal.trash-icon" />}
						data-flx="voice.soundboard-sound-modal.delete-button"
					>
						<Trans>Delete</Trans>
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					disabled={saving}
					onClick={() => ModalCommands.pop()}
					data-flx="voice.soundboard-sound-modal.cancel-button"
				>
					<Trans>Never mind</Trans>
				</Button>
				<Button
					type="button"
					submitting={saving}
					disabled={!canSave}
					onClick={handleSave}
					data-flx="voice.soundboard-sound-modal.save-button"
				>
					{isEdit ? <Trans>Save</Trans> : <Trans>Upload</Trans>}
				</Button>
			</Modal.Footer>
		</Modal.Root>
	);
});
