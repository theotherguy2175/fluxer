// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {SoundboardEmoji} from '@app/features/expressions/components/SoundboardEmoji';
import {getCachedGuildSoundboardSounds} from '@app/features/expressions/state/GuildSoundboardCache';
import {KeybindRecorder} from '@app/features/input/components/KeybindRecorder';
import type {KeyCombo} from '@app/features/input/state/InputKeybind';
import {remFromPx} from '@app/features/theme/layout/RemFromPx';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import styles from '@app/features/voice/components/SoundboardHotkeyModal.module.css';
import SoundboardHotkeys from '@app/features/voice/state/SoundboardHotkeys';
import {findFluxerKeybindConflict} from '@app/features/voice/utils/SoundboardHotkeyConflicts';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';
import {msg} from '@lingui/core/macro';
import {Trans, useLingui} from '@lingui/react/macro';
import {SpeakerHighIcon, TrashIcon, WarningIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useMemo, useState} from 'react';

const TITLE_DESCRIPTOR = msg({
	message: 'Sound hotkey',
	comment: 'Title of the modal where a member binds a personal keyboard shortcut to a soundboard sound.',
});
const HOTKEY_LABEL_DESCRIPTOR = msg({
	message: 'Hotkey',
	comment: 'Label of the shortcut recorder in the soundboard hotkey modal.',
});
const EMPTY_COMBO: KeyCombo = {key: '', enabled: true, global: false};

// Bare left/right click would hijack normal clicking and context menus.
const isUnsupportedHotkey = (combo: KeyCombo): boolean =>
	combo.gamepadButton != null || combo.mouseButton === 0 || combo.mouseButton === 2 || combo.modifierOnly === true;

const hasTrigger = (combo: KeyCombo): boolean =>
	(combo.key ?? '') !== '' || (combo.code ?? '') !== '' || combo.mouseButton != null;

interface SoundboardHotkeyModalProps {
	guildId: string;
	sound: GuildSoundboardSoundResponse;
}

export const SoundboardHotkeyModal: React.FC<SoundboardHotkeyModalProps> = observer(({guildId, sound}) => {
	const {i18n} = useLingui();
	const existing = SoundboardHotkeys.getCombo(sound.id);
	const [combo, setCombo] = useState<KeyCombo>(() => existing ?? EMPTY_COMBO);
	const bound = hasTrigger(combo);
	const unsupported = bound && isUnsupportedHotkey(combo);

	const fluxerConflict = useMemo(() => (bound ? findFluxerKeybindConflict(combo) : null), [combo, bound]);
	const soundConflictName = useMemo(() => {
		if (!bound) return null;
		const otherId = SoundboardHotkeys.findConflict(guildId, combo, sound.id);
		if (!otherId) return null;
		return getCachedGuildSoundboardSounds(guildId).find((s) => s.id === otherId)?.name ?? otherId;
	}, [bound, combo, guildId, sound.id]);

	const canSave = !unsupported && !soundConflictName && fluxerConflict == null;

	const handleSave = () => {
		SoundboardHotkeys.setCombo(sound.id, guildId, combo);
		ModalCommands.pop();
	};
	const handleRemove = () => {
		SoundboardHotkeys.clear(sound.id);
		ModalCommands.pop();
	};

	return (
		<Modal.Root onClose={() => ModalCommands.pop()} size="small" data-flx="voice.soundboard-hotkey-modal.root">
			<Modal.Header title={i18n._(TITLE_DESCRIPTOR)} data-flx="voice.soundboard-hotkey-modal.header" />
			<Modal.Content data-flx="voice.soundboard-hotkey-modal.content">
				<Modal.ContentLayout className={styles.layout} data-flx="voice.soundboard-hotkey-modal.layout">
					<div className={styles.soundRow} data-flx="voice.soundboard-hotkey-modal.sound-row">
						<span className={styles.soundEmoji}>
							{sound.emoji_id || sound.emoji_name ? (
								<SoundboardEmoji
									emojiId={sound.emoji_id}
									emojiName={sound.emoji_name}
									emojiAnimated={sound.emoji_animated}
									size={18}
								/>
							) : (
								<SpeakerHighIcon size={16} />
							)}
						</span>
						<span className={styles.soundName}>{sound.name}</span>
					</div>
					<KeybindRecorder
						action="voice_toggle_soundboard"
						label={i18n._(HOTKEY_LABEL_DESCRIPTOR)}
						value={combo}
						onChange={(next) => setCombo({...next, global: false, enabled: true})}
						onClear={() => setCombo(EMPTY_COMBO)}
						data-flx="voice.soundboard-hotkey-modal.recorder"
					/>
					{unsupported ? (
						<p className={styles.warning} role="alert" data-flx="voice.soundboard-hotkey-modal.unsupported">
							<WarningIcon size={remFromPx(14)} weight="fill" className={styles.warningIcon} aria-hidden />
							<span>
								<Trans>
									Use a key or key combination. Plain left/right click and gamepad buttons can't be hotkeys.
								</Trans>
							</span>
						</p>
					) : fluxerConflict != null ? (
						<p className={styles.warning} role="alert" data-flx="voice.soundboard-hotkey-modal.fluxer-conflict">
							<WarningIcon size={remFromPx(14)} weight="fill" className={styles.warningIcon} aria-hidden />
							<span>
								{fluxerConflict ? (
									<Trans>Already used by the Fluxer shortcut "{fluxerConflict}". Pick a different key.</Trans>
								) : (
									<Trans>Already used by one of your custom Fluxer shortcuts. Pick a different key.</Trans>
								)}
							</span>
						</p>
					) : soundConflictName ? (
						<p className={styles.warning} role="alert" data-flx="voice.soundboard-hotkey-modal.sound-conflict">
							<WarningIcon size={remFromPx(14)} weight="fill" className={styles.warningIcon} aria-hidden />
							<span>
								<Trans>Already bound to "{soundConflictName}" in this community. Pick a different key.</Trans>
							</span>
						</p>
					) : null}
					<p className={styles.hint} data-flx="voice.soundboard-hotkey-modal.hint">
						<Trans>
							Only you get this hotkey, on this device. It plays the sound for everyone while you're in one of this
							community's voice channels and Fluxer is the focused window. Single keys pause while you're typing in a
							text box; combinations with Ctrl, Alt or ⌘ always work.
						</Trans>
					</p>
				</Modal.ContentLayout>
			</Modal.Content>
			<Modal.Footer data-flx="voice.soundboard-hotkey-modal.footer">
				{existing && (
					<Button
						type="button"
						variant="danger"
						onClick={handleRemove}
						leftIcon={<TrashIcon size={16} />}
						data-flx="voice.soundboard-hotkey-modal.remove-button"
					>
						<Trans>Remove hotkey</Trans>
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					onClick={() => ModalCommands.pop()}
					data-flx="voice.soundboard-hotkey-modal.cancel-button"
				>
					<Trans>Never mind</Trans>
				</Button>
				<Button
					type="button"
					disabled={!canSave}
					onClick={handleSave}
					data-flx="voice.soundboard-hotkey-modal.save-button"
				>
					<Trans>Save</Trans>
				</Button>
			</Modal.Footer>
		</Modal.Root>
	);
});
