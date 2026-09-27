import type { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';

export interface PlayTarget {
    id: string
    name: string
    appName?: string
    /** Stable id of the device behind a session (sessions come and go) */
    deviceId?: string
    /** Name of the item this session is playing, if any */
    nowPlayingName?: string
    playerName?: string
    deviceType?: string
    isLocalPlayer?: boolean
    playableMediaTypes: MediaType[]
    supportedCommands?: string[]
    user?: UserDto
}
