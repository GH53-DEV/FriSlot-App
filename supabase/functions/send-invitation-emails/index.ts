// @ts-nocheck
// Deploy with Supabase Edge Functions.
// Required secrets:
// - RESEND_API_KEY
// - INVITATION_FROM_EMAIL (e.g. "FriSlot <noreply@yourdomain.com>")

interface InvitationItem {
  invitedEmail: string;
  inviteUrl: string;
}

interface Payload {
  ownerEmail: string;
  circleName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  invitations: InvitationItem[];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('INVITATION_FROM_EMAIL');
    if (!resendApiKey || !fromEmail) {
      return new Response(
        JSON.stringify({ error: 'Missing RESEND_API_KEY or INVITATION_FROM_EMAIL' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const payload = (await req.json()) as Payload;
    const invitations = Array.isArray(payload.invitations) ? payload.invitations : [];
    if (invitations.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sent: Array<{ email: string; ok: boolean; id?: string; error?: string }> = [];

    for (const row of invitations) {
      const vars = {
        owner_email: payload.ownerEmail ?? '',
        circle_name: payload.circleName ?? '',
        invite_url: row.inviteUrl,
      };
      const subject = interpolate(payload.subjectTemplate ?? 'FriSlot invitation', vars);
      const textBody = interpolate(payload.bodyTemplate ?? '', vars);
      const htmlBody = `<div style="font-family: Arial, sans-serif; line-height:1.6;">
        <p>${textBody.replace(/\n/g, '<br/>')}</p>
        <p><a href="${row.inviteUrl}" target="_blank" rel="noopener noreferrer">點我開啟邀請連結</a></p>
      </div>`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [row.invitedEmail],
          subject,
          html: htmlBody,
          text: textBody,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        sent.push({ email: row.invitedEmail, ok: false, error: errText });
        continue;
      }
      const json = await res.json();
      sent.push({ email: row.invitedEmail, ok: true, id: json.id });
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
