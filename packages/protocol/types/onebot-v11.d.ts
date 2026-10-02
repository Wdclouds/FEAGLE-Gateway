/**
 * OneBot v11 Protocol Specification Type Definitions
 * Designed for FEAGLE Protocol Gateway & downstream LLM agents.
 */

export namespace OneBotV11 {
  // -------------------------------------------------------------
  // 1. Message Segments (CQ Code / Segment Array)
  // -------------------------------------------------------------
  export type TextSegment = {
    type: 'text';
    data: { text: string };
  };

  export type ImageSegment = {
    type: 'image';
    data: {
      file: string; // url, file://, or base64://
      type?: 'flash' | 'show';
      url?: string;
    };
  };

  export type AtSegment = {
    type: 'at';
    data: {
      qq: string | 'all';
      name?: string;
    };
  };

  export type ReplySegment = {
    type: 'reply';
    data: { id: string | number };
  };

  export type FaceSegment = {
    type: 'face';
    data: { id: string | number };
  };

  export type MessageSegment =
    | TextSegment
    | ImageSegment
    | AtSegment
    | ReplySegment
    | FaceSegment
    | { type: string; data: Record<string, unknown> };

  export type MessagePayload = string | MessageSegment[];

  // -------------------------------------------------------------
  // 2. Sender Profile Information
  // -------------------------------------------------------------
  export interface SenderInfo {
    user_id: number;
    nickname: string;
    card?: string;
    sex?: 'male' | 'female' | 'unknown';
    age?: number;
    area?: string;
    level?: string;
    role?: 'owner' | 'admin' | 'member';
    title?: string;
  }

  // -------------------------------------------------------------
  // 3. Post Events (Push from Gateway to Bot Engine)
  // -------------------------------------------------------------
  export interface BaseEvent {
    time: number;
    self_id: number;
    post_type: 'message' | 'notice' | 'request' | 'meta_event';
  }

  export interface PrivateMessageEvent extends BaseEvent {
    post_type: 'message';
    message_type: 'private';
    sub_type: 'friend' | 'group' | 'other';
    message_id: number;
    user_id: number;
    message: MessageSegment[];
    raw_message: string;
    font: number;
    sender: SenderInfo;
  }

  export interface GroupMessageEvent extends BaseEvent {
    post_type: 'message';
    message_type: 'group';
    sub_type: 'normal' | 'anonymous' | 'notice';
    message_id: number;
    group_id: number;
    group_name?: string;
    user_id: number;
    anonymous: null | {
      id: number;
      name: string;
      flag: string;
    };
    message: MessageSegment[];
    raw_message: string;
    font: number;
    sender: SenderInfo;
  }

  export interface HeartbeatMetaEvent extends BaseEvent {
    post_type: 'meta_event';
    meta_event_type: 'heartbeat';
    status: {
      online: boolean;
      good: boolean;
    };
    interval: number;
  }

  export interface LifecycleMetaEvent extends BaseEvent {
    post_type: 'meta_event';
    meta_event_type: 'lifecycle';
    sub_type: 'enable' | 'disable' | 'connect';
  }

  export interface NoticeEvent extends BaseEvent {
    post_type: 'notice';
    notice_type: string;
    [key: string]: unknown;
  }

  export type PostEvent =
    | PrivateMessageEvent
    | GroupMessageEvent
    | HeartbeatMetaEvent
    | LifecycleMetaEvent
    | NoticeEvent;

  // -------------------------------------------------------------
  // 4. Actions (API Calls from Bot Engine to Gateway)
  // -------------------------------------------------------------
  export interface ActionRequest<T = Record<string, unknown>> {
    action: string;
    params?: T;
    echo?: string | number;
  }

  export interface SendPrivateMsgParams {
    user_id: number;
    message: MessagePayload;
    auto_escape?: boolean;
  }

  export interface SendGroupMsgParams {
    group_id: number;
    message: MessagePayload;
    auto_escape?: boolean;
  }

  export interface ActionResponse<T = unknown> {
    status: 'ok' | 'failed';
    retcode: number;
    data: T | null;
    message?: string;
    wording?: string;
    echo?: string | number;
  }
}
