import { supabase } from './supabase';

type DispatchInput = {
  ownerEmail: string;
  circleName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  invitations: Array<{ invitedEmail: string; inviteUrl: string }>;
};

export async function dispatchInvitationEmails(input: DispatchInput) {
  const { data, error } = await supabase.functions.invoke('send-invitation-emails', {
    body: input,
  });

  if (error) {
    throw error;
  }

  return data;
}
