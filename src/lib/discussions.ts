import { supabase } from './supabase';
import { T } from './schema';

export type DiscussionScope = 'slot' | 'event';

export type DiscussionMessage = {
  id: string;
  scope: DiscussionScope;
  targetId: string;
  senderId: string;
  senderLabel: string;
  body: string;
  createdAt: string;
};

export type DiscussionTarget = {
  scope: DiscussionScope;
  targetId: string;
};

export type DiscussionSummary = {
  scope: DiscussionScope;
  targetId: string;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  hasOtherSender: boolean;
  unreadCount: number;
};

type DiscussionMessageRow = {
  id: string;
  scope: DiscussionScope;
  target_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type DiscussionReadRow = {
  scope: DiscussionScope;
  target_id: string;
  last_read_at: string;
};

type UserLabelRow = {
  uid: string;
  email: string | null;
  real_name: string | null;
  display_name: string | null;
};

type UserDisplayLabelRow = {
  uid: string;
  label: string | null;
};

function userLabel(row: UserLabelRow | undefined, fallback: string): string {
  if (!row) {
    return fallback;
  }
  return row.display_name?.trim() || row.real_name?.trim() || row.email?.trim() || fallback;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function discussionKey(scope: DiscussionScope, targetId: string): string {
  return `${scope}:${targetId}`;
}

async function fetchUserLabels(userIds: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const uniqueIds = unique(userIds);
  if (uniqueIds.length === 0) {
    return labels;
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc('list_user_display_labels', {
    p_user_ids: uniqueIds,
  });
  if (!rpcError) {
    for (const row of (rpcRows ?? []) as UserDisplayLabelRow[]) {
      if (row.label?.trim()) {
        labels.set(row.uid, row.label.trim());
      }
    }
    if (labels.size === uniqueIds.length) {
      return labels;
    }
  }

  const { data, error } = await supabase
    .from(T.users)
    .select('uid, email, real_name, display_name')
    .in('uid', uniqueIds);

  if (error) {
    return labels;
  }

  for (const row of (data ?? []) as UserLabelRow[]) {
    labels.set(row.uid, userLabel(row, row.uid));
  }
  return labels;
}

export async function listDiscussionMessages(
  scope: DiscussionScope,
  targetId: string,
): Promise<DiscussionMessage[]> {
  const { data, error } = await supabase
    .from(T.discussionMessages)
    .select('id, scope, target_id, sender_id, body, created_at')
    .eq('scope', scope)
    .eq('target_id', targetId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as DiscussionMessageRow[];
  const labels = await fetchUserLabels(rows.map((row) => row.sender_id));
  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    targetId: row.target_id,
    senderId: row.sender_id,
    senderLabel: labels.get(row.sender_id) ?? row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export async function createDiscussionMessage(input: {
  scope: DiscussionScope;
  targetId: string;
  senderId: string;
  body: string;
}): Promise<void> {
  const body = input.body.trim();
  if (!body) {
    return;
  }

  if (input.scope === 'slot') {
    const { error: participantError } = await supabase.from(T.discussionParticipants).upsert(
      {
        scope: input.scope,
        target_id: input.targetId,
        user_id: input.senderId,
      },
      { onConflict: 'scope,target_id,user_id', ignoreDuplicates: true },
    );

    if (participantError) {
      throw participantError;
    }
  }

  const { error } = await supabase.from(T.discussionMessages).insert({
    scope: input.scope,
    target_id: input.targetId,
    sender_id: input.senderId,
    body,
  });

  if (error) {
    throw error;
  }
}

export async function markDiscussionRead(input: {
  scope: DiscussionScope;
  targetId: string;
  userId: string;
  readAt?: string | null;
}): Promise<void> {
  const readAt = input.readAt ?? new Date().toISOString();
  const { error } = await supabase.from(T.discussionMessageReads).upsert(
    {
      scope: input.scope,
      target_id: input.targetId,
      user_id: input.userId,
      last_read_at: readAt,
      updated_at: readAt,
    },
    { onConflict: 'scope,target_id,user_id' },
  );

  if (error) {
    throw error;
  }
}

export async function listDiscussionSummaries(
  userId: string,
  targets: DiscussionTarget[],
): Promise<Map<string, DiscussionSummary>> {
  const uniqueTargets = Array.from(
    new Map(targets.map((target) => [discussionKey(target.scope, target.targetId), target])).values(),
  );
  const summaries = new Map<string, DiscussionSummary>();
  for (const target of uniqueTargets) {
    summaries.set(discussionKey(target.scope, target.targetId), {
      scope: target.scope,
      targetId: target.targetId,
      lastMessageAt: null,
      lastMessageBody: null,
      hasOtherSender: false,
      unreadCount: 0,
    });
  }
  if (uniqueTargets.length === 0) {
    return summaries;
  }

  const targetsByScope = uniqueTargets.reduce<Record<DiscussionScope, string[]>>(
    (acc, target) => {
      acc[target.scope].push(target.targetId);
      return acc;
    },
    { slot: [], event: [] },
  );

  const messageRows: DiscussionMessageRow[] = [];
  for (const scope of Object.keys(targetsByScope) as DiscussionScope[]) {
    const targetIds = targetsByScope[scope];
    if (targetIds.length === 0) {
      continue;
    }
    const { data, error } = await supabase
      .from(T.discussionMessages)
      .select('id, scope, target_id, sender_id, body, created_at')
      .eq('scope', scope)
      .in('target_id', targetIds)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }
    messageRows.push(...((data ?? []) as DiscussionMessageRow[]));
  }

  const { data: readRows, error: readError } = await supabase
    .from(T.discussionMessageReads)
    .select('scope, target_id, last_read_at')
    .eq('user_id', userId);

  if (readError) {
    throw readError;
  }

  const readsByTarget = new Map(
    ((readRows ?? []) as DiscussionReadRow[]).map((row) => [
      discussionKey(row.scope, row.target_id),
      row.last_read_at,
    ]),
  );

  for (const message of messageRows) {
    const key = discussionKey(message.scope, message.target_id);
    const current = summaries.get(key);
    if (!current) {
      continue;
    }

    current.lastMessageAt = message.created_at;
    current.lastMessageBody = message.body;
    if (message.sender_id !== userId) {
      current.hasOtherSender = true;
    }
    const lastReadAt = readsByTarget.get(key);
    if (message.sender_id !== userId && (!lastReadAt || message.created_at > lastReadAt)) {
      current.unreadCount += 1;
    }
  }

  return summaries;
}

export function subscribeToDiscussionMessages(
  scope: DiscussionScope,
  targetId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`discussion:${scope}:${targetId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: T.discussionMessages,
        filter: `target_id=eq.${targetId}`,
      },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
