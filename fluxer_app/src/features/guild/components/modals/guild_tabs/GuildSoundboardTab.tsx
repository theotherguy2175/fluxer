// SPDX-License-Identifier: AGPL-3.0-or-later

import {GenericErrorModal} from '@app/features/app/components/alerts/GenericErrorModal';
import {ConfirmModal} from '@app/features/app/components/dialogs/ConfirmModal';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import {
	seedGuildSoundboardCache,
	subscribeToGuildSoundboardUpdates,
} from '@app/features/expressions/state/GuildSoundboardCache';
import {
	isValidSoundboardSoundFile,
	SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT,
} from '@app/features/expressions/utils/SoundboardClientValidators';
import styles from '@app/features/guild/components/modals/guild_tabs/GuildSoundboardTab.module.css';
import {UploadDropZone} from '@app/features/guild/components/UploadDropZone';
import {UploadSlotInfo} from '@app/features/guild/components/UploadSlotInfo';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import Permission from '@app/features/permissions/state/Permission';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {failureValidationErrors} from '@app/features/platform/utils/ResponseInspection';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Switch} from '@app/features/ui/components/form/FormSwitch';
import {Spinner} from '@app/features/ui/components/Spinner';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import Users from '@app/features/user/state/Users';
import * as AvatarUtils from '@app/features/user/utils/AvatarUtils';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {SoundboardSoundModal} from '@app/features/voice/components/SoundboardSoundModal';
import SoundboardPlaybackEngine from '@app/features/voice/engine/SoundboardPlaybackEngine';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {
	SOUNDBOARD_DEFAULT_MAX_DURATION_MS,
	SOUNDBOARD_DEFAULT_MAX_SOUNDS,
	SOUNDBOARD_MAX_BYTES,
	SOUNDBOARD_MIN_DURATION_MS,
} from '@fluxer/constants/src/SoundboardConstants';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {sortBySnowflakeDesc} from '@fluxer/snowflake/src/SnowflakeUtils';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {PencilSimpleIcon, SpeakerHighIcon, TrashIcon, WarningCircleIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useState} from 'react';

const NO_SOUNDBOARD_SLOTS_AVAILABLE_DESCRIPTOR = msg({
	message: 'No soundboard slots available',
	comment: 'Empty-state text in the guild soundboard tab.',
});
const SOUNDBOARD_SLOTS_FULL_DESCRIPTION_DESCRIPTOR = msg({
	message: "You've reached the maximum number of soundboard sounds. Delete an existing sound to make room.",
	comment: 'Soundboard upload limit message in community soundboard settings.',
});
const UNSUPPORTED_SOUND_FILE_DESCRIPTOR = msg({
	message: 'Unsupported audio file',
	comment: 'Title of the error modal shown when an unsupported soundboard file type is selected.',
});
const UNSUPPORTED_SOUND_FILE_BODY_DESCRIPTOR = msg({
	message: 'Soundboard sounds must be MP3, OGG, M4A, or WAV audio under {maxSize}.',
	comment:
		'Body of the error modal shown when an unsupported soundboard file is selected. {maxSize} is a formatted file size.',
});
const SOUNDBOARD_UPLOAD_REQUIREMENTS_DESCRIPTOR = msg({
	message: 'Sounds must be under {maxSize} and at most {maxSeconds} seconds long.',
	comment:
		'Description in the community soundboard upload section. {maxSize} is a formatted file size, {maxSeconds} a number.',
});
const FAILED_TO_LOAD_SOUNDS_DESCRIPTOR = msg({
	message: 'Failed to load soundboard sounds',
	comment: 'Error message in the guild soundboard tab.',
});
const PLAY_SOUND_DESCRIPTOR = msg({
	message: 'Play',
	comment: 'Button label to preview a soundboard sound.',
});
const EDIT_SOUND_DESCRIPTOR = msg({
	message: 'Edit',
	comment: 'Button label to edit a soundboard sound.',
});
const DELETE_SOUND_DESCRIPTOR = msg({
	message: 'Delete',
	comment: 'Button label to delete a soundboard sound.',
});
const DELETE_SOUND_TITLE_DESCRIPTOR = msg({
	message: 'Delete sound',
	comment: 'Title of the confirmation dialog for deleting a soundboard sound.',
});
const DELETE_SOUND_CONFIRM_DESCRIPTOR = msg({
	message: 'Delete "{name}" from the soundboard? This cannot be undone.',
	comment: 'Body of the confirmation dialog for deleting a soundboard sound. {name} is the sound name.',
});
const FAILED_TO_DELETE_SOUND_DESCRIPTOR = msg({
	message: "Couldn't delete sound",
	comment: 'Title of the error dialog shown when deleting a soundboard sound fails.',
});
const FAILED_TO_SAVE_LIMITS_DESCRIPTOR = msg({
	message: "Couldn't save soundboard limits",
	comment: 'Title of the error modal shown when saving the guild soundboard limits fails.',
});
const INSTANCE_LIMIT_LABEL_DESCRIPTOR = msg({
	message: 'Instance limit: {max}',
	comment: 'Small hint next to a soundboard limit input showing the instance-wide ceiling set by the admin panel.',
});
const INSTANCE_CAP_ERROR_DESCRIPTOR = msg({
	message: 'This instance limits this to {max}. Ask an instance admin to raise it.',
	comment: 'Inline error under a soundboard limit input when the entered value exceeds the instance-wide ceiling.',
});
const COUNT_BELOW_INSTALLED_ERROR_DESCRIPTOR = msg({
	message: 'This community already has {installed} sounds. Delete some before setting a lower limit.',
	comment: 'Inline error under the max-sounds input when the value is below the number of sounds already uploaded.',
});

