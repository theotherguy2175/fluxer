// SPDX-License-Identifier: AGPL-3.0-or-later

import {GenericErrorModal} from '@app/features/app/components/alerts/GenericErrorModal';
import * as GuildSoundboardCommands from '@app/features/expressions/commands/GuildSoundboardCommands';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import {
	getCachedGuildSoundboardSounds,
	subscribeToGuildSoundboardUpdates,
} from '@app/features/expressions/state/GuildSoundboardCache';
import {
	isValidSoundboardSoundFile,
	SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT,
} from '@app/features/expressions/utils/SoundboardClientValidators';
import {GuildSettingsModal} from '@app/features/guild/components/modals/GuildSettingsModal';
import {GuildIcon} from '@app/features/guild/components/popouts/GuildIcon';
import GuildSettingsModalState from '@app/features/guild/state/GuildSettingsModal';
import Guilds from '@app/features/guild/state/Guilds';
import type {KeyCombo} from '@app/features/input/state/InputKeybind';
import {formatKeyCombo} from '@app/features/input/utils/KeybindUtils';
import {openFilePicker} from '@app/features/messaging/utils/FilePickerUtils';
import {formatFileSize} from '@app/features/messaging/utils/FileUtils';
import Permission from '@app/features/permissions/state/Permission';
import AppStorage from '@app/features/platform/state/PersistentStorage';
import {Logger} from '@app/features/platform/utils/AppLogger';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Slider} from '@app/features/ui/components/Slider';
import {Tooltip} from '@app/features/ui/tooltip/Tooltip';
import {SoundboardHotkeyModal} from '@app/features/voice/components/SoundboardHotkeyModal';
import styles from '@app/features/voice/components/SoundboardMenu.module.css';
import {SoundboardSoundModal} from '@app/features/voice/components/SoundboardSoundModal';
import SoundboardPlaybackEngine from '@app/features/voice/engine/SoundboardPlaybackEngine';
import SoundboardHotkeys from '@app/features/voice/state/SoundboardHotkeys';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';
import {subscribeToSoundboardPlays} from '@app/features/voice/utils/SoundboardPlayFeed';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {SOUNDBOARD_DEFAULT_MAX_DURATION_MS, SOUNDBOARD_MAX_BYTES} from '@fluxer/constants/src/SoundboardConstants';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {
	GearSixIcon,
	KeyboardIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	SpeakerHighIcon,
	StarIcon,
} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

const PLAY_FLASH_MS = 900;

const SEARCH_PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Find the perfect sound',
	comment: 'Placeholder in the voice soundboard popover search box.',
});
const FAVORITES_DESCRIPTOR = msg({
	message: 'Favorites',
	comment: 'Section header for favorited sounds in the voice soundboard popover.',
});
const ADD_FAVORITE_DESCRIPTOR = msg({
	message: 'Add to favorites',
	comment: 'Tooltip on the star button of a soundboard sound tile.',
});
const REMOVE_FAVORITE_DESCRIPTOR = msg({
	message: 'Remove from favorites',
	comment: 'Tooltip on the star button of a favorited soundboard sound tile.',
});
const PREVIEW_SOUND_DESCRIPTOR = msg({
	message: 'Preview (only you hear this)',
	comment: 'Tooltip on the speaker button that plays a soundboard sound locally without sending it to the call.',
});
const NO_SOUNDS_DESCRIPTOR = msg({
	message: 'No soundboard sounds yet',
	comment: 'Empty state in the voice soundboard popover.',
});
const NO_MATCHES_DESCRIPTOR = msg({
	message: 'No sounds match your search',
	comment: 'Empty state in the voice soundboard popover when a search returns nothing.',
});
const ADD_SOUND_DESCRIPTOR = msg({
	message: 'Add Sound',
	comment: 'Tile in the voice soundboard popover to upload a new sound.',
});
const MY_VOLUME_DESCRIPTOR = msg({
	message: 'Soundboard volume (only you)',
	comment:
		'Accessible label of the slider in the soundboard menu that sets how loud soundboard sounds play for this member on this device.',
});
const SET_HOTKEY_DESCRIPTOR = msg({
	message: 'Set hotkey',
	comment: 'Tooltip on the keyboard button of a soundboard sound tile; opens the personal hotkey modal.',
});
const EDIT_HOTKEY_DESCRIPTOR = msg({
	message: 'Hotkey: {combo}',
	comment:
		'Tooltip on the keyboard button of a soundboard sound tile that already has a hotkey. {combo} is the key combination.',
});
const MANAGE_DESCRIPTOR = msg({
	message: 'Manage soundboard',
	comment: 'Accessible label for the settings button in the voice soundboard popover.',
});
const UNSUPPORTED_FILE_TITLE_DESCRIPTOR = msg({message: 'Unsupported audio file', comment: 'Error modal title.'});
const UNSUPPORTED_FILE_BODY_DESCRIPTOR = msg({
	message: 'Soundboard sounds must be MP3, OGG, M4A, or WAV audio under {maxSize}.',
	comment: 'Error modal body. {maxSize} is a formatted file size.',
});

