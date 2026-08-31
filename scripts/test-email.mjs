import "dotenv/config";
import { sendLoginVerificationEmail } from "../lib/email.js";

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const emailFrom = process.env.EMAIL_FROM?.trim();
const recipient = process.env.EMAIL_TEST_TO?.trim();

if (!resendApiKey || !emailFrom || !recipient) {
  throw new Error("Defina RESEND_API_KEY, EMAIL_FROM e EMAIL_TEST_TO para testar o envio real.");
}

const providerId = await sendLoginVerificationEmail({ resendApiKey, emailFrom }, recipient, "123456");
console.log(`E-mail de teste aceito pelo Resend: provider=${providerId}`);
