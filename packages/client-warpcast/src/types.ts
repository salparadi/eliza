import { UUID } from "@elizaos/core";

export enum TipReason {
    HIGH_QUALITY = 'HIGH_QUALITY',
    POTENTIAL_VIRALITY = 'POTENTIAL_VIRALITY',
    HIGH_ENGAGEMENT = 'HIGH_ENGAGEMENT',
    INNOVATIVE_IDEAS = 'INNOVATIVE_IDEAS'
}

export interface TipActionContent {
    reason: TipReason;
    castHash: string;
    castAuthorFID: number;
}

export interface WarpcastClientConfig {
  fid: number;
  privateKey: string;
  publicKey: string;
  baseUrl?: string;
}

export interface WarpcastAuthHeader {
  fid: number;
  type: 'app_key';
  key: string;
}

export interface WarpcastAuthPayload {
  exp: number;
}

export interface Cast {
  hash: string;
  authorFid: number;
  text: string;
  profile: Profile;
  inReplyTo?: {
    hash: string;
    fid: number;
  };
  timestamp: Date;
}

export interface Profile {
  fid: number;
  name: string;
  username: string;
  bio?: string;
  pfp?: string;
  address?: string;
}

export interface Verification {
  fid: number;
  address: string;
  timestamp: number;
  version: string;
  protocol: string;
}

export interface CastResponse {
  hash: string;
  threadHash: string;
  parentHash?: string;
  author: {
    fid: number;
    username: string;
    displayName: string;
  };
  text: string;
  timestamp: number;
  reactions: {
    likes: number;
    recasts: number;
    replies: number;
  };
}

export interface UserResponse {
  fid: number;
  username: string;
  displayName: string;
  pfp: {
    url: string;
  };
  profile: {
    bio: {
      text: string;
    };
  };
  followerCount: number;
  followingCount: number;
}

export interface CastOptions {
  text: string;
  embeds?: {
    url?: string;
  }[];
  parent?: {
    fid: number;
    hash: string;
  };
  channelId?: string;
}

export interface NotificationResponse {
  id: string;
  type: 'like' | 'recast' | 'follow' | 'mention' | 'reply' | 'cast-reply' | 'cast-reaction';
  latestTimestamp: number;
  totalItemCount: number;
  previewItems: {
    actor: UserResponse;
    content?: {
      cast?: CastResponse;
    };
  }[];
}

export interface Channel {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export interface WarpcastError extends Error {
  status?: number;
  code?: string;
  details?: any;
}

export interface PostOptions extends CastOptions {
  replyTo?: string;
  mentions?: string[];
  attachments?: string[];
}

export interface PromptOptions {
  text: string;
  channelId?: string;
  context?: {
    threadHash?: string;
    parentHash?: string;
    mentionedProfiles?: string[];
  };
}

export interface InteractionEvent {
  type: 'like' | 'recast' | 'reply' | 'mention' | 'follow';
  hash?: string;
  timestamp: number;
  actor: {
    fid: number;
    username: string;
  };
  target?: {
    fid: number;
    username: string;
  };
}

export interface ThreadResponse {
  hash: string;
  casts: CastResponse[];
  rootCast?: CastResponse;
  parentCast?: CastResponse;
}

export interface SearchOptions {
  query: string;
  filter?: 'casts' | 'users' | 'channels';
  limit?: number;
  cursor?: string;
}

export interface SearchResponse {
  casts?: CastResponse[];
  users?: UserResponse[];
  channels?: Channel[];
  next?: string;
}