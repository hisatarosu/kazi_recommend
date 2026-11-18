// LINE Messaging API の薄いクライアント

import type { LineMessage } from "./messages";

const API_BASE = "https://api.line.me";

export interface LineSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineEvent {
  type: string;
  replyToken?: string;
  source: LineSource;
  message?: { type: string; text?: string };
  postback?: { data: string };
}

/** 送り先のID (グループならグループID、1対1ならユーザーID) */
export function targetIdOf(source: LineSource): string | undefined {
  return source.groupId ?? source.roomId ?? source.userId;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Webhook が本当に LINE から来たかを x-line-signature で検証する */
export async function verifySignature(
  body: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false;
  const sig = base64ToBytes(signature);
  if (!sig) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(body));
}

export class LineClient {
  constructor(private readonly token: string) {}

  private async call(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`LINE API ${path} failed: ${res.status} ${await res.clone().text()}`);
    }
    return res;
  }

  /** 返信 (無料枠の通数にカウントされない) */
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    await this.call("/v2/bot/message/reply", { replyToken, messages });
  }

  /** プッシュ通知 (無料枠の通数にカウントされる) */
  async push(to: string, messages: LineMessage[]): Promise<boolean> {
    const res = await this.call("/v2/bot/message/push", { to, messages });
    return res.ok;
  }

  /** 表示名を取得。取れなければ null */
  async displayName(source: LineSource): Promise<string | null> {
    if (!source.userId) return null;
    const path = source.groupId
      ? `/v2/bot/group/${source.groupId}/member/${source.userId}`
      : source.roomId
        ? `/v2/bot/room/${source.roomId}/member/${source.userId}`
        : `/v2/bot/profile/${source.userId}`;
    const res = await this.call(path);
    if (!res.ok) return null;
    const profile = (await res.json()) as { displayName?: string };
    return profile.displayName ?? null;
  }
}