const logger = new Logger('SoundboardMenu');

// Favorites are a personal, device-local preference. Must go through AppStorage:
// production builds delete window.localStorage (ProtectedWebStorage), so a direct
// access throws and nothing is saved — which is exactly what happened on prod.
function favoritesKey(guildId: string): string {
	return `soundboard:favorites:${guildId}`;
}
function readFavorites(guildId: string): Array<string> {
	try {
		const parsed = AppStorage.getJSON<unknown>(favoritesKey(guildId), []);
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
	} catch {
		return [];
	}
}
function writeFavorites(guildId: string, ids: Array<string>): void {
	try {
		AppStorage.setJSON(favoritesKey(guildId), ids);
	} catch {}
}

interface SoundboardMenuProps {
	guildId: string;
	channelId: string;
	onClose: () => void;
}

interface SoundTileProps {
	sound: GuildSoundboardSoundResponse;
	favorited: boolean;
	hotkey: KeyCombo | null;
	flashNonce: number;
	onPlay: () => void;
	onPreview: () => void;
	onToggleFavorite: () => void;
	onSetHotkey: () => void;
}

const SoundTile: React.FC<SoundTileProps> = ({
	sound,
	favorited,
	hotkey,
	flashNonce,
	onPlay,
	onPreview,
	onToggleFavorite,
	onSetHotkey,
}) => {
	const {i18n} = useLingui();
	const hotkeyText = hotkey ? formatKeyCombo(i18n, hotkey) : null;
	return (
		<div className={styles.tile} data-flx="voice.soundboard-menu.tile">
			<button
				type="button"
				className={styles.tileButton}
				onClick={onPlay}
				title={sound.name}
				data-flx="voice.soundboard-menu.tile-play"
			>
				<span className={styles.tileEmoji} data-flx="voice.soundboard-menu.tile-emoji">
					{sound.emoji_id || sound.emoji_name ? (
						<SoundboardEmoji
							emojiId={sound.emoji_id}
							emojiName={sound.emoji_name}
							emojiAnimated={sound.emoji_animated}
							size={18}
						/>
					) : (
						<SpeakerHighIcon size={16} data-flx="voice.soundboard-menu.tile-speaker" />
					)}
				</span>
				<span className={styles.tileName} data-flx="voice.soundboard-menu.tile-name">
					{sound.name}
				</span>
			</button>
			<Tooltip
				text={i18n._(PREVIEW_SOUND_DESCRIPTOR)}
				position="top"
				data-flx="voice.soundboard-menu.tile-preview-tooltip"
			>
				<button
					type="button"
					className={styles.tilePreviewButton}
					onClick={(event) => {
						event.stopPropagation();
						onPreview();
					}}
					aria-label={i18n._(PREVIEW_SOUND_DESCRIPTOR)}
					data-flx="voice.soundboard-menu.tile-preview-button"
				>
					<SpeakerHighIcon size={14} weight="fill" data-flx="voice.soundboard-menu.tile-preview-icon" />
				</button>
			</Tooltip>
			<div className={styles.tileActions} data-flx="voice.soundboard-menu.tile-actions">
				<Tooltip
					text={i18n._(favorited ? REMOVE_FAVORITE_DESCRIPTOR : ADD_FAVORITE_DESCRIPTOR)}
					position="top"
					data-flx="voice.soundboard-menu.tile-favorite-tooltip"
				>
					<button
						type="button"
						className={clsx(styles.tileActionButton, favorited && styles.tileActionButtonActive)}
						onClick={(event) => {
							event.stopPropagation();
							onToggleFavorite();
						}}
						aria-pressed={favorited}
						aria-label={i18n._(favorited ? REMOVE_FAVORITE_DESCRIPTOR : ADD_FAVORITE_DESCRIPTOR)}
						data-flx="voice.soundboard-menu.tile-favorite-button"
					>
						<StarIcon
							size={13}
							weight={favorited ? 'fill' : 'regular'}
							data-flx="voice.soundboard-menu.tile-favorite-icon"
						/>
					</button>
				</Tooltip>
				{hotkeyText ? (
					<Tooltip
						text={i18n._(EDIT_HOTKEY_DESCRIPTOR, {combo: hotkeyText})}
						position="top"
						data-flx="voice.soundboard-menu.tile-hotkey-tooltip"
					>
						<button
							type="button"
							className={styles.tileHotkeyButton}
							onClick={(event) => {
								event.stopPropagation();
								onSetHotkey();
							}}
							aria-label={i18n._(EDIT_HOTKEY_DESCRIPTOR, {combo: hotkeyText})}
							data-flx="voice.soundboard-menu.tile-hotkey-chip"
						>
							{hotkeyText}
						</button>
					</Tooltip>
				) : (
					<Tooltip
						text={i18n._(SET_HOTKEY_DESCRIPTOR)}
						position="top"
						data-flx="voice.soundboard-menu.tile-hotkey-tooltip"
					>
						<button
							type="button"
							className={styles.tileActionButton}
							onClick={(event) => {
								event.stopPropagation();
								onSetHotkey();
							}}
							aria-label={i18n._(SET_HOTKEY_DESCRIPTOR)}
							data-flx="voice.soundboard-menu.tile-hotkey-button"
						>
							<KeyboardIcon size={13} data-flx="voice.soundboard-menu.tile-hotkey-icon" />
						</button>
					</Tooltip>
				)}
			</div>
			{flashNonce > 0 && (
				<span
					key={flashNonce}
					className={styles.tilePlayedRing}
					aria-hidden="true"
					data-flx="voice.soundboard-menu.tile-played-ring"
				/>
			)}
		</div>
	);
};

