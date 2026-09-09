// SPDX-License-Identifier: AGPL-3.0-or-later

import {msg} from '@lingui/core/macro';

export const SOUNDBOARD_SOUND_CREATE_SUMMARY = msg({
	message: '{actor} added the soundboard sound {name}',
	comment:
		'Activity log summary for a sound that was uploaded to the community soundboard. {actor} is the member who added it, shown as a clickable user chip, or the word System. {name} is the sound name, shown in bold. The app adds the bold, so do not add ** or <b>.',
});
export const SOUNDBOARD_SOUND_CREATE_UNNAMED_SUMMARY = msg({
	message: '{actor} added a soundboard sound',
	comment:
		'Activity log summary for a sound that was added to the community soundboard when its name was not recorded. {actor} is the member who added it, shown as a clickable user chip, or the word System.',
});
export const SOUNDBOARD_SOUND_RENAME_SUMMARY = msg({
	message: '{actor} renamed the soundboard sound {oldName} to {newName}',
	comment:
		'Activity log summary for a soundboard sound that got a new name and no other change. {actor} is the member who renamed it, shown as a clickable user chip, or the word System. {oldName} is the previous sound name and {newName} is the new one, both shown in bold. The app adds the bold, so do not add ** or <b>.',
});
export const SOUNDBOARD_SOUND_UPDATE_SUMMARY = msg({
	message: '{actor} updated the soundboard sound {name}',
	comment:
		'Activity log summary for a soundboard sound that was edited. The changes are listed as detail lines below it. {actor} is the member who edited it, shown as a clickable user chip, or the word System. {name} is the sound name, shown in bold. The app adds the bold, so do not add ** or <b>.',
});
export const SOUNDBOARD_SOUND_UPDATE_UNNAMED_SUMMARY = msg({
	message: '{actor} updated a soundboard sound',
	comment:
		'Activity log summary for a soundboard sound that was edited when the sound name is not known. The changes are listed as detail lines below it. {actor} is the member who edited it, shown as a clickable user chip, or the word System.',
});
export const SOUNDBOARD_SOUND_NAME_CHANGED_ROW = msg({
	message: 'Changed the name from {oldName} to {newName}',
	comment:
		'Activity log detail line under an edited soundboard sound, for a sound that got a new name. It continues the entry summary, so it has no subject. It is a past tense record of a change the actor in the summary already made, never an instruction to the reader. Do not write it as a command, a button label or in first or second person. Keep the word name so the line says what changed. {oldName} is the previous sound name and {newName} is the new one, both shown in bold. The app adds the bold, so do not add ** or <b>.',
});
export const SOUNDBOARD_SOUND_VOLUME_CHANGED_ROW = msg({
	message: 'Changed the volume from {oldVolume}% to {newVolume}%',
	comment:
		'Activity log detail line under an edited soundboard sound, for a sound whose playback volume was changed. It continues the entry summary, so it has no subject. It is a past tense record of a change the actor in the summary already made, never an instruction to the reader. Do not write it as a command, a button label or in first or second person. {oldVolume} and {newVolume} are whole numbers from 0 to 100, and the percent sign stays after each.',
});
export const SOUNDBOARD_SOUND_EMOJI_CHANGED_ROW = msg({
	message: 'Changed the emoji',
	comment:
		'Activity log detail line under an edited soundboard sound, for a sound whose emoji was set, replaced or removed. It continues the entry summary, so it has no subject. It is a past tense record of a change the actor in the summary already made, never an instruction to the reader. Do not write it as a command, a button label or in first or second person.',
});
export const SOUNDBOARD_SOUND_DELETE_SUMMARY = msg({
	message: '{actor} deleted the soundboard sound {name}',
	comment:
		'Activity log summary for a sound that was deleted from the community soundboard. {actor} is the member who deleted it, shown as a clickable user chip, or the word System. {name} is the name of the deleted sound, shown in bold. The app adds the bold, so do not add ** or <b>.',
});
export const SOUNDBOARD_SOUND_DELETE_UNNAMED_SUMMARY = msg({
	message: '{actor} deleted a soundboard sound',
	comment:
		'Activity log summary for a sound that was deleted from the community soundboard when its name was not recorded. {actor} is the member who deleted it, shown as a clickable user chip, or the word System.',
});
export const SOUNDBOARD_SOUND_UPLOADER_ROW = msg({
	message: 'The sound was uploaded by {user}',
	comment:
		'Activity log detail line under a deleted soundboard sound, shown only when someone other than the person who deleted it had uploaded it. {user} is the user who uploaded the sound, shown as a clickable user chip.',
});
