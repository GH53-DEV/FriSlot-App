import { supabase } from './supabase';

type DispatchInput = {
  ownerEmail: string;
  circleName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  invitations: Array<{ invitedEmail: string; inviteUrl: string }>;
};

const DEFAULT_SUBJECT = 'FriSlot 邀請你加入 {{circle_name}}';
const DEFAULT_BODY = '嗨，\n\n{{owner_email}} 邀請你加入 FriSlot 密友圈：{{circle_name}}\n請點擊連結：{{invite_url}}\n';

type TemplateRow = {
  subject_template?: string | null;
  body_template?: string | null;
};

export async function getInvitationEmailTemplates() {
  const { data, error } = await supabase.rpc('get_invitation_email_templates');
  if (error) {
    return {
      subjectTemplate: DEFAULT_SUBJECT,
      bodyTemplate: DEFAULT_BODY,
    };
  }

  const row = Array.isArray(data) && data.length > 0 ? (data[0] as TemplateRow) : null;
  return {
    subjectTemplate: row?.subject_template?.trim() || DEFAULT_SUBJECT,
    bodyTemplate: row?.body_template?.trim() || DEFAULT_BODY,
  };
}

export async function dispatchInvitationEmails(input: DispatchInput) {
  const { data, error } = await supabase.functions.invoke('send-invitation-emails', {
    body: input,
  });

  if (error) {
    throw error;
  }

  return data;
}