export const SoundboardMenu: React.FC<SoundboardMenuProps> = observer(({guildId, channelId, onClose}) => {
	const {i18n} = useLingui();
	const guild = Guilds.getGuild(guildId);
	const [sounds, setSounds] = useState<ReadonlyArray<GuildSoundboardSoundResponse>>(() =>
		getCachedGuildSoundboardSounds(guildId),
	);
	const [maxDurationMs, setMaxDurationMs] = useState<number>(SOUNDBOARD_DEFAULT_MAX_DURATION_MS);
	const [restartOnRepeat, setRestartOnRepeat] = useState(false);
	const [query, setQuery] = useState('');
	const [favoriteIds, setFavoriteIds] = useState<Array<string>>(() => readFavorites(guildId));
	const [playFlashes, setPlayFlashes] = useState<Record<string, number>>({});
	const flashNonceRef = useRef(0);

	useEffect(() => {
		let cancelled = false;
		void GuildSoundboardCommands.list(guildId)
			.then((library) => {
				if (cancelled) return;
				setSounds(library.sounds);
				setMaxDurationMs(library.maxDurationMs);
				setRestartOnRepeat(library.restartOnRepeat);
				// Only against the server's list — the local cache can be empty before it arrives.
				SoundboardHotkeys.prune(guildId, new Set(library.sounds.map((s) => s.id)));
			})
			.catch((error) => logger.error('Failed to fetch soundboard sounds', error));
		return () => {
			cancelled = true;
		};
	}, [guildId]);
	useEffect(() => subscribeToGuildSoundboardUpdates(guildId, setSounds), [guildId]);

	const soundboardVolume = VoiceSettings.getSoundboardVolume();
	const canAdd = Permission.can(Permissions.CREATE_EXPRESSIONS, {guildId});
	const canManage = canAdd || Permission.can(Permissions.MANAGE_EXPRESSIONS, {guildId});

	const flash = useCallback((soundId: string) => {
		const nonce = (flashNonceRef.current += 1);
		setPlayFlashes((prev) => ({...prev, [soundId]: nonce}));
		window.setTimeout(() => {
			setPlayFlashes((prev) => {
				if (prev[soundId] !== nonce) return prev;
				const next = {...prev};
				delete next[soundId];
				return next;
			});
		}, PLAY_FLASH_MS);
	}, []);

	const play = useCallback(
		(soundId: string) => {
			void GuildSoundboardCommands.play(channelId, soundId).catch((error) =>
				logger.error('Failed to play soundboard sound', error),
			);
			flash(soundId);
		},
		[channelId, flash],
	);

	useEffect(() => subscribeToSoundboardPlays((soundId) => flash(soundId)), [flash]);

	const openHotkeyModal = useCallback(
		(sound: GuildSoundboardSoundResponse) => {
			onClose();
			ModalCommands.push(modal(() => <SoundboardHotkeyModal guildId={guildId} sound={sound} />));
		},
		[guildId, onClose],
	);

	const preview = useCallback(
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

	const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
	const toggleFavorite = useCallback(
		(soundId: string) => {
			const next = favoriteIds.includes(soundId)
				? favoriteIds.filter((id) => id !== soundId)
				: [...favoriteIds, soundId];
			writeFavorites(guildId, next);
			setFavoriteIds(next);
		},
		[favoriteIds, guildId],
	);

	const q = query.trim().toLowerCase();
	const soundById = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
	const filtered = useMemo(() => (q ? sounds.filter((s) => s.name.toLowerCase().includes(q)) : sounds), [sounds, q]);
	const favorites = useMemo(
		() =>
			q ? [] : favoriteIds.map((id) => soundById.get(id)).filter((s): s is GuildSoundboardSoundResponse => s != null),
		[favoriteIds, soundById, q],
	);

	const handleAdd = useCallback(async () => {
		const [file] = await openFilePicker({accept: SOUNDBOARD_SOUND_FILE_PICKER_ACCEPT});
		if (!file) return;
		onClose();
		if (!isValidSoundboardSoundFile(file).valid) {
			ModalCommands.push(
				modal(() => (
					<GenericErrorModal
						title={i18n._(UNSUPPORTED_FILE_TITLE_DESCRIPTOR)}
						message={i18n._(UNSUPPORTED_FILE_BODY_DESCRIPTOR, {
							maxSize: formatFileSize(i18n.locale, SOUNDBOARD_MAX_BYTES),
						})}
						data-flx="voice.soundboard-menu.unsupported-file-modal"
					/>
				)),
			);
			return;
		}
		ModalCommands.push(
			modal(() => <SoundboardSoundModal mode="create" guildId={guildId} file={file} maxDurationMs={maxDurationMs} />),
		);
	}, [guildId, maxDurationMs, onClose, i18n]);

	const openSettings = useCallback(() => {
		onClose();
		if (GuildSettingsModalState.navigateToTab(guildId, 'soundboard')) return;
		ModalCommands.push(
			modal(() => (
				<GuildSettingsModal
					guildId={guildId}
					initialTab="soundboard"
					data-flx="voice.soundboard-menu.open-settings.guild-settings-modal"
				/>
			)),
		);
	}, [guildId, onClose]);

	return (
		<div className={styles.panel} data-soundboard-popover="true" data-flx="voice.soundboard-menu.panel">
			<div className={styles.searchRow} data-flx="voice.soundboard-menu.search-row">
				<Input
					value={query}
					onChange={(event) => setQuery(event.currentTarget.value)}
					placeholder={i18n._(SEARCH_PLACEHOLDER_DESCRIPTOR)}
					leftIcon={<MagnifyingGlassIcon size={16} data-flx="voice.soundboard-menu.search-icon" />}
					className={styles.search}
					data-flx="voice.soundboard-menu.search-input"
				/>
				{canManage && (
					<button
						type="button"
						className={styles.gearButton}
						onClick={openSettings}
						aria-label={i18n._(MANAGE_DESCRIPTOR)}
						data-flx="voice.soundboard-menu.gear-button"
					>
						<GearSixIcon size={18} data-flx="voice.soundboard-menu.gear-icon" />
					</button>
				)}
			</div>
			<div className={styles.volumeRow} data-flx="voice.soundboard-menu.volume-row">
				<SpeakerHighIcon size={16} data-flx="voice.soundboard-menu.volume-icon" />
				<Slider
					value={soundboardVolume}
					defaultValue={soundboardVolume}
					factoryDefaultValue={100}
					minValue={0}
					maxValue={200}
					step={1}
					ariaLabel={i18n._(MY_VOLUME_DESCRIPTOR)}
					onValueRender={(value) => `${Math.round(value)}%`}
					onValueChange={(value) => VoiceSettings.setSoundboardVolume(value)}
					asValueChanges={(value) => VoiceSettings.setSoundboardVolume(value)}
					data-flx="voice.soundboard-menu.volume-slider"
				/>
			</div>
			<div className={styles.body} data-flx="voice.soundboard-menu.body">
				{favorites.length > 0 && (
					<section className={styles.section} data-flx="voice.soundboard-menu.favorites-section">
						<div className={styles.sectionHeader} data-flx="voice.soundboard-menu.favorites-header">
							<StarIcon size={14} weight="fill" data-flx="voice.soundboard-menu.star-icon" />
							<span>{i18n._(FAVORITES_DESCRIPTOR)}</span>
						</div>
						<div className={styles.grid} data-flx="voice.soundboard-menu.favorites-grid">
							{favorites.map((sound) => (
								<SoundTile
									key={`favorite-${sound.id}`}
									sound={sound}
									favorited
									flashNonce={playFlashes[sound.id] ?? 0}
									onPlay={() => play(sound.id)}
									onPreview={() => preview(sound)}
									hotkey={SoundboardHotkeys.getCombo(sound.id)}
									onToggleFavorite={() => toggleFavorite(sound.id)}
									onSetHotkey={() => openHotkeyModal(sound)}
								/>
							))}
						</div>
					</section>
				)}
				<section className={styles.section} data-flx="voice.soundboard-menu.guild-section">
					<div className={styles.sectionHeader} data-flx="voice.soundboard-menu.guild-header">
						{guild ? (
							<GuildIcon id={guild.id} name={guild.name} icon={guild.icon} sizePx={16} />
						) : (
							<SpeakerHighIcon size={14} data-flx="voice.soundboard-menu.guild-fallback-icon" />
						)}
						<span className={styles.guildName}>{guild?.name}</span>
					</div>
					{filtered.length === 0 && !(canAdd && !q) ? (
						<p className={styles.empty} data-flx="voice.soundboard-menu.empty">
							{i18n._(q ? NO_MATCHES_DESCRIPTOR : NO_SOUNDS_DESCRIPTOR)}
						</p>
					) : (
						<div className={styles.grid} data-flx="voice.soundboard-menu.guild-grid">
							{filtered.map((sound) => (
								<SoundTile
									key={sound.id}
									sound={sound}
									favorited={favoriteSet.has(sound.id)}
									flashNonce={playFlashes[sound.id] ?? 0}
									onPlay={() => play(sound.id)}
									onPreview={() => preview(sound)}
									hotkey={SoundboardHotkeys.getCombo(sound.id)}
									onToggleFavorite={() => toggleFavorite(sound.id)}
									onSetHotkey={() => openHotkeyModal(sound)}
								/>
							))}
							{canAdd && !q && (
								<button
									type="button"
									className={styles.addTile}
									onClick={handleAdd}
									data-flx="voice.soundboard-menu.add-tile"
								>
									<PlusIcon size={16} data-flx="voice.soundboard-menu.add-icon" />
									<span>{i18n._(ADD_SOUND_DESCRIPTOR)}</span>
								</button>
							)}
						</div>
					)}
				</section>
			</div>
		</div>
	);
});
