// SPDX-License-Identifier: AGPL-3.0-or-later

import {updateGuildSoundboardCacheFromGateway} from '@app/features/expressions/state/GuildSoundboardCache';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {GuildSoundboardSoundResponse} from '@fluxer/schema/src/domains/guild/GuildSoundboardSchemas';

interface SoundboardSoundsUpdatePayload {
	guild_id: string;
	sounds: ReadonlyArray<GuildSoundboardSoundResponse>;
}

export function handleSoundboardSoundsUpdate(
	data: SoundboardSoundsUpdatePayload,
	_context: GatewayHandlerContext,
): void {
	updateGuildSoundboardCacheFromGateway(data.guild_id, data.sounds);
}
