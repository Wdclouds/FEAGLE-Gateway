/**
 * FEAGLE Android Bridge Protocol v1 Type Definitions
 * Communication between Android Hook (Agent) and Server Gateway (Bridge).
 */

export namespace FeagleAndroidV1 {
  export const PROTOCOL = 'feagle.android.v1';

  export type MessageType =
    | 'hello'
    | 'hello_ack'
    | 'heartbeat'
    | 'pong'
    | 'hook_status'
    | 'private_text'
    | 'group_text'
    | 'private_image'
    | 'group_image'
    | 'notice_event'
    | 'self_avatar'
    | 'refresh_contacts'
    | 'contacts_snapshot'
    | 'send_text'
    | 'command_result'
    | 'event_ack'
    | 'event_nack';

  export interface BaseEnvelope {
    protocol: typeof PROTOCOL;
    type: MessageType;
    deviceId: string;
  }

  // 1. Handshake & Health
  export interface HelloMessage extends BaseEnvelope {
    type: 'hello';
    hookConnected?: boolean;
    wechatVersion?: string;
  }

  export interface HelloAckMessage extends BaseEnvelope {
    type: 'hello_ack';
    selfId: string;
    serverTime: number;
  }

  export interface HeartbeatMessage extends BaseEnvelope {
    type: 'heartbeat';
    timestamp: number;
  }

  export interface PongMessage extends BaseEnvelope {
    type: 'pong';
    timestamp: number;
  }

  export interface HookStatusMessage extends BaseEnvelope {
    type: 'hook_status';
    connected: boolean;
  }

  // 2. Inbound Messages (Android -> Bridge)
  export interface InboundTextMessage extends BaseEnvelope {
    type: 'private_text' | 'group_text';
    eventId: string;
    talker: string;
    content: string;
    createTime: number;
    msgId?: number;
    msgSvrId?: number;
    sender?: string;
    groupName?: string;
    displayName?: string;
    mentioned?: boolean;
    quoteSvrId?: number;
  }

  export interface InboundImageMessage extends BaseEnvelope {
    type: 'private_image' | 'group_image';
    eventId: string;
    talker: string;
    imageBase64: string;
    imageFormat?: 'jpeg' | 'png' | 'wxgf';
    createTime: number;
    msgId?: number;
    msgSvrId?: number;
    sender?: string;
    groupName?: string;
    displayName?: string;
  }

  // 3. Contacts Synchronization
  export interface RefreshContactsCommand extends BaseEnvelope {
    type: 'refresh_contacts';
    commandId: string;
    includeAvatars?: boolean;
  }

  export interface ContactGroup {
    talker: string;
    name: string;
    avatarBase64?: string;
    memberCount?: number;
  }

  export interface ContactPrivate {
    talker: string;
    name: string;
    avatarBase64?: string;
  }

  export interface ContactsSnapshotMessage extends BaseEnvelope {
    type: 'contacts_snapshot';
    commandId: string;
    full: boolean;
    generatedAt: string;
    groups: ContactGroup[];
    privates?: ContactPrivate[];
    privateContacts?: ContactPrivate[];
  }

  // 4. Outbound Commands & Acknowledgements
  export interface SendTextCommand extends BaseEnvelope {
    type: 'send_text';
    commandId: string;
    chatType: 'private' | 'group';
    talker: string;
    content: string;
  }

  export interface CommandResult extends BaseEnvelope {
    type: 'command_result';
    commandId: string;
    ok: boolean;
    error?: string;
  }

  export interface EventAck extends BaseEnvelope {
    type: 'event_ack';
    eventId: string;
  }

  export interface EventNack extends BaseEnvelope {
    type: 'event_nack';
    eventId: string;
    retryAfterMs?: number;
    reason?: string;
  }

  export type AnyEnvelope =
    | HelloMessage
    | HelloAckMessage
    | HeartbeatMessage
    | PongMessage
    | HookStatusMessage
    | InboundTextMessage
    | InboundImageMessage
    | RefreshContactsCommand
    | ContactsSnapshotMessage
    | SendTextCommand
    | CommandResult
    | EventAck
    | EventNack;
}
