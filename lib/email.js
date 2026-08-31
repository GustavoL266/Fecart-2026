const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailLayout(title, content) {
  return `<!doctype html>
  <html lang="pt-BR">
    <body style="margin:0;background:#0c100e;color:#eaf2ed;font-family:Arial,sans-serif">
      <div style="max-width:560px;margin:0 auto;padding:32px 20px">
        <div style="border:1px solid #294536;border-radius:18px;background:#151b18;padding:30px">
          <p style="margin:0 0 8px;color:#42d77d;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Assistente de Precificação</p>
          <h1 style="margin:0 0 20px;color:#ffffff;font-size:24px">${escapeHtml(title)}</h1>
          ${content}
        </div>
      </div>
    </body>
  </html>`;
}

export function buildLoginVerificationEmail(code) {
  return {
    subject: "Código de acesso — Assistente de Precificação",
    text: `Seu código de acesso é ${code}. Ele expira em 5 minutos e funciona uma única vez. Se você não tentou entrar, ignore este e-mail.`,
    html: emailLayout(
      "Verificação de segurança",
      `<p style="margin:0 0 18px;color:#b9c5be;line-height:1.6">Use o código abaixo para concluir seu login.</p>
       <div style="margin:0 0 18px;border-radius:12px;background:#0b0f0d;color:#51df8d;font-size:34px;font-weight:800;letter-spacing:10px;padding:18px;text-align:center">${escapeHtml(code)}</div>
       <p style="margin:0;color:#8f9c95;font-size:14px;line-height:1.6">Este código expira em 5 minutos e funciona uma única vez. Se você não tentou entrar, ignore este e-mail.</p>`,
    ),
  };
}

export function buildPasswordResetEmail(resetUrl) {
  const safeUrl = escapeHtml(resetUrl);
  return {
    subject: "Redefinição de senha — Assistente de Precificação",
    text: `Recebemos uma solicitação para redefinir a senha da sua conta. Abra este link para criar uma nova senha: ${resetUrl}\n\nO link expira em 20 minutos. Se você não solicitou esta alteração, ignore este e-mail.`,
    html: emailLayout(
      "Redefinição de senha",
      `<p style="margin:0 0 18px;color:#b9c5be;line-height:1.6">Recebemos uma solicitação para redefinir a senha da sua conta.</p>
       <p style="margin:0 0 22px"><a href="${safeUrl}" style="display:inline-block;border-radius:10px;background:#2fbd6b;color:#ffffff;font-weight:700;padding:14px 20px;text-decoration:none">Redefinir minha senha</a></p>
       <p style="margin:0;color:#8f9c95;font-size:14px;line-height:1.6">Este link expira em 20 minutos. Se você não solicitou esta alteração, ignore este e-mail.</p>`,
    ),
  };
}

async function sendEmail(config, { to, subject, text, html }) {
  if (!config.resendApiKey || !config.emailFrom) {
    const error = new Error("O serviço de e-mail não está configurado.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const error = new Error(`O provedor de e-mail respondeu com status ${response.status}.`);
    error.code = "EMAIL_DELIVERY_FAILED";
    throw error;
  }

  const payload = await response.json();
  return payload.id;
}

export function sendLoginVerificationEmail(config, to, code) {
  return sendEmail(config, { to, ...buildLoginVerificationEmail(code) });
}

export function sendPasswordResetEmail(config, to, resetUrl) {
  return sendEmail(config, { to, ...buildPasswordResetEmail(resetUrl) });
}