const logger = new Logger('GuildSoundboardTab');

const MIN_DURATION_SECONDS = SOUNDBOARD_MIN_DURATION_MS / 1000;

const SOUNDBOARD_DISABLED_DESCRIPTOR = msg({
	message: 'The soundboard is turned off for this instance. Existing sounds are shown for cleanup only.',
	comment: 'Notice at the top of the community soundboard tab when the instance-wide soundboard toggle is off.',
});

function formatDuration(durationMs: number): string {
	return `${(durationMs / 1000).toFixed(1)}s`;
}

const GuildSoundboardTab: React.FC<{guildId: string}> = observer(function GuildSoundboardTab({guildId}) {
	const {i18n} = useLingui();
	const [sounds, setSounds] = useState<ReadonlyArray<GuildSoundboardSoundResponse>>([]);
	const [fetchStatus, setFetchStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
	const [maxSounds, setMaxSounds] = useState<number>(SOUNDBOARD_DEFAULT_MAX_SOUNDS);
	const [maxDurationMs, setMaxDurationMs] = useState<number>(SOUNDBOARD_DEFAULT_MAX_DURATION_MS);
	const [maxSoundsCeiling, setMaxSoundsCeiling] = useState<number>(SOUNDBOARD_DEFAULT_MAX_SOUNDS);
	const [maxDurationSecCeiling, setMaxDurationSecCeiling] = useState<number>(SOUNDBOARD_DEFAULT_MAX_DURATION_MS / 1000);
	const [durationInput, setDurationInput] = useState('');
	const [countInput, setCountInput] = useState('');
	const [restartOnRepeat, setRestartOnRepeat] = useState(false);
	const [savedRestartOnRepeat, setSavedRestartOnRepeat] = useState(false);
	const [savingLimits, setSavingLimits] = useState(false);
	const soundboardEnabled = GuildSoundboardCommands.isSoundboardEnabled(guildId);
	const canCreateExpressions = Permission.can(Permissions.CREATE_EXPRESSIONS, {guildId});
	const canManageExpressions = Permission.can(Permissions.MANAGE_EXPRESSIONS, {guildId});
	const canManageGuild = Permission.can(Permissions.MANAGE_GUILD, {guildId});
	const currentUserId = Users.currentUserId;
	const applySounds = useCallback(
		(next: ReadonlyArray<GuildSoundboardSoundResponse>) => {
			const frozen = Object.freeze(sortBySnowflakeDesc([...next]));
			seedGuildSoundboardCache(guildId, frozen);
			setSounds(frozen);
		},
		[guildId],
	);
	const fetchSounds = useCallback(async () => {
		try {
			setFetchStatus((prev) => (prev === 'success' ? prev : 'pending'));
			const soundList = await GuildSoundboardCommands.list(guildId);
			applySounds(soundList.sounds);
			setMaxSounds(soundList.maxSounds);
			setMaxDurationMs(soundList.maxDurationMs);
			setMaxSoundsCeiling(soundList.maxSoundsCeiling);
			setMaxDurationSecCeiling(soundList.maxDurationMsCeiling / 1000);
			setDurationInput(String(soundList.maxDurationMs / 1000));
			setCountInput(String(soundList.maxSounds));
			setRestartOnRepeat(soundList.restartOnRepeat);
			setSavedRestartOnRepeat(soundList.restartOnRepeat);
			setFetchStatus('success');
		} catch (error) {
			logger.error('Failed to fetch soundboard sounds', error);
			setFetchStatus('error');
		}
	}, [guildId, applySounds]);
	useEffect(() => {
		if (fetchStatus === 'idle') {
			void fetchSounds();
		}
	}, [fetchStatus, fetchSounds]);
	useEffect(() => {
		return subscribeToGuildSoundboardUpdates(guildId, () => {
			void fetchSounds();
		});
	}, [guildId, fetchSounds]);
	const canModifySound = useCallback(
		(sound: GuildSoundboardSoundResponse): boolean => {
			if (canManageExpressions) return true;
			if (canCreateExpressions && sound.creator_id === currentUserId) return true;
			return false;
		},
		[canManageExpressions, canCreateExpressions, currentUserId],
	);
	const showNoSlotsModal = useCallback(() => {
		ModalCommands.push(
			modal(() => (
				<GenericErrorModal
					title={i18n._(NO_SOUNDBOARD_SLOTS_AVAILABLE_DESCRIPTOR)}
					message={i18n._(SOUNDBOARD_SLOTS_FULL_DESCRIPTION_DESCRIPTOR)}
					data-flx="guild.guild-tabs.guild-soundboard-tab.no-slots-modal"
				/>
			)),
		);
	}, [i18n]);
	const startUpload = useCallback(
		(file: File) => {
			if (sounds.length >= maxSounds) {
				showNoSlotsModal();
				return;
			}
			if (!isValidSoundboardSoundFile(file).valid) {
				ModalCommands.push(
					modal(() => (
						<GenericErrorModal
							title={i18n._(UNSUPPORTED_SOUND_FILE_DESCRIPTOR)}
							message={i18n._(UNSUPPORTED_SOUND_FILE_BODY_DESCRIPTOR, {
								maxSize: formatFileSize(SOUNDBOARD_MAX_BYTES),
							})}
							data-flx="guild.guild-tabs.guild-soundboard-tab.unsupported-file-modal"
						/>
					)),
				);
				return;
			}
			ModalCommands.push(
				modal(() => <SoundboardSoundModal mode="create" guildId={guildId} file={file} maxDurationMs={maxDurationMs} />),
			);
		},
		[sounds.length, maxSounds, maxDurationMs, guildId, showNoSlotsModal, i18n],
	);
	const handleUploadClick = useCallback(async () => {
		if (sounds.length >= maxSounds) {
			showNoSlotsModal();
			return;
		}
		const [file] = await openFilePicker({accept: SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT});
		if (file) startUpload(file);
	}, [sounds.length, maxSounds, showNoSlotsModal, startUpload]);
	const handleDrop = useCallback(
		async (files: Array<File>) => {
			const file = files[0];
			if (file) startUpload(file);
		},
		[startUpload],
	);
	const handleEdit = useCallback(
		(sound: GuildSoundboardSoundResponse) => {
			ModalCommands.push(
				modal(() => (
					<SoundboardSoundModal mode="edit" guildId={guildId} sound={sound} canDelete={canModifySound(sound)} />
				)),
			);
		},
		[guildId, canModifySound],
	);
	const handleDelete = useCallback(
		(sound: GuildSoundboardSoundResponse) => {
			ModalCommands.push(
				modal(() => (
					<ConfirmModal
						title={i18n._(DELETE_SOUND_TITLE_DESCRIPTOR)}
						description={i18n._(DELETE_SOUND_CONFIRM_DESCRIPTOR, {name: sound.name})}
						primaryText={i18n._(DELETE_SOUND_DESCRIPTOR)}
						primaryVariant="danger"
						secondaryText={i18n._(CANCEL_DESCRIPTOR)}
						onPrimary={async () => {
							try {
								await GuildSoundboardCommands.remove(guildId, sound.id);
							} catch (error) {
								logger.error('Failed to delete soundboard sound', error);
								window.setTimeout(() => {
									ModalCommands.push(
										modal(() => (
											<GenericErrorModal
												title={i18n._(FAILED_TO_DELETE_SOUND_DESCRIPTOR)}
												message={
													failureValidationErrors(error)
														?.map((entry) => entry.message)
														.join(', ') ?? (error instanceof Error ? error.message : '')
												}
												data-flx="guild.guild-tabs.guild-soundboard-tab.delete-error-modal"
											/>
										)),
									);
								}, 0);
							}
						}}
						data-flx="guild.guild-tabs.guild-soundboard-tab.delete-confirm-modal"
					/>
				)),
			);
		},
		[guildId, i18n],
	);
	const handlePreview = useCallback(
		(sound: GuildSoundboardSoundResponse) => {
			void SoundboardPlaybackEngine.play({
				hash: sound.hash,
				url: sound.url,
				volume: sound.volume,
				restartOnRepeat,
			});
		},
		[restartOnRepeat],
	);
	const parsedDurationMs = Math.round(Number.parseFloat(durationInput) * 1000);
	const parsedCount = Math.round(Number.parseFloat(countInput));
	const durationCeilingMs = Math.round(maxDurationSecCeiling * 1000);
	const durationOutOfRange = !Number.isFinite(parsedDurationMs) || parsedDurationMs < SOUNDBOARD_MIN_DURATION_MS;
	const durationOverCap = Number.isFinite(parsedDurationMs) && parsedDurationMs > durationCeilingMs;
	const countOutOfRange = !Number.isFinite(parsedCount) || parsedCount < 1;
	const countOverCap = Number.isFinite(parsedCount) && parsedCount > maxSoundsCeiling;
	const countBelowInstalled = Number.isFinite(parsedCount) && parsedCount >= 1 && parsedCount < sounds.length;
	const durationError = durationOverCap
		? i18n._(INSTANCE_CAP_ERROR_DESCRIPTOR, {max: `${maxDurationSecCeiling}s`})
		: undefined;
	const countError = countOverCap
		? i18n._(INSTANCE_CAP_ERROR_DESCRIPTOR, {max: String(maxSoundsCeiling)})
		: countBelowInstalled
			? i18n._(COUNT_BELOW_INSTALLED_ERROR_DESCRIPTOR, {installed: sounds.length})
			: undefined;
	const limitsValid =
		!durationOutOfRange && !durationOverCap && !countOutOfRange && !countOverCap && !countBelowInstalled;
	const limitsDirty =
		limitsValid &&
		(parsedDurationMs !== maxDurationMs || parsedCount !== maxSounds || restartOnRepeat !== savedRestartOnRepeat);
	const handleSaveLimits = useCallback(async () => {
		if (!limitsValid || savingLimits) return;
		setSavingLimits(true);
		try {
			const result = await GuildSoundboardCommands.updateSettings(guildId, {
				maxDurationMs: parsedDurationMs,
				maxSounds: parsedCount,
				restartOnRepeat,
			});
			setMaxDurationMs(result.max_duration_ms);
			setMaxSounds(result.max_sounds);
			setDurationInput(String(result.max_duration_ms / 1000));
			setCountInput(String(result.max_sounds));
			setRestartOnRepeat(result.restart_on_repeat);
			setSavedRestartOnRepeat(result.restart_on_repeat);
		} catch (error) {
			logger.error('Failed to save soundboard limits', error);
			const validationErrors = failureValidationErrors(error);
			const message = validationErrors?.map((entry) => entry.message).join(', ');
			ModalCommands.push(
				modal(() => (
					<GenericErrorModal
						title={i18n._(FAILED_TO_SAVE_LIMITS_DESCRIPTOR)}
						message={message ?? (error instanceof Error ? error.message : '')}
						data-flx="guild.guild-tabs.guild-soundboard-tab.limits-error-modal"
					/>
				)),
			);
		} finally {
			setSavingLimits(false);
		}
	}, [guildId, limitsValid, savingLimits, parsedDurationMs, parsedCount, restartOnRepeat, i18n]);
	return (
		<div className={styles.container} data-flx="guild.guild-tabs.guild-soundboard-tab.container">
			{!soundboardEnabled && (
				<div className={styles.notice} data-flx="guild.guild-tabs.guild-soundboard-tab.disabled-notice">
					<p className={styles.noticeText} data-flx="guild.guild-tabs.guild-soundboard-tab.disabled-notice-text">
						<WarningCircleIcon
							size={32}
							weight="fill"
							data-flx="guild.guild-tabs.guild-soundboard-tab.disabled-warning-icon"
						/>
						{i18n._(SOUNDBOARD_DISABLED_DESCRIPTOR)}
					</p>
				</div>
			)}
			{soundboardEnabled && canCreateExpressions && (
				<>
					<UploadSlotInfo
						title={<Trans>Soundboard sounds</Trans>}
						currentCount={sounds.length}
						maxCount={maxSounds}
						uploadButtonText={<Trans>Upload sound</Trans>}
						onUploadClick={handleUploadClick}
						description={i18n._(SOUNDBOARD_UPLOAD_REQUIREMENTS_DESCRIPTOR, {
							maxSize: formatFileSize(SOUNDBOARD_MAX_BYTES),
							maxSeconds: (maxDurationMs / 1000).toFixed(1),
						})}
						data-flx="guild.guild-tabs.guild-soundboard-tab.upload-slot-info"
					/>
					<UploadDropZone
						onDrop={handleDrop}
						description={<Trans>Drag and drop an audio file here (one at a time)</Trans>}
						acceptMultiple={false}
						data-flx="guild.guild-tabs.guild-soundboard-tab.upload-drop-zone"
					/>
				</>
			)}
			{soundboardEnabled && canManageGuild && fetchStatus === 'success' && (
				<div className={styles.limitsSection} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-section">
					<div className={styles.limitsHeader} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-header">
						<h3 className={styles.limitsTitle} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-title">
							<Trans>Limits & playback</Trans>
						</h3>
						<p className={styles.limitsHint} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-hint">
							<Trans>
								Set how long soundboard sounds can be, how many this community can hold, and how repeated sounds behave.
								Requires Manage Community.
							</Trans>
						</p>
					</div>
					<div className={styles.limitsGrid} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-grid">
						<Input
							type="number"
							label={<Trans>Max duration (seconds)</Trans>}
							labelRight={
								<span
									className={styles.limitHint}
									data-flx="guild.guild-tabs.guild-soundboard-tab.duration-ceiling-hint"
								>
									{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: `${maxDurationSecCeiling}s`})}
								</span>
							}
							value={durationInput}
							min={MIN_DURATION_SECONDS}
							max={maxDurationSecCeiling}
							step={0.1}
							error={durationError}
							onChange={(event) => setDurationInput(event.currentTarget.value)}
							data-flx="guild.guild-tabs.guild-soundboard-tab.limits-duration-input"
						/>
						<Input
							type="number"
							label={<Trans>Max sounds</Trans>}
							labelRight={
								<span className={styles.limitHint} data-flx="guild.guild-tabs.guild-soundboard-tab.count-ceiling-hint">
									{i18n._(INSTANCE_LIMIT_LABEL_DESCRIPTOR, {max: String(maxSoundsCeiling)})}
								</span>
							}
							value={countInput}
							min={1}
							max={maxSoundsCeiling}
							step={1}
							error={countError}
							onChange={(event) => setCountInput(event.currentTarget.value)}
							data-flx="guild.guild-tabs.guild-soundboard-tab.limits-count-input"
						/>
					</div>
					<Switch
						value={restartOnRepeat}
						onChange={setRestartOnRepeat}
						label={<Trans>Restart a sound when it's re-triggered</Trans>}
						description={
							<Trans>
								When someone plays the same sound again while it's still playing, stop it and start it over instead of
								layering another copy. Different sounds still overlap.
							</Trans>
						}
					/>
					<div className={styles.limitsActions} data-flx="guild.guild-tabs.guild-soundboard-tab.limits-actions">
						<Button
							type="button"
							small
							disabled={!limitsDirty}
							submitting={savingLimits}
							onClick={handleSaveLimits}
							data-flx="guild.guild-tabs.guild-soundboard-tab.limits-save-button"
						>
							<Trans>Save changes</Trans>
						</Button>
					</div>
				</div>
			)}
			{fetchStatus === 'pending' && (
				<div className={styles.spinnerContainer} data-flx="guild.guild-tabs.guild-soundboard-tab.spinner-container">
					<Spinner data-flx="guild.guild-tabs.guild-soundboard-tab.spinner" />
				</div>
			)}
			{fetchStatus === 'success' && sounds.length > 0 && (
				<div className={styles.soundList} data-flx="guild.guild-tabs.guild-soundboard-tab.sound-list">
					<div className={styles.headerRow} data-flx="guild.guild-tabs.guild-soundboard-tab.header-row">
						<span className={styles.colEmoji}>
							<Trans>Emoji</Trans>
						</span>
						<span className={styles.colName}>
							<Trans>Name</Trans>
						</span>
						<span className={styles.colUser}>
							<Trans>Uploaded by</Trans>
						</span>
						<span className={styles.colDuration} />
						<span className={styles.colActions} />
					</div>
					{sounds.map((sound) => {
						const displayName = sound.user ? NicknameUtils.getDisplayName(sound.user) : null;
						const avatarUrl = sound.user ? AvatarUtils.getUserAvatarURL(sound.user, false) : null;
						return (
							<div
								key={sound.id}
								className={styles.soundRow}
								data-flx="guild.guild-tabs.guild-soundboard-tab.sound-row"
							>
								<span className={styles.emojiCell} data-flx="guild.guild-tabs.guild-soundboard-tab.emoji-cell">
									{sound.emoji_id || sound.emoji_name ? (
										<SoundboardEmoji
											emojiId={sound.emoji_id}
											emojiName={sound.emoji_name}
											emojiAnimated={sound.emoji_animated}
											size={20}
										/>
									) : (
										<SpeakerHighIcon
											size={16}
											className={styles.emojiFallbackIcon}
											data-flx="guild.guild-tabs.guild-soundboard-tab.emoji-fallback-icon"
										/>
									)}
								</span>
								<span className={styles.soundName} data-flx="guild.guild-tabs.guild-soundboard-tab.sound-name">
									<span
										className={styles.soundNameText}
										data-flx="guild.guild-tabs.guild-soundboard-tab.sound-name-text"
									>
										{sound.name}
									</span>
									<Tooltip
										text={i18n._(PLAY_SOUND_DESCRIPTOR)}
										data-flx="guild.guild-tabs.guild-soundboard-tab.preview-tooltip"
									>
										<button
											type="button"
											className={styles.namePreviewButton}
											onClick={() => handlePreview(sound)}
											aria-label={i18n._(PLAY_SOUND_DESCRIPTOR)}
											data-flx="guild.guild-tabs.guild-soundboard-tab.name-preview-button"
										>
											<SpeakerHighIcon
												size={15}
												weight="fill"
												data-flx="guild.guild-tabs.guild-soundboard-tab.preview-speaker-icon"
											/>
										</button>
									</Tooltip>
								</span>
								<span className={styles.soundUser} data-flx="guild.guild-tabs.guild-soundboard-tab.sound-user">
									{displayName ? (
										<>
											{avatarUrl && (
												<img
													src={avatarUrl}
													alt=""
													className={styles.userAvatar}
													data-flx="guild.guild-tabs.guild-soundboard-tab.user-avatar"
												/>
											)}
											<span className={styles.userName}>{displayName}</span>
										</>
									) : (
										<span className={styles.userName}>—</span>
									)}
								</span>
								<span className={styles.soundDuration} data-flx="guild.guild-tabs.guild-soundboard-tab.sound-duration">
									{formatDuration(sound.duration_ms)}
								</span>
								<span className={styles.colActions}>
									{canModifySound(sound) && (
										<>
											<Tooltip
												text={i18n._(EDIT_SOUND_DESCRIPTOR)}
												data-flx="guild.guild-tabs.guild-soundboard-tab.edit-tooltip"
											>
												<button
													type="button"
													className={styles.rowButton}
													onClick={() => handleEdit(sound)}
													aria-label={i18n._(EDIT_SOUND_DESCRIPTOR)}
													data-flx="guild.guild-tabs.guild-soundboard-tab.edit-button"
												>
													<PencilSimpleIcon size={15} data-flx="guild.guild-tabs.guild-soundboard-tab.pencil-icon" />
												</button>
											</Tooltip>
											<Tooltip
												text={i18n._(DELETE_SOUND_DESCRIPTOR)}
												data-flx="guild.guild-tabs.guild-soundboard-tab.delete-tooltip"
											>
												<button
													type="button"
													className={clsx(styles.rowButton, styles.rowButtonDanger)}
													onClick={() => handleDelete(sound)}
													aria-label={i18n._(DELETE_SOUND_DESCRIPTOR)}
													data-flx="guild.guild-tabs.guild-soundboard-tab.delete-button"
												>
													<TrashIcon size={15} data-flx="guild.guild-tabs.guild-soundboard-tab.trash-icon" />
												</button>
											</Tooltip>
										</>
									)}
								</span>
							</div>
						);
					})}
				</div>
			)}
			{fetchStatus === 'error' && (
				<div className={styles.notice} data-flx="guild.guild-tabs.guild-soundboard-tab.notice">
					<p className={styles.noticeText} data-flx="guild.guild-tabs.guild-soundboard-tab.notice-text">
						<WarningCircleIcon
							size={32}
							weight="fill"
							data-flx="guild.guild-tabs.guild-soundboard-tab.warning-circle-icon"
						/>
						{i18n._(FAILED_TO_LOAD_SOUNDS_DESCRIPTOR)}
					</p>
				</div>
			)}
		</div>
	);
});

export default GuildSoundboardTab;
